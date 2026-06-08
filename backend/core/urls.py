from django.urls import path, include

urlpatterns = [
    path("api/", include("aiconnector.urls")),
    path("api/", include("contacts.urls")),
]
