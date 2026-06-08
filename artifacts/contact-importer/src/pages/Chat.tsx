import { useState, useEffect, useRef, useCallback } from "react";
import { useLocation } from "wouter";
import { Send, Settings, Bot, ChevronDown, Loader2, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { api, AIModelConfig, ChatMessage } from "@/lib/api";

type Message = {
  id: string;
  role: "user" | "assistant";
  content: string;
  streaming?: boolean;
};

export default function Chat() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();

  const [configs, setConfigs] = useState<AIModelConfig[]>([]);
  const [selectedConfig, setSelectedConfig] = useState<AIModelConfig | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    api.configs.list().then(({ configs }) => {
      setConfigs(configs);
      if (configs.length > 0) setSelectedConfig(configs[0]);
    }).catch(() => {});
  }, []);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const handleSubmit = useCallback(async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!input.trim() || isStreaming) return;
    if (!selectedConfig) {
      toast({ title: "Select an AI model first", description: "Go to Settings to add one.", variant: "destructive" });
      return;
    }

    const userText = input.trim();
    setInput("");

    const userMsgId = Date.now().toString();
    const assistantMsgId = (Date.now() + 1).toString();

    const updatedMessages: ChatMessage[] = [
      ...messages.map((m) => ({ role: m.role, content: m.content })),
      { role: "user", content: userText },
    ];

    setMessages((prev) => [
      ...prev,
      { id: userMsgId, role: "user", content: userText },
      { id: assistantMsgId, role: "assistant", content: "", streaming: true },
    ]);
    setIsStreaming(true);

    api.chat.stream(
      selectedConfig.id,
      updatedMessages,
      (chunk) => {
        setMessages((prev) =>
          prev.map((m) =>
            m.id === assistantMsgId ? { ...m, content: m.content + chunk } : m
          )
        );
      },
      () => {
        setMessages((prev) =>
          prev.map((m) =>
            m.id === assistantMsgId ? { ...m, streaming: false } : m
          )
        );
        setIsStreaming(false);
      },
      (err) => {
        setMessages((prev) =>
          prev.map((m) =>
            m.id === assistantMsgId
              ? { ...m, content: `Error: ${err}`, streaming: false }
              : m
          )
        );
        setIsStreaming(false);
        toast({ title: "AI Error", description: err, variant: "destructive" });
      }
    );
  }, [input, isStreaming, selectedConfig, messages, toast]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  return (
    <div className="flex flex-col h-[100dvh] bg-background">
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
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setMessages([])}
                className="text-xs text-muted-foreground"
              >
                Clear
              </Button>
            )}
            <Button variant="ghost" size="icon" onClick={() => setLocation("/settings")} title="Settings">
              <Settings className="h-4 w-4" />
            </Button>
          </div>
        </header>

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
            <div
              key={msg.id}
              className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}
            >
              {msg.role === "assistant" && (
                <div className="mr-3 mt-1 shrink-0">
                  <div className="w-7 h-7 rounded-full bg-primary/10 flex items-center justify-center">
                    <Bot className="h-4 w-4 text-primary" />
                  </div>
                </div>
              )}
              <div
                className={`max-w-[80%] rounded-2xl px-4 py-3 text-sm whitespace-pre-wrap ${
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
            </div>
          ))}
          <div ref={messagesEndRef} />
        </div>

        {/* Input */}
        <div className="px-4 pb-4 pt-2 border-t bg-background">
          <form onSubmit={handleSubmit} className="relative flex items-end gap-2">
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
              disabled={!input.trim() || isStreaming || !selectedConfig}
              className="absolute right-2 bottom-2 h-8 w-8 rounded-lg"
            >
              {isStreaming ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Send className="h-4 w-4" />
              )}
            </Button>
          </form>
          <p className="text-center text-[10px] text-muted-foreground mt-1.5">
            Enter to send · Shift+Enter for new line
          </p>
        </div>
      </div>
    </div>
  );
}
