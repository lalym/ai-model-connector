import { useState, useEffect, useRef, useCallback } from "react";
import { useLocation } from "wouter";
import {
  Send, Settings, Bot, ChevronDown, Loader2, Plus,
  Paperclip, X, FileText, MessageSquare, Trash2,
  PanelLeftClose, PanelLeftOpen, Pencil, Check as CheckIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader,
  AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { api, AIModelConfig, ChatMessage, ContentPart, ChatSession, StoredMessage } from "@/lib/api";

// ─── File attachment types ────────────────────────────────────────────────────
type AttachedFile = {
  id: string; name: string; kind: "image" | "text";
  mimeType: string; dataUrl: string; text?: string; size: number;
};
type DisplayFile = { name: string; kind: "image" | "text"; dataUrl?: string };
type Message = {
  id: string; role: "user" | "assistant"; content: string;
  files?: DisplayFile[]; streaming?: boolean;
};

// ─── Helpers ─────────────────────────────────────────────────────────────────
const TEXT_EXTS = new Set(["txt","md","csv","json","xml","yaml","yml","toml","ini","env","py","js","ts","tsx","jsx","html","css","scss","sh","sql","rs","go","java","c","cpp","h","rb","php","swift","kt","r","log"]);
const IMAGE_TYPES = new Set(["image/jpeg","image/png","image/gif","image/webp","image/svg+xml"]);
function getFileKind(f: File): "image"|"text"|null {
  if (IMAGE_TYPES.has(f.type)) return "image";
  const ext = f.name.split(".").pop()?.toLowerCase() ?? "";
  if (TEXT_EXTS.has(ext) || f.type.startsWith("text/")) return "text";
  return null;
}
const readAs = (f: File, mode: "dataUrl"|"text") => new Promise<string>((res, rej) => {
  const r = new FileReader();
  r.onload = () => res(r.result as string); r.onerror = rej;
  mode === "dataUrl" ? r.readAsDataURL(f) : r.readAsText(f);
});
function fmtBytes(b: number) { return b<1024?`${b} B`:b<1048576?`${(b/1024).toFixed(1)} KB`:`${(b/1048576).toFixed(1)} MB`; }
function fmtRelative(iso: string) {
  const d = new Date(iso), now = Date.now(), diff = now - d.getTime();
  if (diff < 60000) return "just now";
  if (diff < 3600000) return `${Math.floor(diff/60000)}m ago`;
  if (diff < 86400000) return `${Math.floor(diff/3600000)}h ago`;
  if (diff < 604800000) return `${Math.floor(diff/86400000)}d ago`;
  return d.toLocaleDateString();
}
function titleFromText(text: string) {
  const t = text.replace(/\s+/g, " ").trim();
  return t.length <= 60 ? t : t.slice(0, 57) + "…";
}
function storedToDisplay(msgs: StoredMessage[]): Message[] {
  return msgs.map((m) => {
    if (typeof m.content === "string") return { id: String(m.id), role: m.role, content: m.content };
    const parts = m.content as ContentPart[];
    const text = parts.filter((p): p is {type:"text";text:string} => p.type === "text").map(p => p.text).join("\n");
    const files: DisplayFile[] = parts
      .filter((p): p is {type:"image_url";image_url:{url:string}} => p.type === "image_url")
      .map((p) => ({ name: "image", kind: "image" as const, dataUrl: p.image_url.url }));
    return { id: String(m.id), role: m.role, content: text, files: files.length ? files : undefined };
  });
}

// ─── Component ────────────────────────────────────────────────────────────────
export default function Chat() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();

  const [configs, setConfigs] = useState<AIModelConfig[]>([]);
  const [selectedConfig, setSelectedConfig] = useState<AIModelConfig | null>(null);

  // Sessions
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<number | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [editingSessionId, setEditingSessionId] = useState<number | null>(null);
  const [editingTitle, setEditingTitle] = useState("");
  const [sessionsLoading, setSessionsLoading] = useState(true);

  // Messages
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);
  const [attachedFiles, setAttachedFiles] = useState<AttachedFile[]>([]);
  const [isDragging, setIsDragging] = useState(false);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const editInputRef = useRef<HTMLInputElement>(null);

  // ─── Load data ─────────────────────────────────────────────────────────────
  useEffect(() => {
    Promise.all([api.configs.list(), api.sessions.list()]).then(([c, s]) => {
      setConfigs(c.configs);
      if (c.configs.length > 0) setSelectedConfig(c.configs[0]);
      setSessions(s.sessions);
    }).catch(() => {}).finally(() => setSessionsLoading(false));
  }, []);

  useEffect(() => { messagesEndRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages]);
  useEffect(() => { if (editingSessionId) editInputRef.current?.focus(); }, [editingSessionId]);

  // ─── Session ops ───────────────────────────────────────────────────────────
  const loadSession = useCallback(async (session: ChatSession) => {
    if (isStreaming) return;
    setActiveSessionId(session.id);
    const { session: full } = await api.sessions.get(session.id);
    const displayMsgs = storedToDisplay(full.messages ?? []);
    setMessages(displayMsgs);
    // Switch to the config used in that session if available
    if (full.config_id) {
      setConfigs((prev) => {
        const cfg = prev.find(c => c.id === full.config_id);
        if (cfg) setSelectedConfig(cfg);
        return prev;
      });
    }
  }, [isStreaming]);

  const startNewChat = useCallback(() => {
    if (isStreaming) return;
    setActiveSessionId(null);
    setMessages([]);
    setInput("");
    setAttachedFiles([]);
  }, [isStreaming]);

  const deleteSession = useCallback(async (id: number, e: React.MouseEvent) => {
    e.stopPropagation();
    await api.sessions.delete(id);
    setSessions(prev => prev.filter(s => s.id !== id));
    if (activeSessionId === id) startNewChat();
  }, [activeSessionId, startNewChat]);

  const startRename = (session: ChatSession, e: React.MouseEvent) => {
    e.stopPropagation();
    setEditingSessionId(session.id);
    setEditingTitle(session.title);
  };

  const confirmRename = async () => {
    if (!editingSessionId || !editingTitle.trim()) { setEditingSessionId(null); return; }
    const { session } = await api.sessions.rename(editingSessionId, editingTitle.trim());
    setSessions(prev => prev.map(s => s.id === session.id ? session : s));
    setEditingSessionId(null);
  };

  // ─── File handling ──────────────────────────────────────────────────────────
  const processFiles = useCallback(async (files: FileList | File[]) => {
    const arr = Array.from(files);
    const newFiles: AttachedFile[] = [];
    for (const file of arr) {
      if (file.size > 10 * 1024 * 1024) { toast({ title: `${file.name} too large (max 10 MB)`, variant: "destructive" }); continue; }
      const kind = getFileKind(file);
      if (!kind) { toast({ title: `${file.name}: unsupported type`, variant: "destructive" }); continue; }
      try {
        if (kind === "image") {
          const dataUrl = await readAs(file, "dataUrl");
          newFiles.push({ id: crypto.randomUUID(), name: file.name, kind, mimeType: file.type, dataUrl, size: file.size });
        } else {
          const [text, dataUrl] = await Promise.all([readAs(file, "text"), readAs(file, "dataUrl")]);
          newFiles.push({ id: crypto.randomUUID(), name: file.name, kind, mimeType: file.type || "text/plain", dataUrl, text, size: file.size });
        }
      } catch { toast({ title: `Failed to read ${file.name}`, variant: "destructive" }); }
    }
    setAttachedFiles(prev => [...prev, ...newFiles]);
  }, [toast]);

  // ─── Submit ─────────────────────────────────────────────────────────────────
  const handleSubmit = useCallback(async (e?: React.FormEvent) => {
    e?.preventDefault();
    const hasContent = input.trim() || attachedFiles.length > 0;
    if (!hasContent || isStreaming || !selectedConfig) {
      if (!selectedConfig) toast({ title: "Select an AI model first", variant: "destructive" });
      return;
    }

    const userText = input.trim();
    const files = attachedFiles;
    setInput("");
    setAttachedFiles([]);

    // Build API message content
    const hasImages = files.some(f => f.kind === "image");
    let apiContent: string | ContentPart[];
    if (hasImages) {
      const parts: ContentPart[] = [];
      let textBlock = userText + files.filter(f => f.kind === "text").map(f => `\n\n[File: ${f.name}]\n\`\`\`\n${f.text}\n\`\`\``).join("");
      if (textBlock.trim()) parts.push({ type: "text", text: textBlock });
      for (const f of files.filter(f => f.kind === "image")) parts.push({ type: "image_url", image_url: { url: f.dataUrl } });
      apiContent = parts;
    } else {
      let combined = userText;
      for (const f of files) combined += `\n\n[File: ${f.name}]\n\`\`\`\n${f.text}\n\`\`\``;
      apiContent = combined.trim();
    }

    const historyMessages: ChatMessage[] = messages.map(m => ({ role: m.role, content: m.content }));
    const updatedMessages: ChatMessage[] = [...historyMessages, { role: "user", content: apiContent }];

    const userMsgId = Date.now().toString();
    const assistantMsgId = (Date.now() + 1).toString();
    const displayFiles: DisplayFile[] = files.map(f => ({ name: f.name, kind: f.kind, dataUrl: f.kind === "image" ? f.dataUrl : undefined }));

    setMessages(prev => [
      ...prev,
      { id: userMsgId, role: "user", content: userText, files: displayFiles.length ? displayFiles : undefined },
      { id: assistantMsgId, role: "assistant", content: "", streaming: true },
    ]);
    setIsStreaming(true);

    // Ensure a session exists
    let sessionId = activeSessionId;
    if (!sessionId) {
      const title = titleFromText(typeof apiContent === "string" ? apiContent : (apiContent.find(p => p.type === "text") as {type:"text";text:string} | undefined)?.text ?? "New Chat");
      const { session } = await api.sessions.create({ config_id: selectedConfig.id, title });
      sessionId = session.id;
      setActiveSessionId(session.id);
      setSessions(prev => [session, ...prev]);
    }

    api.chat.stream(
      selectedConfig.id,
      updatedMessages,
      sessionId,
      (chunk) => setMessages(prev => prev.map(m => m.id === assistantMsgId ? { ...m, content: m.content + chunk } : m)),
      () => {
        setMessages(prev => prev.map(m => m.id === assistantMsgId ? { ...m, streaming: false } : m));
        setIsStreaming(false);
        // Refresh session list to update `updated_at` ordering
        api.sessions.list().then(({ sessions }) => setSessions(sessions)).catch(() => {});
      },
      (err) => {
        setMessages(prev => prev.map(m => m.id === assistantMsgId ? { ...m, content: `Error: ${err}`, streaming: false } : m));
        setIsStreaming(false);
        toast({ title: "AI Error", description: err, variant: "destructive" });
      }
    );
  }, [input, attachedFiles, isStreaming, selectedConfig, messages, activeSessionId, toast]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSubmit(); }
  };

  const canSend = (input.trim() || attachedFiles.length > 0) && !isStreaming && !!selectedConfig;

  // ─── Render ─────────────────────────────────────────────────────────────────
  return (
    <div
      className={`flex h-[100dvh] bg-background ${isDragging ? "bg-primary/5" : ""}`}
      onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
      onDragLeave={() => setIsDragging(false)}
      onDrop={(e) => { e.preventDefault(); setIsDragging(false); processFiles(e.dataTransfer.files); }}
    >
      {/* ── Sidebar ───────────────────────────────────────────────────────── */}
      {sidebarOpen && (
        <aside className="w-64 shrink-0 border-r flex flex-col bg-muted/20 h-full">
          {/* Sidebar header */}
          <div className="flex items-center justify-between px-3 py-3 border-b">
            <Button size="sm" variant="outline" className="flex-1 mr-2 gap-1.5 text-sm" onClick={startNewChat}>
              <Plus className="h-3.5 w-3.5" /> New chat
            </Button>
            <Button size="icon" variant="ghost" className="shrink-0 h-8 w-8" onClick={() => setSidebarOpen(false)}>
              <PanelLeftClose className="h-4 w-4" />
            </Button>
          </div>

          {/* Sessions list */}
          <div className="flex-1 overflow-y-auto py-1">
            {sessionsLoading ? (
              <div className="flex justify-center py-8"><Loader2 className="h-4 w-4 animate-spin text-muted-foreground" /></div>
            ) : sessions.length === 0 ? (
              <p className="text-xs text-muted-foreground text-center py-8 px-4">No chats yet.<br/>Start a conversation above.</p>
            ) : (
              sessions.map(session => (
                <div
                  key={session.id}
                  onClick={() => loadSession(session)}
                  className={`group relative flex items-start gap-2 px-3 py-2.5 mx-1 rounded-lg cursor-pointer transition-colors hover:bg-accent ${activeSessionId === session.id ? "bg-accent" : ""}`}
                >
                  <MessageSquare className="h-3.5 w-3.5 mt-0.5 shrink-0 text-muted-foreground" />
                  <div className="flex-1 min-w-0">
                    {editingSessionId === session.id ? (
                      <Input
                        ref={editInputRef}
                        value={editingTitle}
                        onChange={e => setEditingTitle(e.target.value)}
                        onBlur={confirmRename}
                        onKeyDown={e => { if (e.key === "Enter") confirmRename(); if (e.key === "Escape") setEditingSessionId(null); }}
                        onClick={e => e.stopPropagation()}
                        className="h-5 text-xs px-1 py-0"
                      />
                    ) : (
                      <>
                        <p className="text-xs font-medium leading-snug truncate">{session.title}</p>
                        <p className="text-[10px] text-muted-foreground mt-0.5">{fmtRelative(session.updated_at)}</p>
                      </>
                    )}
                  </div>
                  {/* Hover actions */}
                  {editingSessionId !== session.id && (
                    <div className="absolute right-2 top-1/2 -translate-y-1/2 hidden group-hover:flex items-center gap-0.5 bg-accent">
                      <button
                        onClick={e => startRename(session, e)}
                        className="p-1 rounded text-muted-foreground hover:text-foreground"
                      >
                        <Pencil className="h-3 w-3" />
                      </button>
                      <AlertDialog>
                        <AlertDialogTrigger asChild>
                          <button
                            onClick={e => e.stopPropagation()}
                            className="p-1 rounded text-muted-foreground hover:text-destructive"
                          >
                            <Trash2 className="h-3 w-3" />
                          </button>
                        </AlertDialogTrigger>
                        <AlertDialogContent>
                          <AlertDialogHeader>
                            <AlertDialogTitle>Delete this chat?</AlertDialogTitle>
                            <AlertDialogDescription>This will permanently delete "{session.title}" and all its messages.</AlertDialogDescription>
                          </AlertDialogHeader>
                          <AlertDialogFooter>
                            <AlertDialogCancel>Cancel</AlertDialogCancel>
                            <AlertDialogAction onClick={e => deleteSession(session.id, e)} className="bg-destructive hover:bg-destructive/90">Delete</AlertDialogAction>
                          </AlertDialogFooter>
                        </AlertDialogContent>
                      </AlertDialog>
                    </div>
                  )}
                </div>
              ))
            )}
          </div>

          {/* Sidebar footer */}
          <div className="border-t px-3 py-2">
            <Button variant="ghost" size="sm" className="w-full justify-start gap-2 text-muted-foreground text-xs" onClick={() => setLocation("/settings")}>
              <Settings className="h-3.5 w-3.5" /> Model settings
            </Button>
          </div>
        </aside>
      )}

      {/* ── Main chat ─────────────────────────────────────────────────────── */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Header */}
        <header className="flex items-center justify-between px-4 py-3 border-b bg-background/95 backdrop-blur sticky top-0 z-10">
          <div className="flex items-center gap-2">
            {!sidebarOpen && (
              <Button size="icon" variant="ghost" className="h-8 w-8 shrink-0" onClick={() => setSidebarOpen(true)}>
                <PanelLeftOpen className="h-4 w-4" />
              </Button>
            )}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm" className="flex items-center gap-2 max-w-[240px]">
                  <Bot className="h-4 w-4 shrink-0 text-primary" />
                  <span className="truncate text-sm font-medium">{selectedConfig ? selectedConfig.name : "Select model"}</span>
                  <ChevronDown className="h-3 w-3 shrink-0 text-muted-foreground" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start">
                {configs.length === 0 ? (
                  <DropdownMenuItem onClick={() => setLocation("/settings")}>
                    <Plus className="h-4 w-4 mr-2" /> Add a model in Settings
                  </DropdownMenuItem>
                ) : (
                  configs.map(c => (
                    <DropdownMenuItem key={c.id} onClick={() => setSelectedConfig(c)} className={selectedConfig?.id === c.id ? "bg-accent" : ""}>
                      <span className="font-medium">{c.name}</span>
                      <span className="ml-2 text-xs text-muted-foreground">{c.model_name}</span>
                    </DropdownMenuItem>
                  ))
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>

          <div className="flex items-center gap-2">
            {messages.length > 0 && (
              <Button variant="ghost" size="sm" onClick={startNewChat} className="text-xs text-muted-foreground">
                New chat
              </Button>
            )}
            <Button variant="ghost" size="icon" onClick={() => setLocation("/settings")} title="Settings">
              <Settings className="h-4 w-4" />
            </Button>
          </div>
        </header>

        {/* Drop overlay */}
        {isDragging && (
          <div className="absolute inset-0 z-20 flex items-center justify-center pointer-events-none">
            <div className="bg-background/90 backdrop-blur-sm border-2 border-dashed border-primary rounded-2xl p-8 text-center">
              <Paperclip className="h-8 w-8 text-primary mx-auto mb-2" />
              <p className="font-medium text-primary">Drop files here</p>
            </div>
          </div>
        )}

        {/* Messages */}
        <div className="flex-1 overflow-y-auto px-4 py-6 space-y-6">
          {messages.length === 0 && (
            <div className="flex flex-col items-center justify-center h-full text-center space-y-4 opacity-60">
              <Bot className="h-12 w-12 text-primary" />
              <div>
                <p className="font-medium text-lg">{selectedConfig ? selectedConfig.name : "No model selected"}</p>
                <p className="text-sm text-muted-foreground mt-1">
                  {selectedConfig ? `${selectedConfig.provider} · ${selectedConfig.model_name}` : "Go to Settings to add an AI model"}
                </p>
              </div>
              {!selectedConfig && (
                <Button onClick={() => setLocation("/settings")} variant="outline" size="sm">
                  <Plus className="h-4 w-4 mr-2" /> Add model
                </Button>
              )}
            </div>
          )}

          {messages.map(msg => (
            <div key={msg.id} className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
              {msg.role === "assistant" && (
                <div className="mr-3 mt-1 shrink-0">
                  <div className="w-7 h-7 rounded-full bg-primary/10 flex items-center justify-center">
                    <Bot className="h-4 w-4 text-primary" />
                  </div>
                </div>
              )}
              <div className="max-w-[80%] space-y-2">
                {msg.files && msg.files.length > 0 && (
                  <div className="flex flex-wrap gap-2 justify-end">
                    {msg.files.map((f, i) =>
                      f.kind === "image" && f.dataUrl ? (
                        <img key={i} src={f.dataUrl} alt={f.name} className="max-w-[240px] max-h-[180px] rounded-xl object-cover border shadow-sm" />
                      ) : (
                        <div key={i} className="flex items-center gap-1.5 bg-primary/10 text-primary rounded-lg px-2.5 py-1.5 text-xs font-medium">
                          <FileText className="h-3.5 w-3.5" />{f.name}
                        </div>
                      )
                    )}
                  </div>
                )}
                {(msg.content || msg.streaming) && (
                  <div className={`rounded-2xl px-4 py-3 text-sm whitespace-pre-wrap ${msg.role === "user" ? "bg-primary text-primary-foreground rounded-tr-sm" : "bg-muted text-foreground rounded-tl-sm"}`}>
                    {msg.content || (msg.streaming && (
                      <span className="flex gap-1 py-1">
                        <span className="w-1.5 h-1.5 rounded-full bg-current animate-bounce" />
                        <span className="w-1.5 h-1.5 rounded-full bg-current animate-bounce [animation-delay:0.15s]" />
                        <span className="w-1.5 h-1.5 rounded-full bg-current animate-bounce [animation-delay:0.3s]" />
                      </span>
                    ))}
                  </div>
                )}
              </div>
            </div>
          ))}
          <div ref={messagesEndRef} />
        </div>

        {/* Input */}
        <div className="px-4 pb-4 pt-2 border-t bg-background">
          {attachedFiles.length > 0 && (
            <div className="flex flex-wrap gap-2 mb-2">
              {attachedFiles.map(f => (
                <div key={f.id} className="flex items-center gap-1.5 bg-muted rounded-lg pl-2 pr-1 py-1 text-xs">
                  {f.kind === "image" ? <img src={f.dataUrl} alt={f.name} className="h-5 w-5 rounded object-cover" /> : <FileText className="h-3.5 w-3.5 text-muted-foreground shrink-0" />}
                  <span className="max-w-[140px] truncate font-medium">{f.name}</span>
                  <span className="text-muted-foreground">{fmtBytes(f.size)}</span>
                  <button type="button" onClick={() => setAttachedFiles(prev => prev.filter(x => x.id !== f.id))} className="ml-0.5 rounded p-0.5 text-muted-foreground hover:text-foreground"><X className="h-3 w-3" /></button>
                </div>
              ))}
            </div>
          )}
          <input ref={fileInputRef} type="file" multiple accept="image/*,.txt,.md,.csv,.json,.xml,.yaml,.yml,.py,.js,.ts,.tsx,.jsx,.html,.css,.sh,.sql,.rs,.go,.java,.c,.cpp,.h,.rb,.php,.swift,.kt,.r,.log" className="hidden" onChange={e => { if (e.target.files?.length) { processFiles(e.target.files); e.target.value = ""; } }} />
          <form onSubmit={handleSubmit} className="relative flex items-end gap-2">
            <Button type="button" variant="ghost" size="icon" onClick={() => fileInputRef.current?.click()} disabled={isStreaming || !selectedConfig} className="shrink-0 h-10 w-10 rounded-xl text-muted-foreground hover:text-foreground" title="Attach file">
              <Paperclip className="h-4 w-4" />
            </Button>
            <Textarea
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={selectedConfig ? `Message ${selectedConfig.name}…` : "Select a model to start chatting"}
              disabled={isStreaming || !selectedConfig}
              className="min-h-[52px] resize-none rounded-xl pr-12 py-3 bg-muted/50 border-transparent focus-visible:ring-1 focus-visible:ring-primary"
              rows={1}
            />
            <Button type="submit" size="icon" disabled={!canSend} className="absolute right-2 bottom-2 h-8 w-8 rounded-lg">
              {isStreaming ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            </Button>
          </form>
          <p className="text-center text-[10px] text-muted-foreground mt-1.5">Enter to send · Shift+Enter for new line · drag & drop files</p>
        </div>
      </div>
    </div>
  );
}
