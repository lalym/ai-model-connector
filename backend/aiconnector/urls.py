from django.urls import path
from . import views

urlpatterns = [
    path("healthz", views.HealthView.as_view(), name="health"),
    path("ai/configs/", views.AIConfigListView.as_view(), name="ai-configs"),
    path("ai/configs/<int:config_id>/", views.AIConfigDetailView.as_view(), name="ai-config-detail"),
    path("ai/chat/", views.AIChatView.as_view(), name="ai-chat"),
]
