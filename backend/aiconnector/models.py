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
