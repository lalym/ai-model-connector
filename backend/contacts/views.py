import json
import os
import urllib.parse
import urllib.request
import urllib.error

from django.http import JsonResponse, HttpResponseRedirect
from django.views import View
from django.views.decorators.csrf import csrf_exempt
from django.utils.decorators import method_decorator

GOOGLE_CLIENT_ID = os.environ.get("GOOGLE_CLIENT_ID", "")
GOOGLE_CLIENT_SECRET = os.environ.get("GOOGLE_CLIENT_SECRET", "")
SCOPES = "https://www.googleapis.com/auth/contacts"
TOKEN_URL = "https://oauth2.googleapis.com/token"
PEOPLE_BASE = "https://people.googleapis.com/v1"

_token_store: dict = {}


def _redirect_uri(request):
    scheme = "https"
    host = request.get_host()
    return f"{scheme}://{host}/api/contacts/oauth/callback"


def _google_request(method: str, url: str, access_token: str, body=None):
    headers = {
        "Authorization": f"Bearer {access_token}",
        "Content-Type": "application/json",
    }
    data = json.dumps(body).encode() if body else None
    req = urllib.request.Request(url, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req) as resp:
            raw = resp.read()
            return (json.loads(raw) if raw else {}), resp.status
    except urllib.error.HTTPError as e:
        body_bytes = e.read()
        try:
            err = json.loads(body_bytes)
        except Exception:
            err = {"error": body_bytes.decode()}
        return err, e.code


def _get_valid_token():
    token = _token_store.get("access_token")
    refresh = _token_store.get("refresh_token")
    if not token:
        return None
    if refresh:
        data = urllib.parse.urlencode({
            "client_id": GOOGLE_CLIENT_ID,
            "client_secret": GOOGLE_CLIENT_SECRET,
            "refresh_token": refresh,
            "grant_type": "refresh_token",
        }).encode()
        req = urllib.request.Request(TOKEN_URL, data=data, method="POST")
        try:
            with urllib.request.urlopen(req) as resp:
                new_tokens = json.loads(resp.read())
                _token_store["access_token"] = new_tokens["access_token"]
                return new_tokens["access_token"]
        except Exception:
            pass
    return token


def _build_person(body: dict) -> dict:
    person = {}
    if body.get("name"):
        parts = body["name"].strip().split(" ", 1)
        person["names"] = [{"givenName": parts[0], "familyName": parts[1] if len(parts) > 1 else ""}]
    if body.get("phones"):
        person["phoneNumbers"] = [{"value": p, "type": "mobile"} for p in body["phones"] if p]
    elif body.get("phone"):
        person["phoneNumbers"] = [{"value": body["phone"], "type": "mobile"}]
    if body.get("emails"):
        person["emailAddresses"] = [{"value": e, "type": "home"} for e in body["emails"] if e]
    elif body.get("email"):
        person["emailAddresses"] = [{"value": body["email"], "type": "home"}]
    if body.get("organization"):
        person["organizations"] = [{"name": body["organization"]}]
    if body.get("note"):
        person["biographies"] = [{"value": body["note"], "contentType": "TEXT_PLAIN"}]
    if body.get("address"):
        person["addresses"] = [{"formattedValue": body["address"]}]
    return person


def _parse_vcard(text: str) -> dict:
    result: dict = {}
    phones: list = []
    emails: list = []
    for line in text.splitlines():
        line = line.strip()
        key_raw, _, value = line.partition(":")
        key = key_raw.split(";")[0].upper()
        value = value.strip()
        if key == "FN":
            result["name"] = value
        elif key == "N" and not result.get("name"):
            parts = value.split(";")
            family = parts[0].strip() if len(parts) > 0 else ""
            given = parts[1].strip() if len(parts) > 1 else ""
            result["name"] = f"{given} {family}".strip()
        elif key == "TEL":
            phones.append(value)
        elif key == "EMAIL":
            emails.append(value)
        elif key == "ORG":
            result["organization"] = value
        elif key == "ADR":
            parts = value.split(";")
            result["address"] = ", ".join(p for p in parts if p.strip())
        elif key == "NOTE":
            result["note"] = value
    if phones:
        result["phones"] = phones
    if emails:
        result["emails"] = emails
    return result


# ── OAuth ─────────────────────────────────────────────────────────────────────

class OAuthStartView(View):
    def get(self, request):
        if not GOOGLE_CLIENT_ID:
            return JsonResponse({"error": "GOOGLE_CLIENT_ID not configured"}, status=500)
        params = urllib.parse.urlencode({
            "client_id": GOOGLE_CLIENT_ID,
            "redirect_uri": _redirect_uri(request),
            "response_type": "code",
            "scope": SCOPES,
            "access_type": "offline",
            "prompt": "consent",
        })
        return HttpResponseRedirect(f"https://accounts.google.com/o/oauth2/v2/auth?{params}")


class OAuthCallbackView(View):
    def get(self, request):
        code = request.GET.get("code")
        error = request.GET.get("error")
        if error:
            return HttpResponseRedirect("/contacts?error=" + urllib.parse.quote(error))
        if not code:
            return HttpResponseRedirect("/contacts?error=no_code")

        data = urllib.parse.urlencode({
            "code": code,
            "client_id": GOOGLE_CLIENT_ID,
            "client_secret": GOOGLE_CLIENT_SECRET,
            "redirect_uri": _redirect_uri(request),
            "grant_type": "authorization_code",
        }).encode()
        req = urllib.request.Request(TOKEN_URL, data=data, method="POST")
        try:
            with urllib.request.urlopen(req) as resp:
                tokens = json.loads(resp.read())
        except urllib.error.HTTPError as e:
            err = urllib.parse.quote(e.read().decode())
            return HttpResponseRedirect("/contacts?error=" + err)

        _token_store["access_token"] = tokens.get("access_token")
        _token_store["refresh_token"] = tokens.get("refresh_token", _token_store.get("refresh_token"))
        return HttpResponseRedirect("/contacts?connected=1")


@method_decorator(csrf_exempt, name="dispatch")
class OAuthStatusView(View):
    def get(self, request):
        return JsonResponse({"connected": bool(_token_store.get("access_token"))})

    def delete(self, request):
        _token_store.clear()
        return JsonResponse({"disconnected": True})


# ── Contacts CRUD ─────────────────────────────────────────────────────────────

@method_decorator(csrf_exempt, name="dispatch")
class ContactsListView(View):
    def get(self, request):
        token = _token_store.get("access_token")
        if not token:
            return JsonResponse({"error": "not_connected"}, status=401)

        query = request.GET.get("q", "").strip()
        page_token = request.GET.get("pageToken", "")

        if query:
            params = urllib.parse.urlencode({
                "query": query,
                "readMask": "names,emailAddresses,phoneNumbers,organizations,addresses,biographies,photos",
                "pageSize": 30,
            })
            url = f"{PEOPLE_BASE}/people:searchContacts?{params}"
        else:
            params_d: dict = {
                "resourceName": "people/me",
                "personFields": "names,emailAddresses,phoneNumbers,organizations,addresses,biographies,photos",
                "pageSize": 50,
                "sortOrder": "LAST_NAME_ASCENDING",
            }
            if page_token:
                params_d["pageToken"] = page_token
            url = f"{PEOPLE_BASE}/people/me/connections?{urllib.parse.urlencode(params_d)}"

        data, status = _google_request("GET", url, token)
        if status != 200:
            return JsonResponse(data, status=status)

        if query:
            people = [r.get("person", {}) for r in data.get("results", [])]
            return JsonResponse({"contacts": people, "nextPageToken": None})
        else:
            return JsonResponse({"contacts": data.get("connections", []), "nextPageToken": data.get("nextPageToken")})


@method_decorator(csrf_exempt, name="dispatch")
class ContactCreateView(View):
    def post(self, request):
        token = _token_store.get("access_token")
        if not token:
            return JsonResponse({"error": "not_connected"}, status=401)
        try:
            body = json.loads(request.body)
        except json.JSONDecodeError:
            return JsonResponse({"error": "Invalid JSON"}, status=400)
        data, status = _google_request("POST", f"{PEOPLE_BASE}/people:createContact", token, _build_person(body))
        return JsonResponse(data, status=status)


@method_decorator(csrf_exempt, name="dispatch")
class ContactDetailView(View):
    def _rn(self, resource_name: str) -> str:
        return urllib.parse.unquote(resource_name)

    def get(self, request, resource_name):
        token = _token_store.get("access_token")
        if not token:
            return JsonResponse({"error": "not_connected"}, status=401)
        fields = "names,emailAddresses,phoneNumbers,organizations,addresses,biographies,photos"
        data, status = _google_request("GET", f"{PEOPLE_BASE}/{self._rn(resource_name)}?personFields={fields}", token)
        return JsonResponse(data, status=status)

    def patch(self, request, resource_name):
        token = _token_store.get("access_token")
        if not token:
            return JsonResponse({"error": "not_connected"}, status=401)
        try:
            body = json.loads(request.body)
        except json.JSONDecodeError:
            return JsonResponse({"error": "Invalid JSON"}, status=400)

        rn = self._rn(resource_name)
        existing, s = _google_request("GET", f"{PEOPLE_BASE}/{rn}?personFields=names,emailAddresses,phoneNumbers,organizations,addresses,biographies", token)
        if s != 200:
            return JsonResponse(existing, status=s)

        person = _build_person(body)
        person["etag"] = existing.get("etag", "")
        update_mask = ",".join(k for k in ["names", "emailAddresses", "phoneNumbers", "organizations", "addresses", "biographies"] if k in person)
        params = urllib.parse.urlencode({"updatePersonFields": update_mask})
        data, status = _google_request("PATCH", f"{PEOPLE_BASE}/{rn}:updateContact?{params}", token, person)
        return JsonResponse(data, status=status)

    def delete(self, request, resource_name):
        token = _token_store.get("access_token")
        if not token:
            return JsonResponse({"error": "not_connected"}, status=401)
        data, status = _google_request("DELETE", f"{PEOPLE_BASE}/{self._rn(resource_name)}:deleteContact", token)
        if status in (200, 204):
            return JsonResponse({"success": True})
        return JsonResponse(data, status=status)


@method_decorator(csrf_exempt, name="dispatch")
class DuplicateCheckView(View):
    def post(self, request):
        token = _token_store.get("access_token")
        if not token:
            return JsonResponse({"error": "not_connected"}, status=401)
        try:
            body = json.loads(request.body)
        except json.JSONDecodeError:
            return JsonResponse({"error": "Invalid JSON"}, status=400)

        query = (body.get("name") or body.get("phone") or body.get("email") or "").strip()
        if not query:
            return JsonResponse({"duplicates": []})

        params = urllib.parse.urlencode({"query": query, "readMask": "names,emailAddresses,phoneNumbers", "pageSize": 10})
        data, status = _google_request("GET", f"{PEOPLE_BASE}/people:searchContacts?{params}", token)
        if status != 200:
            return JsonResponse(data, status=status)
        return JsonResponse({"duplicates": [r.get("person", {}) for r in data.get("results", [])]})


@method_decorator(csrf_exempt, name="dispatch")
class VCardImportView(View):
    def post(self, request):
        token = _token_store.get("access_token")
        if not token:
            return JsonResponse({"error": "not_connected"}, status=401)
        try:
            body = json.loads(request.body)
        except json.JSONDecodeError:
            return JsonResponse({"error": "Invalid JSON"}, status=400)

        vcard_text = body.get("vcard", "")
        parsed = _parse_vcard(vcard_text)
        if not parsed.get("name") and not parsed.get("phones") and not parsed.get("emails"):
            return JsonResponse({"error": "Could not parse vCard — no name/phone/email found"}, status=400)

        data, status = _google_request("POST", f"{PEOPLE_BASE}/people:createContact", token, _build_person(parsed))
        return JsonResponse({"contact": data, "parsed": parsed}, status=status)
