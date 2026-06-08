import json
from django.db import models


class AIModelConfig(models.Model):
    PROVIDER_CHOICES = [
        ("openai", "OpenAI"),
        ("anthropic", "Anthropic"),
        ("google", "Google Gemini"),
        ("routerai", "RouterAI"),
        ("openai_compatible", "OpenAI-compatible"),
    ]

    name = models.CharField(max_length=100)
    provider = models.CharField(max_length=30, choices=PROVIDER_CHOICES)
    api_key = models.TextField()
    model_name = models.CharField(max_length=100)
    base_url = models.URLField(blank=True, null=True, help_text="Custom base URL (for OpenAI-compatible providers)")
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-created_at"]

    def __str__(self):
        return f"{self.name} ({self.provider}/{self.model_name})"

    def to_dict(self):
        return {
            "id": self.id,
            "name": self.name,
            "provider": self.provider,
            "model_name": self.model_name,
            "base_url": self.base_url,
            "api_key_set": bool(self.api_key),
            "created_at": self.created_at.isoformat(),
        }


class ChatSession(models.Model):
    config = models.ForeignKey(
        AIModelConfig, on_delete=models.SET_NULL,
        null=True, blank=True, related_name="sessions"
    )
    title = models.CharField(max_length=300, default="New Chat")
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-updated_at"]

    def __str__(self):
        return self.title

    def to_dict(self, include_messages=False):
        d = {
            "id": self.id,
            "title": self.title,
            "config_id": self.config_id,
            "created_at": self.created_at.isoformat(),
            "updated_at": self.updated_at.isoformat(),
        }
        if include_messages:
            d["messages"] = [m.to_dict() for m in self.messages.all()]
        return d


class ChatHistoryMessage(models.Model):
    session = models.ForeignKey(ChatSession, on_delete=models.CASCADE, related_name="messages")
    role = models.CharField(max_length=20)
    # content is stored as JSON string when it's a list (vision), else plain text
    content = models.TextField()
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["created_at"]

    def to_dict(self):
        try:
            content = json.loads(self.content)
        except (json.JSONDecodeError, TypeError):
            content = self.content
        return {
            "id": self.id,
            "role": self.role,
            "content": content,
            "created_at": self.created_at.isoformat(),
        }
