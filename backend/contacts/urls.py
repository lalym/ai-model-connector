from django.urls import path
from . import views

urlpatterns = [
    path("contacts/debug-headers", views.DebugHeadersView.as_view(), name="contacts-debug-headers"),
    path("contacts/oauth/start", views.OAuthStartView.as_view(), name="contacts-oauth-start"),
    path("contacts/oauth/callback", views.OAuthCallbackView.as_view(), name="contacts-oauth-callback"),
    path("contacts/oauth/status", views.OAuthStatusView.as_view(), name="contacts-oauth-status"),
    path("contacts/list", views.ContactsListView.as_view(), name="contacts-list"),
    path("contacts/create", views.ContactCreateView.as_view(), name="contacts-create"),
    path("contacts/duplicates", views.DuplicateCheckView.as_view(), name="contacts-duplicates"),
    path("contacts/vcard", views.VCardImportView.as_view(), name="contacts-vcard"),
    path("contacts/detail/<path:resource_name>", views.ContactDetailView.as_view(), name="contacts-detail"),
]
