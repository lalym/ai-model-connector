import { useState, useEffect, useRef, useCallback } from "react";
import { useLocation } from "wouter";
import {
  Send, Settings, Bot, ChevronDown, Loader2, Plus,
  Paperclip, X, FileText, Image as ImageIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { api, AIModelConfig, ChatMessage, ContentPart } from "@/lib/api";

// ─── File attachment types ────────────────────────────────────────────────────

type AttachedFile = {
  id: string;
  name: string;
  kind: "image" | "text";
  mimeType: string;
  dataUrl: string;   // base64 data URL for images; "data:text/plain;base64,..." for text
  text?: string;     // decoded text content (text files only)
  size: number;
};

type DisplayFile = {
  name: string;
  kind: "image" | "text";
  dataUrl?: string;  // only for images shown in bubble
};

type Message = {
  id: string;
  role: "user" | "assistant";
  content: string;
  files?: DisplayFile[];
  streaming?: boolean;
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

const TEXT_EXTENSIONS = new Set([
  "txt", "md", "csv", "json", "xml", "yaml", "yml", "toml", "ini", "env",
  "py", "js", "ts", "tsx", "jsx", "html", "css", "scss", "sh", "bash",
  "sql", "graphql", "rs", "go", "java", "c", "cpp", "h", "rb", "php",
  "swift", "kt", "r", "m", "log",
]);

const IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/gif", "image/webp", "image/svg+xml"]);

function getFileKind(file: File): "image" | "text" | null {
  if (IMAGE_TYPES.has(file.type)) return "image";
  const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
  if (TEXT_EXTENSIONS.has(ext) || file.type.startsWith("text/")) return "text";
  return null;
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function readFileAsText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsText(file);
  });
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function Chat() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();

  const [configs, setConfigs] = useState<AIModelConfig[]>([]);
  const [selectedConfig, setSelectedConfig] = useState<AIModelConfig | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);
  const [attachedFiles, setAttachedFiles] = useState<AttachedFile[]>([]);
  const [isDragging, setIsDragging] = useState(false);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    api.configs.list().then(({ configs }) => {
      setConfigs(configs);
      if (configs.length > 0) setSelectedConfig(configs[0]);
    }).catch(() => {});
  }, []);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // ─── File handling ────────────────────────────────────────────────────────

  const processFiles = useCallback(async (files: FileList | File[]) => {
    const arr = Array.from(files);
    const MAX_SIZE = 10 * 1024 * 1024; // 10 MB
    const newFiles: AttachedFile[] = [];

    for (const file of arr) {
      if (file.size > MAX_SIZE) {
        toast({ title: `${file.name} is too large (max 10 MB)`, variant: "destructive" });
        continue;
      }
      const kind = getFileKind(file);
      if (!kind) {
        toast({ title: `${file.name}: unsupported file type`, variant: "destructive" });
        continue;
      }
      try {
        if (kind === "image") {
          const dataUrl = await readFileAsDataUrl(file);
          newFiles.push({ id: crypto.randomUUID(), name: file.name, kind, mimeType: file.type, dataUrl, size: file.size });
        } else {
          const [text, dataUrl] = await Promise.all([readFileAsText(file), readFileAsDataUrl(file)]);
          newFiles.push({ id: crypto.randomUUID(), name: file.name, kind, mimeType: file.type || "text/plain", dataUrl, text, size: file.size });
        }
      } catch {
        toast({ title: `Failed to read ${file.name}`, variant: "destructive" });
      }
    }

    setAttachedFiles((prev) => [...prev, ...newFiles]);
  }, [toast]);

  const handleFileInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files?.length) {
      processFiles(e.target.files);
      e.target.value = "";
    }
  };

  const removeFile = (id: string) => setAttachedFiles((prev) => prev.filter((f) => f.id !== id));

  // Drag & drop
  const handleDragOver = (e: React.DragEvent) => { e.preventDefault(); setIsDragging(true); };
  const handleDragLeave = () => setIsDragging(false);
  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    if (e.dataTransfer.files.length) processFiles(e.dataTransfer.files);
  };

  // ─── Submit ───────────────────────────────────────────────────────────────

  const handleSubmit = useCallback(async (e?: React.FormEvent) => {
    e?.preventDefault();
    const hasContent = input.trim() || attachedFiles.length > 0;
    if (!hasContent || isStreaming) return;
    if (!selectedConfig) {
      toast({ title: "Select an AI model first", description: "Go to Settings to add one.", variant: "destructive" });
      return;
    }

    const userText = input.trim();
    const files = attachedFiles;
    setInput("");
    setAttachedFiles([]);

    const userMsgId = Date.now().toString();
    const assistantMsgId = (Date.now() + 1).toString();

    // Build the API message content
    const hasImages = files.some((f) => f.kind === "image");
    let apiContent: string | ContentPart[];

    if (hasImages) {
      // OpenAI vision format: content array
      const parts: ContentPart[] = [];
      // Text parts first
      let textBlock = userText;
      const textFiles = files.filter((f) => f.kind === "text");
      if (textFiles.length > 0) {
        textBlock += textFiles.map((f) => `\n\n[File: ${f.name}]\n\`\`\`\n${f.text}\n\`\`\``).join("");
      }
      if (textBlock.trim()) parts.push({ type: "text", text: textBlock });
      // Image parts
      for (const f of files.filter((f) => f.kind === "image")) {
        parts.push({ type: "image_url", image_url: { url: f.dataUrl } });
      }
      apiContent = parts;
    } else {
      // Plain text: append file contents inline
      let combined = userText;
      for (const f of files) {
        combined += `\n\n[File: ${f.name}]\n\`\`\`\n${f.text}\n\`\`\``;
      }
      apiContent = combined.trim();
    }

    const historyMessages: ChatMessage[] = messages.map((m) => ({ role: m.role, content: m.content }));
    const newUserMsg: ChatMessage = { role: "user", content: apiContent };
    const updatedMessages: ChatMessage[] = [...historyMessages, newUserMsg];

    // Display representation
    const displayContent = userText || (files.length > 0 ? "" : "");
    const displayFiles: DisplayFile[] = files.map((f) => ({
      name: f.name,
      kind: f.kind,
      dataUrl: f.kind === "image" ? f.dataUrl : undefined,
    }));

    setMessages((prev) => [
      ...prev,
      { id: userMsgId, role: "user", content: displayContent, files: displayFiles },
      { id: assistantMsgId, role: "assistant", content: "", streaming: true },
    ]);
    setIsStreaming(true);

    api.chat.stream(
      selectedConfig.id,
      updatedMessages,
      (chunk) => {
        setMessages((prev) =>
          prev.map((m) => m.id === assistantMsgId ? { ...m, content: m.content + chunk } : m)
        );
      },
      () => {
        setMessages((prev) =>
          prev.map((m) => m.id === assistantMsgId ? { ...m, streaming: false } : m)
        );
        setIsStreaming(false);
      },
      (err) => {
        setMessages((prev) =>
          prev.map((m) =>
            m.id === assistantMsgId ? { ...m, content: `Error: ${err}`, streaming: false } : m
          )
        );
        setIsStreaming(false);
        toast({ title: "AI Error", description: err, variant: "destructive" });
      }
    );
  }, [input, attachedFiles, isStreaming, selectedConfig, messages, toast]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSubmit(); }
  };

  const canSend = (input.trim() || attachedFiles.length > 0) && !isStreaming && !!selectedConfig;

  return (
    <div
      className={`flex flex-col h-[100dvh] bg-background transition-colors ${isDragging ? "bg-primary/5" : ""}`}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      <div className="w-full max-w-3xl mx-auto flex flex-col h-full">

        {/* Header */}
        <header className="flex items-center justify-between px-4 py-3 border-b bg-background/95 backdrop-blur sticky top-0 z-10">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm" className="flex items-center gap-2 max-w-[240px]">
                <Bot className="h-4 w-4 shrink-0 text-primary" />
                <span className="truncate text-sm font-medium">
                  {selectedConfig ? selectedConfig.name : "Select model"}
                </span>
                <ChevronDown className="h-3 w-3 shrink-0 text-muted-foreground" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start">
              {configs.length === 0 ? (
                <DropdownMenuItem onClick={() => setLocation("/settings")}>
                  <Plus className="h-4 w-4 mr-2" /> Add a model in Settings
                </DropdownMenuItem>
              ) : (
                configs.map((c) => (
                  <DropdownMenuItem
                    key={c.id}
                    onClick={() => setSelectedConfig(c)}
                    className={selectedConfig?.id === c.id ? "bg-accent" : ""}
                  >
                    <span className="font-medium">{c.name}</span>
                    <span className="ml-2 text-xs text-muted-foreground">{c.model_name}</span>
                  </DropdownMenuItem>
                ))
              )}
            </DropdownMenuContent>
          </DropdownMenu>

          <div className="flex items-center gap-2">
            {messages.length > 0 && (
              <Button variant="ghost" size="sm" onClick={() => setMessages([])} className="text-xs text-muted-foreground">
                Clear
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
              <p className="text-sm text-muted-foreground">Images, text, code files</p>
            </div>
          </div>
        )}

        {/* Messages */}
        <div className="flex-1 overflow-y-auto px-4 py-6 space-y-6">
          {messages.length === 0 && (
            <div className="flex flex-col items-center justify-center h-full text-center space-y-4 opacity-60">
              <Bot className="h-12 w-12 text-primary" />
              <div>
                <p className="font-medium text-lg">
                  {selectedConfig ? selectedConfig.name : "No model selected"}
                </p>
                <p className="text-sm text-muted-foreground mt-1">
                  {selectedConfig
                    ? `${selectedConfig.provider} · ${selectedConfig.model_name}`
                    : "Go to Settings to add an AI model"}
                </p>
              </div>
              {!selectedConfig && (
                <Button onClick={() => setLocation("/settings")} variant="outline" size="sm">
                  <Plus className="h-4 w-4 mr-2" /> Add model
                </Button>
              )}
            </div>
          )}

          {messages.map((msg) => (
            <div key={msg.id} className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
              {msg.role === "assistant" && (
                <div className="mr-3 mt-1 shrink-0">
                  <div className="w-7 h-7 rounded-full bg-primary/10 flex items-center justify-center">
                    <Bot className="h-4 w-4 text-primary" />
                  </div>
                </div>
              )}
              <div className="max-w-[80%] space-y-2">
                {/* Attached file previews */}
                {msg.files && msg.files.length > 0 && (
                  <div className="flex flex-wrap gap-2 justify-end">
                    {msg.files.map((f, i) => (
                      f.kind === "image" && f.dataUrl ? (
                        <img
                          key={i}
                          src={f.dataUrl}
                          alt={f.name}
                          className="max-w-[240px] max-h-[180px] rounded-xl object-cover border shadow-sm"
                        />
                      ) : (
                        <div key={i} className="flex items-center gap-1.5 bg-primary/10 text-primary rounded-lg px-2.5 py-1.5 text-xs font-medium">
                          <FileText className="h-3.5 w-3.5" />
                          {f.name}
                        </div>
                      )
                    ))}
                  </div>
                )}
                {/* Message bubble */}
                {(msg.content || msg.streaming) && (
                  <div
                    className={`rounded-2xl px-4 py-3 text-sm whitespace-pre-wrap ${
                      msg.role === "user"
                        ? "bg-primary text-primary-foreground rounded-tr-sm"
                        : "bg-muted text-foreground rounded-tl-sm"
                    }`}
                  >
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

        {/* Input area */}
        <div className="px-4 pb-4 pt-2 border-t bg-background">

          {/* Attached file chips */}
          {attachedFiles.length > 0 && (
            <div className="flex flex-wrap gap-2 mb-2">
              {attachedFiles.map((f) => (
                <div
                  key={f.id}
                  className="flex items-center gap-1.5 bg-muted rounded-lg pl-2 pr-1 py-1 text-xs group"
                >
                  {f.kind === "image" ? (
                    <img src={f.dataUrl} alt={f.name} className="h-5 w-5 rounded object-cover" />
                  ) : (
                    <FileText className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                  )}
                  <span className="max-w-[140px] truncate font-medium">{f.name}</span>
                  <span className="text-muted-foreground">{formatBytes(f.size)}</span>
                  <button
                    type="button"
                    onClick={() => removeFile(f.id)}
                    className="ml-0.5 rounded p-0.5 text-muted-foreground hover:text-foreground hover:bg-background transition-colors"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </div>
              ))}
            </div>
          )}

          <form onSubmit={handleSubmit} className="relative flex items-end gap-2">
            {/* Hidden file input */}
            <input
              ref={fileInputRef}
              type="file"
              multiple
              accept="image/*,.txt,.md,.csv,.json,.xml,.yaml,.yml,.toml,.ini,.env,.py,.js,.ts,.tsx,.jsx,.html,.css,.scss,.sh,.sql,.rs,.go,.java,.c,.cpp,.h,.rb,.php,.swift,.kt,.r,.log"
              className="hidden"
              onChange={handleFileInputChange}
            />

            {/* Attach button */}
            <Button
              type="button"
              variant="ghost"
              size="icon"
              onClick={() => fileInputRef.current?.click()}
              disabled={isStreaming || !selectedConfig}
              className="shrink-0 h-10 w-10 rounded-xl text-muted-foreground hover:text-foreground"
              title="Attach file"
            >
              <Paperclip className="h-4 w-4" />
            </Button>

            <Textarea
              ref={textareaRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={selectedConfig ? `Message ${selectedConfig.name}…` : "Select a model to start chatting"}
              disabled={isStreaming || !selectedConfig}
              className="min-h-[52px] resize-none rounded-xl pr-12 py-3 bg-muted/50 border-transparent focus-visible:ring-1 focus-visible:ring-primary"
              rows={1}
            />
            <Button
              type="submit"
              size="icon"
              disabled={!canSend}
              className="absolute right-2 bottom-2 h-8 w-8 rounded-lg"
            >
              {isStreaming ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            </Button>
          </form>
          <p className="text-center text-[10px] text-muted-foreground mt-1.5">
            Enter to send · Shift+Enter for new line · drag & drop files
          </p>
        </div>
      </div>
    </div>
  );
}
