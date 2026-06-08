import { useState, useEffect } from "react";
import { useLocation } from "wouter";
import { Plus, Trash2, ArrowLeft, Eye, EyeOff, Loader2, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";
import { api, AIModelConfig, CreateConfigPayload } from "@/lib/api";

const PROVIDER_LABELS: Record<AIModelConfig["provider"], string> = {
  openai: "OpenAI",
  anthropic: "Anthropic",
  google: "Google Gemini",
  routerai: "RouterAI",
  openai_compatible: "OpenAI-compatible",
};

const PROVIDER_DEFAULTS: Record<AIModelConfig["provider"], { model: string; baseUrl?: string; hint?: string }> = {
  openai: { model: "gpt-4o" },
  anthropic: { model: "claude-3-5-sonnet-20241022" },
  google: { model: "gemini-1.5-pro" },
  routerai: { model: "gpt-4o", hint: "Unified gateway to 100+ models (OpenAI, Anthropic, Gemini and more) via routerai.ru" },
  openai_compatible: { model: "", baseUrl: "" },
};

const emptyForm = (): CreateConfigPayload => ({
  name: "",
  provider: "openai",
  api_key: "",
  model_name: "gpt-4o",
  base_url: "",
});

export default function Settings() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();

  const [configs, setConfigs] = useState<AIModelConfig[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState<CreateConfigPayload>(emptyForm());
  const [showKey, setShowKey] = useState(false);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.configs.list()
      .then(({ configs }) => setConfigs(configs))
      .catch(() => toast({ title: "Failed to load configs", variant: "destructive" }))
      .finally(() => setLoading(false));
  }, []);

  const handleProviderChange = (provider: AIModelConfig["provider"]) => {
    const defaults = PROVIDER_DEFAULTS[provider];
    setForm((f) => ({
      ...f,
      provider,
      model_name: defaults.model,
      base_url: defaults.baseUrl ?? "",
    }));
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.name || !form.provider || !form.api_key || !form.model_name) {
      toast({ title: "All required fields must be filled", variant: "destructive" });
      return;
    }
    setSaving(true);
    try {
      const { config } = await api.configs.create({
        ...form,
        base_url: form.base_url || undefined,
      });
      setConfigs((prev) => [config, ...prev]);
      setShowForm(false);
      setForm(emptyForm());
      toast({ title: "Model added", description: `${config.name} is ready to use.` });
    } catch (err: unknown) {
      toast({ title: "Failed to save", description: String(err), variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: number, name: string) => {
    try {
      await api.configs.delete(id);
      setConfigs((prev) => prev.filter((c) => c.id !== id));
      toast({ title: `${name} removed` });
    } catch {
      toast({ title: "Failed to delete", variant: "destructive" });
    }
  };

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-2xl mx-auto px-4 py-6">

        {/* Header */}
        <div className="flex items-center gap-3 mb-6">
          <Button variant="ghost" size="icon" onClick={() => setLocation("/")}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div>
            <h1 className="text-xl font-semibold">AI Model Settings</h1>
            <p className="text-sm text-muted-foreground">Connect any AI model using your API key</p>
          </div>
        </div>

        {/* Add form */}
        {showForm ? (
          <Card className="mb-6">
            <CardHeader>
              <CardTitle className="text-base">New Model Connection</CardTitle>
              <CardDescription>Enter your API key and model details. Keys are stored in the database.</CardDescription>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleSave} className="space-y-4">
                <div className="space-y-1.5">
                  <Label htmlFor="name">Display name</Label>
                  <Input
                    id="name"
                    placeholder="e.g. My GPT-4"
                    value={form.name}
                    onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                    required
                  />
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <Label>Provider</Label>
                    <Select
                      value={form.provider}
                      onValueChange={(v) => handleProviderChange(v as AIModelConfig["provider"])}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {Object.entries(PROVIDER_LABELS).map(([value, label]) => (
                          <SelectItem key={value} value={value}>{label}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="space-y-1.5">
                    <Label htmlFor="model">Model name</Label>
                    <Input
                      id="model"
                      placeholder="e.g. gpt-4o"
                      value={form.model_name}
                      onChange={(e) => setForm((f) => ({ ...f, model_name: e.target.value }))}
                      required
                    />
                  </div>
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="apikey">API Key</Label>
                  <div className="relative">
                    <Input
                      id="apikey"
                      type={showKey ? "text" : "password"}
                      placeholder="sk-..."
                      value={form.api_key}
                      onChange={(e) => setForm((f) => ({ ...f, api_key: e.target.value }))}
                      className="pr-10"
                      required
                    />
                    <button
                      type="button"
                      onClick={() => setShowKey((v) => !v)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                    >
                      {showKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </button>
                  </div>
                </div>

                {form.provider === "routerai" && (
                  <div className="rounded-md bg-muted/60 border px-3 py-2 text-xs text-muted-foreground">
                    <span className="font-medium text-foreground">RouterAI</span> — unified gateway to 100+ models (GPT-4o, Claude, Gemini and more) via{" "}
                    <a href="https://routerai.ru" target="_blank" rel="noopener noreferrer" className="underline hover:text-foreground">routerai.ru</a>.
                    Base URL is set automatically.
                  </div>
                )}

                {form.provider === "openai_compatible" && (
                  <div className="space-y-1.5">
                    <Label htmlFor="baseurl">Base URL</Label>
                    <Input
                      id="baseurl"
                      placeholder="https://api.example.com/v1"
                      value={form.base_url}
                      onChange={(e) => setForm((f) => ({ ...f, base_url: e.target.value }))}
                    />
                  </div>
                )}

                <div className="flex gap-2 pt-2">
                  <Button type="submit" disabled={saving} className="flex-1">
                    {saving ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Check className="h-4 w-4 mr-2" />}
                    Save model
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => { setShowForm(false); setForm(emptyForm()); }}
                  >
                    Cancel
                  </Button>
                </div>
              </form>
            </CardContent>
          </Card>
        ) : (
          <Button onClick={() => setShowForm(true)} className="mb-6 w-full">
            <Plus className="h-4 w-4 mr-2" /> Add AI model
          </Button>
        )}

        {/* Configs list */}
        {loading ? (
          <div className="flex justify-center py-12">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : configs.length === 0 && !showForm ? (
          <div className="text-center py-16 text-muted-foreground">
            <p className="text-sm">No models added yet.</p>
            <p className="text-xs mt-1">Click "Add AI model" above to get started.</p>
          </div>
        ) : (
          <div className="space-y-3">
            {configs.map((c) => (
              <Card key={c.id} className="group">
                <CardContent className="flex items-center justify-between p-4">
                  <div className="space-y-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-medium truncate">{c.name}</span>
                      <Badge variant="secondary" className="text-xs shrink-0">
                        {PROVIDER_LABELS[c.provider]}
                      </Badge>
                    </div>
                    <p className="text-sm text-muted-foreground truncate">{c.model_name}</p>
                    {c.base_url && (
                      <p className="text-xs text-muted-foreground truncate">{c.base_url}</p>
                    )}
                  </div>
                  <div className="flex items-center gap-2 ml-4 shrink-0">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setLocation("/")}
                    >
                      Test
                    </Button>
                    <AlertDialog>
                      <AlertDialogTrigger asChild>
                        <Button variant="ghost" size="icon" className="text-muted-foreground hover:text-destructive">
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </AlertDialogTrigger>
                      <AlertDialogContent>
                        <AlertDialogHeader>
                          <AlertDialogTitle>Delete {c.name}?</AlertDialogTitle>
                          <AlertDialogDescription>
                            This will permanently remove the model connection and its API key.
                          </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel>Cancel</AlertDialogCancel>
                          <AlertDialogAction
                            onClick={() => handleDelete(c.id, c.name)}
                            className="bg-destructive hover:bg-destructive/90"
                          >
                            Delete
                          </AlertDialogAction>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}

        {/* Footer note */}
        <p className="text-xs text-muted-foreground text-center mt-8">
          Supported: OpenAI · Anthropic · Google Gemini · RouterAI · Any OpenAI-compatible endpoint
        </p>
      </div>
    </div>
  );
}
