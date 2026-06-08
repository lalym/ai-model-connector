import json
import time
import urllib.request
import urllib.error
from django.http import JsonResponse, StreamingHttpResponse
from django.views import View
from django.views.decorators.csrf import csrf_exempt
from django.utils.decorators import method_decorator
from .models import AIModelConfig, ChatSession, ChatHistoryMessage

ROUTERAI_BASE = "https://routerai.ru/api"           # base for REST paths (e.g. /v1/models)
ROUTERAI_CHAT_BASE = "https://routerai.ru/api/v1"  # base_url for OpenAI SDK (appends /chat/completions)


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


def _content_to_str(content):
    """Flatten content (string or parts list) to a plain string."""
    if isinstance(content, str):
        return content
    parts = []
    for p in content:
        if p.get("type") == "text":
            parts.append(p["text"])
        elif p.get("type") == "image_url":
            parts.append("[image]")
    return "\n".join(parts)


def _openai_to_anthropic_content(content):
    """Convert OpenAI content array to Anthropic format."""
    if isinstance(content, str):
        return content
    result = []
    for p in content:
        if p.get("type") == "text":
            result.append({"type": "text", "text": p["text"]})
        elif p.get("type") == "image_url":
            url = p["image_url"]["url"]
            if url.startswith("data:"):
                # data:<media_type>;base64,<data>
                header, data = url.split(";base64,", 1)
                media_type = header[5:]  # strip "data:"
                result.append({
                    "type": "image",
                    "source": {"type": "base64", "media_type": media_type, "data": data},
                })
    return result


def _openai_to_google_parts(content):
    """Convert OpenAI content array to Google genai parts list."""
    import base64
    import google.generativeai as genai
    if isinstance(content, str):
        return [content]
    parts = []
    for p in content:
        if p.get("type") == "text":
            parts.append(p["text"])
        elif p.get("type") == "image_url":
            url = p["image_url"]["url"]
            if url.startswith("data:"):
                header, data = url.split(";base64,", 1)
                media_type = header[5:]
                parts.append(genai.protos.Part(
                    inline_data=genai.protos.Blob(
                        mime_type=media_type,
                        data=base64.b64decode(data),
                    )
                ))
    return parts


def run_anthropic(api_key, model_name, messages, stream=False):
    import anthropic
    client = anthropic.Anthropic(api_key=api_key)
    system = None
    user_messages = []
    for m in messages:
        if m["role"] == "system":
            system = _content_to_str(m["content"])
        else:
            converted = _openai_to_anthropic_content(m["content"])
            user_messages.append({"role": m["role"], "content": converted})
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
    history = []
    system_text = None
    for m in messages[:-1]:
        if m["role"] == "system":
            system_text = _content_to_str(m["content"])
        elif m["role"] == "user":
            history.append({"role": "user", "parts": [_content_to_str(m["content"])]})
        elif m["role"] == "assistant":
            history.append({"role": "model", "parts": [_content_to_str(m["content"])]})
    last_content = messages[-1]["content"] if messages else ""
    last_parts = _openai_to_google_parts(last_content)
    if system_text:
        last_parts = [system_text + "\n\n"] + last_parts
    chat = model.start_chat(history=history)
    if stream:
        return chat.send_message(last_parts, stream=True)
    return chat.send_message(last_parts)


@method_decorator(csrf_exempt, name="dispatch")
class AIModelsListView(View):
    """Fetch available models for a given provider + optional api_key."""

    def get(self, request):
        provider = request.GET.get("provider", "")
        api_key = request.GET.get("api_key", "")

        if provider == "routerai":
            url = f"{ROUTERAI_BASE}/v1/models"
            try:
                req = urllib.request.Request(url)
                if api_key:
                    req.add_header("Authorization", f"Bearer {api_key}")
                with urllib.request.urlopen(req, timeout=10) as resp:
                    data = json.loads(resp.read())
                models = [
                    {"id": m["id"], "name": m.get("name", m["id"])}
                    for m in data.get("data", [])
                ]
                return JsonResponse({"models": models})
            except Exception as e:
                return JsonResponse({"error": str(e)}, status=502)

        return JsonResponse({"error": f"Model listing not supported for provider: {provider}"}, status=400)


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
class ChatSessionMessagesView(View):
    """POST: save a user+assistant turn to an existing session."""
    def post(self, request, session_id):
        try:
            data = json.loads(request.body)
        except json.JSONDecodeError:
            return JsonResponse({"error": "Invalid JSON"}, status=400)
        try:
            session = ChatSession.objects.get(id=session_id)
        except ChatSession.DoesNotExist:
            return JsonResponse({"error": "Not found"}, status=404)

        user_content = data.get("user_content", "")
        assistant_content = data.get("assistant_content", "")

        raw_user = json.dumps(user_content) if isinstance(user_content, list) else str(user_content)
        ChatHistoryMessage.objects.create(session=session, role="user", content=raw_user)
        ChatHistoryMessage.objects.create(session=session, role="assistant", content=str(assistant_content))
        session.save()  # bumps updated_at
        return JsonResponse({"ok": True})


@method_decorator(csrf_exempt, name="dispatch")
class ChatSessionListView(View):
    def get(self, request):
        sessions = ChatSession.objects.all()
        return JsonResponse({"sessions": [s.to_dict() for s in sessions]})

    def post(self, request):
        try:
            data = json.loads(request.body)
        except json.JSONDecodeError:
            return JsonResponse({"error": "Invalid JSON"}, status=400)
        config = None
        if data.get("config_id"):
            try:
                config = AIModelConfig.objects.get(id=data["config_id"])
            except AIModelConfig.DoesNotExist:
                pass
        session = ChatSession.objects.create(config=config, title=data.get("title", "New Chat"))
        return JsonResponse({"session": session.to_dict()}, status=201)


@method_decorator(csrf_exempt, name="dispatch")
class ChatSessionDetailView(View):
    def _get(self, session_id):
        try:
            return ChatSession.objects.get(id=session_id)
        except ChatSession.DoesNotExist:
            return None

    def get(self, request, session_id):
        session = self._get(session_id)
        if not session:
            return JsonResponse({"error": "Not found"}, status=404)
        return JsonResponse({"session": session.to_dict(include_messages=True)})

    def patch(self, request, session_id):
        session = self._get(session_id)
        if not session:
            return JsonResponse({"error": "Not found"}, status=404)
        try:
            data = json.loads(request.body)
        except json.JSONDecodeError:
            return JsonResponse({"error": "Invalid JSON"}, status=400)
        if "title" in data:
            session.title = data["title"]
            session.save()
        return JsonResponse({"session": session.to_dict()})

    def delete(self, request, session_id):
        session = self._get(session_id)
        if not session:
            return JsonResponse({"error": "Not found"}, status=404)
        session.delete()
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
        session_id = data.get("session_id")

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
                return self._stream_response(config, messages, session_id=session_id)
            else:
                return self._sync_response(config, messages, session_id=session_id)
        except Exception as e:
            return JsonResponse({"error": str(e)}, status=500)

    def _sync_response(self, config, messages, session_id=None):
        provider = config.provider
        user_content = messages[-1]["content"] if messages else ""
        try:
            if provider in ("openai", "openai_compatible", "routerai"):
                base_url = None
                if provider == "openai_compatible":
                    base_url = config.base_url
                elif provider == "routerai":
                    base_url = ROUTERAI_CHAT_BASE
                response = run_openai(config.api_key, config.model_name, messages, base_url=base_url)
                content = response.choices[0].message.content
            elif provider == "anthropic":
                response = run_anthropic(config.api_key, config.model_name, messages)
                content = response.content[0].text
            elif provider == "google":
                response = run_google(config.api_key, config.model_name, messages)
                content = response.text
            else:
                return JsonResponse({"error": f"Unknown provider: {provider}"}, status=400)

            return JsonResponse({"content": content})
        except Exception as e:
            return JsonResponse({"error": str(e)}, status=500)

    def _stream_response(self, config, messages, session_id=None):
        provider = config.provider
        user_content = messages[-1]["content"] if messages else ""

        def openai_generator():
            try:
                _base = None
                if config.provider == "openai_compatible":
                    _base = config.base_url
                elif config.provider == "routerai":
                    _base = ROUTERAI_CHAT_BASE
                stream = run_openai(config.api_key, config.model_name, messages, base_url=_base, stream=True)
                full = ""
                for chunk in stream:
                    if not chunk.choices:
                        continue
                    content = chunk.choices[0].delta.content
                    if content:
                        full += content
                        yield f"data: {json.dumps({'content': content})}\n\n"
                yield f"data: {json.dumps({'done': True})}\n\n"
            except Exception as e:
                yield f"data: {json.dumps({'error': str(e), 'done': True})}\n\n"

        def anthropic_generator():
            try:
                full = ""
                with run_anthropic(config.api_key, config.model_name, messages, stream=True) as stream:
                    for text in stream.text_stream:
                        full += text
                        yield f"data: {json.dumps({'content': text})}\n\n"
                yield f"data: {json.dumps({'done': True})}\n\n"
            except Exception as e:
                yield f"data: {json.dumps({'error': str(e), 'done': True})}\n\n"

        def google_generator():
            try:
                full = ""
                response = run_google(config.api_key, config.model_name, messages, stream=True)
                for chunk in response:
                    if chunk.text:
                        full += chunk.text
                        yield f"data: {json.dumps({'content': chunk.text})}\n\n"
                yield f"data: {json.dumps({'done': True})}\n\n"
            except Exception as e:
                yield f"data: {json.dumps({'error': str(e), 'done': True})}\n\n"

        generators = {
            "openai": openai_generator,
            "openai_compatible": openai_generator,
            "routerai": openai_generator,
            "anthropic": anthropic_generator,
            "google": google_generator,
        }

        gen_fn = generators.get(provider)
        if not gen_fn:
            return JsonResponse({"error": f"Unknown provider: {provider}"}, status=400)

        resp = StreamingHttpResponse(gen_fn(), content_type="text/event-stream")
        resp["Cache-Control"] = "no-cache"
        resp["X-Accel-Buffering"] = "no"
        return resp


@method_decorator(csrf_exempt, name="dispatch")
class HealthView(View):
    def get(self, request):
        return JsonResponse({"status": "ok"})
