const BASE = "/api";

export interface GooglePersonName { displayName?: string; givenName?: string; familyName?: string }
export interface GooglePersonPhone { value?: string; type?: string; canonicalForm?: string }
export interface GooglePersonEmail { value?: string; type?: string }
export interface GooglePersonOrg { name?: string; title?: string }
export interface GooglePersonAddress { formattedValue?: string; type?: string }
export interface GooglePersonBio { value?: string }
export interface GooglePersonPhoto { url?: string }

export interface GooglePerson {
  resourceName?: string;
  etag?: string;
  names?: GooglePersonName[];
  phoneNumbers?: GooglePersonPhone[];
  emailAddresses?: GooglePersonEmail[];
  organizations?: GooglePersonOrg[];
  addresses?: GooglePersonAddress[];
  biographies?: GooglePersonBio[];
  photos?: GooglePersonPhoto[];
}

export interface ContactPayload {
  name?: string;
  phone?: string;
  phones?: string[];
  email?: string;
  emails?: string[];
  organization?: string;
  address?: string;
  note?: string;
}

export interface AIModelConfig {
  id: number;
  name: string;
  provider: "openai" | "anthropic" | "google" | "routerai" | "openai_compatible";
  model_name: string;
  base_url?: string | null;
  api_key_set: boolean;
  created_at: string;
}

export interface CreateConfigPayload {
  name: string;
  provider: AIModelConfig["provider"];
  api_key: string;
  model_name: string;
  base_url?: string;
}

export type ContentPart =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string } };

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string | ContentPart[];
}

export interface ChatSession {
  id: number;
  title: string;
  config_id: number | null;
  created_at: string;
  updated_at: string;
  messages?: StoredMessage[];
}

export interface StoredMessage {
  id: number;
  role: "user" | "assistant";
  content: string | ContentPart[];
  created_at: string;
}

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    headers: { "Content-Type": "application/json" },
    ...options,
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: "Unknown error" }));
    throw new Error(body.error || `HTTP ${res.status}`);
  }
  return res.json();
}

export const api = {
  configs: {
    list: (): Promise<{ configs: AIModelConfig[] }> => request("/ai/configs/"),
    create: (payload: CreateConfigPayload): Promise<{ config: AIModelConfig }> =>
      request("/ai/configs/", { method: "POST", body: JSON.stringify(payload) }),
    update: (id: number, payload: Partial<CreateConfigPayload>): Promise<{ config: AIModelConfig }> =>
      request(`/ai/configs/${id}/`, { method: "PUT", body: JSON.stringify(payload) }),
    delete: (id: number): Promise<{ success: boolean }> =>
      request(`/ai/configs/${id}/`, { method: "DELETE" }),
  },

  sessions: {
    list: (): Promise<{ sessions: ChatSession[] }> => request("/ai/sessions/"),
    create: (payload: { config_id: number | null; title: string }): Promise<{ session: ChatSession }> =>
      request("/ai/sessions/", { method: "POST", body: JSON.stringify(payload) }),
    get: (id: number): Promise<{ session: ChatSession }> => request(`/ai/sessions/${id}/`),
    rename: (id: number, title: string): Promise<{ session: ChatSession }> =>
      request(`/ai/sessions/${id}/`, { method: "PATCH", body: JSON.stringify({ title }) }),
    delete: (id: number): Promise<{ success: boolean }> =>
      request(`/ai/sessions/${id}/`, { method: "DELETE" }),
    saveMessages: (
      id: number,
      userContent: string | ContentPart[],
      assistantContent: string
    ): Promise<{ ok: boolean }> =>
      request(`/ai/sessions/${id}/messages/`, {
        method: "POST",
        body: JSON.stringify({ user_content: userContent, assistant_content: assistantContent }),
      }),
  },

  contacts: {
    status: (): Promise<{ connected: boolean }> => request("/contacts/oauth/status"),
    disconnect: (): Promise<{ disconnected: boolean }> => request("/contacts/oauth/status", { method: "DELETE" }),
    list: (q?: string, pageToken?: string): Promise<{ contacts: GooglePerson[]; nextPageToken?: string }> => {
      const params = new URLSearchParams();
      if (q) params.set("q", q);
      if (pageToken) params.set("pageToken", pageToken);
      return request(`/contacts/list${params.toString() ? "?" + params : ""}`);
    },
    create: (data: ContactPayload): Promise<GooglePerson> => request("/contacts/create", { method: "POST", body: JSON.stringify(data) }),
    update: (resourceName: string, data: ContactPayload): Promise<GooglePerson> =>
      request(`/contacts/detail/${encodeURIComponent(resourceName)}`, { method: "PATCH", body: JSON.stringify(data) }),
    delete: (resourceName: string): Promise<{ success: boolean }> =>
      request(`/contacts/detail/${encodeURIComponent(resourceName)}`, { method: "DELETE" }),
    checkDuplicates: (data: { name?: string; phone?: string; email?: string }): Promise<{ duplicates: GooglePerson[] }> =>
      request("/contacts/duplicates", { method: "POST", body: JSON.stringify(data) }),
    importVCard: (vcard: string): Promise<{ contact: GooglePerson; parsed: ContactPayload }> =>
      request("/contacts/vcard", { method: "POST", body: JSON.stringify({ vcard }) }),
  },

  chat: {
    stream: (
      configId: number,
      messages: ChatMessage[],
      sessionId: number | null,
      onChunk: (text: string) => void,
      onDone: () => void,
      onError: (err: string) => void
    ) => {
      fetch(`${BASE}/ai/chat/`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          config_id: configId,
          messages,
          stream: true,
          session_id: sessionId,
        }),
      }).then(async (res) => {
        if (!res.ok) {
          const body = await res.json().catch(() => ({ error: "Unknown error" }));
          onError(body.error || `HTTP ${res.status}`);
          return;
        }
        const reader = res.body!.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() ?? "";
          for (const line of lines) {
            if (line.startsWith("data: ")) {
              try {
                const data = JSON.parse(line.slice(6));
                if (data.error) { onError(data.error); return; }
                if (data.done) { onDone(); return; }
                if (data.content) onChunk(data.content);
              } catch {}
            }
          }
        }
        onDone();
      }).catch((e) => onError(String(e)));
    },
  },
};
