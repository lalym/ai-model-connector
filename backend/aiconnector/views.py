import json
import time
from django.http import JsonResponse, StreamingHttpResponse
from django.views import View
from django.views.decorators.csrf import csrf_exempt
from django.utils.decorators import method_decorator
from .models import AIModelConfig


def run_openai(api_key, model_name, messages, base_url=None, stream=False):
    from openai import OpenAI
    kwargs = {"api_key": api_key}
    if base_url:
        kwargs["base_url"] = base_url
    client = OpenAI(**kwargs)
    return client.chat.completions.create(
        model=model_name,
        messages=messages,
        stream=stream,
        max_tokens=4096,
    )


def run_anthropic(api_key, model_name, messages, stream=False):
    import anthropic
    client = anthropic.Anthropic(api_key=api_key)
    system = None
    user_messages = []
    for m in messages:
        if m["role"] == "system":
            system = m["content"]
        else:
            user_messages.append({"role": m["role"], "content": m["content"]})
    kwargs = {
        "model": model_name,
        "max_tokens": 4096,
        "messages": user_messages,
    }
    if system:
        kwargs["system"] = system
    if stream:
        return client.messages.stream(**kwargs)
    return client.messages.create(**kwargs)


def run_google(api_key, model_name, messages, stream=False):
    import google.generativeai as genai
    genai.configure(api_key=api_key)
    model = genai.GenerativeModel(model_name)
    # Build history
    history = []
    system_text = None
    for m in messages[:-1]:
        if m["role"] == "system":
            system_text = m["content"]
        elif m["role"] == "user":
            history.append({"role": "user", "parts": [m["content"]]})
        elif m["role"] == "assistant":
            history.append({"role": "model", "parts": [m["content"]]})
    last_msg = messages[-1]["content"] if messages else ""
    if system_text:
        last_msg = f"{system_text}\n\n{last_msg}"
    chat = model.start_chat(history=history)
    if stream:
        return chat.send_message(last_msg, stream=True)
    return chat.send_message(last_msg)


@method_decorator(csrf_exempt, name="dispatch")
class AIConfigListView(View):
    def get(self, request):
        configs = AIModelConfig.objects.all()
        return JsonResponse({"configs": [c.to_dict() for c in configs]})

    def post(self, request):
        try:
            data = json.loads(request.body)
        except json.JSONDecodeError:
            return JsonResponse({"error": "Invalid JSON"}, status=400)

        required = ["name", "provider", "api_key", "model_name"]
        for field in required:
            if not data.get(field):
                return JsonResponse({"error": f"{field} is required"}, status=400)

        config = AIModelConfig.objects.create(
            name=data["name"],
            provider=data["provider"],
            api_key=data["api_key"],
            model_name=data["model_name"],
            base_url=data.get("base_url") or None,
        )
        return JsonResponse({"config": config.to_dict()}, status=201)


@method_decorator(csrf_exempt, name="dispatch")
class AIConfigDetailView(View):
    def get_config(self, config_id):
        try:
            return AIModelConfig.objects.get(id=config_id)
        except AIModelConfig.DoesNotExist:
            return None

    def get(self, request, config_id):
        config = self.get_config(config_id)
        if not config:
            return JsonResponse({"error": "Not found"}, status=404)
        return JsonResponse({"config": config.to_dict()})

    def put(self, request, config_id):
        config = self.get_config(config_id)
        if not config:
            return JsonResponse({"error": "Not found"}, status=404)
        try:
            data = json.loads(request.body)
        except json.JSONDecodeError:
            return JsonResponse({"error": "Invalid JSON"}, status=400)

        for field in ["name", "provider", "model_name"]:
            if field in data:
                setattr(config, field, data[field])
        if "api_key" in data and data["api_key"]:
            config.api_key = data["api_key"]
        if "base_url" in data:
            config.base_url = data["base_url"] or None
        config.save()
        return JsonResponse({"config": config.to_dict()})

    def delete(self, request, config_id):
        config = self.get_config(config_id)
        if not config:
            return JsonResponse({"error": "Not found"}, status=404)
        config.delete()
        return JsonResponse({"success": True})


@method_decorator(csrf_exempt, name="dispatch")
class AIChatView(View):
    def post(self, request):
        try:
            data = json.loads(request.body)
        except json.JSONDecodeError:
            return JsonResponse({"error": "Invalid JSON"}, status=400)

        config_id = data.get("config_id")
        messages = data.get("messages", [])
        stream_mode = data.get("stream", False)

        if not config_id:
            return JsonResponse({"error": "config_id is required"}, status=400)
        if not messages:
            return JsonResponse({"error": "messages are required"}, status=400)

        try:
            config = AIModelConfig.objects.get(id=config_id)
        except AIModelConfig.DoesNotExist:
            return JsonResponse({"error": "Config not found"}, status=404)

        try:
            if stream_mode:
                return self._stream_response(config, messages)
            else:
                return self._sync_response(config, messages)
        except Exception as e:
            return JsonResponse({"error": str(e)}, status=500)

    def _sync_response(self, config, messages):
        provider = config.provider
        if provider in ("openai", "openai_compatible"):
            response = run_openai(
                config.api_key, config.model_name, messages,
                base_url=config.base_url if provider == "openai_compatible" else None
            )
            content = response.choices[0].message.content
            return JsonResponse({"content": content})
        elif provider == "anthropic":
            response = run_anthropic(config.api_key, config.model_name, messages)
            content = response.content[0].text
            return JsonResponse({"content": content})
        elif provider == "google":
            response = run_google(config.api_key, config.model_name, messages)
            content = response.text
            return JsonResponse({"content": content})
        else:
            return JsonResponse({"error": f"Unknown provider: {provider}"}, status=400)

    def _stream_response(self, config, messages):
        provider = config.provider

        def openai_generator():
            stream = run_openai(
                config.api_key, config.model_name, messages,
                base_url=config.base_url if config.provider == "openai_compatible" else None,
                stream=True
            )
            for chunk in stream:
                content = chunk.choices[0].delta.content
                if content:
                    yield f"data: {json.dumps({'content': content})}\n\n"
            yield f"data: {json.dumps({'done': True})}\n\n"

        def anthropic_generator():
            with run_anthropic(config.api_key, config.model_name, messages, stream=True) as stream:
                for text in stream.text_stream:
                    yield f"data: {json.dumps({'content': text})}\n\n"
            yield f"data: {json.dumps({'done': True})}\n\n"

        def google_generator():
            response = run_google(config.api_key, config.model_name, messages, stream=True)
            for chunk in response:
                if chunk.text:
                    yield f"data: {json.dumps({'content': chunk.text})}\n\n"
            yield f"data: {json.dumps({'done': True})}\n\n"

        generators = {
            "openai": openai_generator,
            "openai_compatible": openai_generator,
            "anthropic": anthropic_generator,
            "google": google_generator,
        }

        gen_fn = generators.get(provider)
        if not gen_fn:
            return JsonResponse({"error": f"Unknown provider: {provider}"}, status=400)

        response = StreamingHttpResponse(gen_fn(), content_type="text/event-stream")
        response["Cache-Control"] = "no-cache"
        response["X-Accel-Buffering"] = "no"
        return response


@method_decorator(csrf_exempt, name="dispatch")
class HealthView(View):
    def get(self, request):
        return JsonResponse({"status": "ok"})
