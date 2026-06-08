from django.http import JsonResponse
from django.views import View


class ContactsPlaceholderView(View):
    def get(self, request):
        return JsonResponse({"message": "Google Contacts sync coming soon"})
