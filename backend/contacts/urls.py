from django.urls import path
from . import views

urlpatterns = [
    path("contacts/", views.ContactsPlaceholderView.as_view(), name="contacts"),
]
