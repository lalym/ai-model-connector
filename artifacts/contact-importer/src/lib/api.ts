const BASE = "/api";

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

  chat: {
    send: (configId: number, messages: ChatMessage[]): Promise<{ content: string }> =>
      request("/ai/chat/", {
        method: "POST",
        body: JSON.stringify({ config_id: configId, messages, stream: false }),
      }),

    stream: (
      configId: number,
      messages: ChatMessage[],
      onChunk: (text: string) => void,
      onDone: () => void,
      onError: (err: string) => void
    ) => {
      fetch(`${BASE}/ai/chat/`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ config_id: configId, messages, stream: true }),
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
