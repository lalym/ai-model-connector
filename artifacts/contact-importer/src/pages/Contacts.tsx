import { useState, useEffect, useCallback, useRef } from "react";
import { useLocation, useSearch } from "wouter";
import {
  Search, Plus, Trash2, ArrowLeft, Pencil, Check, X,
  Phone, Mail, Building2, MapPin, User, Loader2,
  AlertCircle, LogOut, RefreshCw, Import,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader,
  AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useToast } from "@/hooks/use-toast";
import {
  api, GooglePerson, ContactPayload,
} from "@/lib/api";

// ── Helpers ───────────────────────────────────────────────────────────────────
function displayName(p: GooglePerson): string {
  const n = p.names?.[0];
  if (!n) return "Unnamed";
  return n.displayName || `${n.givenName ?? ""} ${n.familyName ?? ""}`.trim() || "Unnamed";
}
function initials(p: GooglePerson): string {
  const name = displayName(p);
  const parts = name.split(" ");
  return (parts[0]?.[0] ?? "") + (parts[1]?.[0] ?? "");
}
function avatarColor(name: string): string {
  const colors = [
    "bg-red-100 text-red-700", "bg-orange-100 text-orange-700",
    "bg-yellow-100 text-yellow-700", "bg-green-100 text-green-700",
    "bg-teal-100 text-teal-700", "bg-blue-100 text-blue-700",
    "bg-indigo-100 text-indigo-700", "bg-purple-100 text-purple-700",
    "bg-pink-100 text-pink-700",
  ];
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) & 0xffff;
  return colors[hash % colors.length];
}

// Extract vCard blocks from AI assistant message
function extractVCards(text: string): string[] {
  const blocks: string[] = [];
  const re = /```vcard\n([\s\S]*?)```/gi;
  let m;
  while ((m = re.exec(text)) !== null) blocks.push(m[1].trim());
  // Also try plain BEGIN:VCARD blocks
  const re2 = /(BEGIN:VCARD[\s\S]*?END:VCARD)/gi;
  while ((m = re2.exec(text)) !== null) {
    const v = m[1].trim();
    if (!blocks.includes(v)) blocks.push(v);
  }
  return blocks;
}

// ── Contact form ──────────────────────────────────────────────────────────────
interface ContactFormData {
  name: string; phone: string; email: string;
  organization: string; address: string; note: string;
}
const emptyForm = (): ContactFormData => ({ name: "", phone: "", email: "", organization: "", address: "", note: "" });
function personToForm(p: GooglePerson): ContactFormData {
  return {
    name: displayName(p),
    phone: p.phoneNumbers?.[0]?.value ?? "",
    email: p.emailAddresses?.[0]?.value ?? "",
    organization: p.organizations?.[0]?.name ?? "",
    address: p.addresses?.[0]?.formattedValue ?? "",
    note: p.biographies?.[0]?.value ?? "",
  };
}
function formToPayload(f: ContactFormData): ContactPayload {
  return {
    name: f.name || undefined,
    phone: f.phone || undefined,
    email: f.email || undefined,
    organization: f.organization || undefined,
    address: f.address || undefined,
    note: f.note || undefined,
  };
}

// ── VCard import dialog ───────────────────────────────────────────────────────
function VCardImportDialog({ onImported }: { onImported: (p: GooglePerson) => void }) {
  const [open, setOpen] = useState(false);
  const [vcard, setVcard] = useState("");
  const [loading, setLoading] = useState(false);
  const [dupes, setDupes] = useState<GooglePerson[]>([]);
  const [parsed, setParsed] = useState<ContactPayload | null>(null);
  const { toast } = useToast();

  const handleImport = async () => {
    if (!vcard.trim()) return;
    setLoading(true);
    try {
      const { contact, parsed: p } = await api.contacts.importVCard(vcard);
      setParsed(p);
      onImported(contact);
      toast({ title: "Contact imported to Google Contacts!" });
      setOpen(false);
      setVcard("");
      setParsed(null);
      setDupes([]);
    } catch (e: any) {
      toast({ title: "Import failed", description: e.message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  const handleCheck = async () => {
    if (!vcard.trim()) return;
    // Quick parse: look for FN, TEL, EMAIL
    const fnMatch = vcard.match(/^FN[^:]*:(.*)/m);
    const telMatch = vcard.match(/^TEL[^:]*:(.*)/m);
    const emailMatch = vcard.match(/^EMAIL[^:]*:(.*)/m);
    const check: any = {};
    if (fnMatch) check.name = fnMatch[1].trim();
    if (telMatch) check.phone = telMatch[1].trim();
    if (emailMatch) check.email = emailMatch[1].trim();
    try {
      const { duplicates } = await api.contacts.checkDuplicates(check);
      setDupes(duplicates);
      if (duplicates.length === 0) toast({ title: "No duplicates found" });
    } catch {}
  };

  return (
    <>
      <Button variant="outline" size="sm" className="gap-1.5" onClick={() => setOpen(true)}>
        <Import className="h-3.5 w-3.5" /> Import vCard
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Import vCard</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <Textarea
              value={vcard}
              onChange={e => setVcard(e.target.value)}
              placeholder={"BEGIN:VCARD\nVERSION:3.0\nFN:Иванов Иван\nTEL;TYPE=MOBILE:+79001234567\nEND:VCARD"}
              className="font-mono text-xs h-40"
            />
            {dupes.length > 0 && (
              <div className="text-sm border rounded-lg p-3 bg-yellow-50 border-yellow-200">
                <p className="font-medium text-yellow-800 mb-1">⚠ Возможные дубликаты ({dupes.length}):</p>
                {dupes.map((d, i) => (
                  <p key={i} className="text-yellow-700 text-xs">{displayName(d)}{d.phoneNumbers?.[0]?.value ? " · " + d.phoneNumbers[0].value : ""}</p>
                ))}
              </div>
            )}
          </div>
          <DialogFooter className="gap-2">
            <Button variant="ghost" size="sm" onClick={handleCheck} disabled={!vcard.trim()}>
              Check duplicates
            </Button>
            <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button onClick={handleImport} disabled={!vcard.trim() || loading}>
              {loading && <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />}
              Import
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

// ── Contact form dialog ───────────────────────────────────────────────────────
function ContactFormDialog({
  initial, onSave, trigger,
}: {
  initial?: GooglePerson;
  onSave: (data: ContactPayload) => Promise<void>;
  trigger: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<ContactFormData>(initial ? personToForm(initial) : emptyForm());
  const [saving, setSaving] = useState(false);
  const { toast } = useToast();

  const set = (k: keyof ContactFormData) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setForm(prev => ({ ...prev, [k]: e.target.value }));

  const handleSave = async () => {
    setSaving(true);
    try {
      await onSave(formToPayload(form));
      setOpen(false);
    } catch (e: any) {
      toast({ title: "Failed to save", description: e.message, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <span onClick={() => { setForm(initial ? personToForm(initial) : emptyForm()); setOpen(true); }}>
        {trigger}
      </span>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{initial ? "Edit contact" : "New contact"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            {[
              { label: "Full name", key: "name" as const, placeholder: "Иванов Иван Иванович" },
              { label: "Phone", key: "phone" as const, placeholder: "+7 900 123-45-67" },
              { label: "Email", key: "email" as const, placeholder: "ivan@example.com" },
              { label: "Company", key: "organization" as const, placeholder: "ООО Ромашка" },
              { label: "Address", key: "address" as const, placeholder: "г. Москва, ул. Примерная, 1" },
            ].map(({ label, key, placeholder }) => (
              <div key={key} className="space-y-1">
                <Label className="text-xs">{label}</Label>
                <Input value={form[key]} onChange={set(key)} placeholder={placeholder} className="text-sm" />
              </div>
            ))}
            <div className="space-y-1">
              <Label className="text-xs">Note</Label>
              <Textarea value={form.note} onChange={set("note")} placeholder="Дополнительная информация" className="text-sm h-20" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button onClick={handleSave} disabled={saving}>
              {saving && <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />}
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────
export default function ContactsPage() {
  const [, setLocation] = useLocation();
  const search = useSearch();
  const { toast } = useToast();

  const [connected, setConnected] = useState(false);
  const [authLoading, setAuthLoading] = useState(true);

  const [contacts, setContacts] = useState<GooglePerson[]>([]);
  const [nextPageToken, setNextPageToken] = useState<string | undefined>();
  const [loading, setLoading] = useState(false);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<GooglePerson | null>(null);

  const searchTimeout = useRef<ReturnType<typeof setTimeout>>();

  // ── Check OAuth status ──────────────────────────────────────────────────────
  useEffect(() => {
    api.contacts.status()
      .then(({ connected: c }) => { setConnected(c); setAuthLoading(false); })
      .catch(() => setAuthLoading(false));

    const params = new URLSearchParams(search);
    if (params.get("connected")) {
      toast({ title: "Google Contacts connected!" });
      window.history.replaceState({}, "", "/contacts");
    }
    if (params.get("error")) {
      toast({ title: "Google auth failed", description: params.get("error") ?? "", variant: "destructive" });
    }
  }, []);

  // ── Load contacts ───────────────────────────────────────────────────────────
  const loadContacts = useCallback(async (q: string, pageToken?: string) => {
    setLoading(true);
    try {
      const { contacts: list, nextPageToken: next } = await api.contacts.list(q || undefined, pageToken);
      if (pageToken) {
        setContacts(prev => [...prev, ...list]);
      } else {
        setContacts(list);
        setSelected(null);
      }
      setNextPageToken(next ?? undefined);
    } catch (e: any) {
      toast({ title: "Failed to load contacts", description: e.message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    if (!connected) return;
    clearTimeout(searchTimeout.current);
    searchTimeout.current = setTimeout(() => loadContacts(query), query ? 400 : 0);
    return () => clearTimeout(searchTimeout.current);
  }, [connected, query]);

  // ── CRUD handlers ───────────────────────────────────────────────────────────
  const handleCreate = async (data: ContactPayload) => {
    const contact = await api.contacts.create(data);
    setContacts(prev => [contact, ...prev]);
    toast({ title: "Contact created" });
  };

  const handleUpdate = async (data: ContactPayload) => {
    if (!selected?.resourceName) return;
    const updated = await api.contacts.update(selected.resourceName, data);
    setContacts(prev => prev.map(c => c.resourceName === updated.resourceName ? updated : c));
    setSelected(updated);
    toast({ title: "Contact updated" });
  };

  const handleDelete = async (contact: GooglePerson) => {
    if (!contact.resourceName) return;
    await api.contacts.delete(contact.resourceName);
    setContacts(prev => prev.filter(c => c.resourceName !== contact.resourceName));
    if (selected?.resourceName === contact.resourceName) setSelected(null);
    toast({ title: "Contact deleted" });
  };

  const handleDisconnect = async () => {
    await api.contacts.disconnect();
    setConnected(false);
    setContacts([]);
  };

  const handleImported = (contact: GooglePerson) => {
    setContacts(prev => [contact, ...prev]);
    setSelected(contact);
  };

  const handleGoogleSignIn = () => {
    // Must open in a new tab — Google blocks OAuth inside iframes (Replit preview is an iframe)
    const oauthUrl = `https://e9da8b5b-c45d-4d6d-b2cc-21fcd23fe6ef-00-2hwh08qrntgwv.pike.replit.dev/api/contacts/oauth/start`;
    const popup = window.open(oauthUrl, "_blank");
    // Poll status every 2s until connected or popup closed
    const timer = setInterval(async () => {
      try {
        const { connected: c } = await api.contacts.status();
        if (c) {
          clearInterval(timer);
          setConnected(true);
          setAuthLoading(false);
          toast({ title: "Google Contacts подключён!" });
          try { popup?.close(); } catch {}
        }
      } catch {}
      try { if (popup?.closed) clearInterval(timer); } catch {}
    }, 2000);
  };

  // ── Not connected state ─────────────────────────────────────────────────────
  if (authLoading) {
    return (
      <div className="flex h-[100dvh] items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!connected) {
    return (
      <div className="flex h-[100dvh] flex-col">
        <header className="flex items-center gap-3 px-4 py-3 border-b">
          <Button variant="ghost" size="icon" onClick={() => setLocation("/")}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <h1 className="font-semibold">Google Contacts</h1>
        </header>
        <div className="flex-1 flex items-center justify-center">
          <Card className="max-w-sm w-full mx-4">
            <CardHeader className="text-center pb-2">
              <div className="w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center mx-auto mb-3">
                <svg viewBox="0 0 24 24" className="h-8 w-8 text-primary" fill="none" stroke="currentColor" strokeWidth="1.5">
                  <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/>
                  <circle cx="9" cy="7" r="4"/>
                  <path d="M23 21v-2a4 4 0 0 0-3-3.87"/>
                  <path d="M16 3.13a4 4 0 0 1 0 7.75"/>
                </svg>
              </div>
              <CardTitle>Connect Google Contacts</CardTitle>
            </CardHeader>
            <CardContent className="text-center space-y-4">
              <p className="text-sm text-muted-foreground">
                Подключите аккаунт Google, чтобы импортировать контакты из чата, искать, редактировать и удалять контакты.
              </p>
              <Button className="w-full" onClick={handleGoogleSignIn}>
                <svg className="h-4 w-4 mr-2" viewBox="0 0 24 24"><path fill="currentColor" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/><path fill="currentColor" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/><path fill="currentColor" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/><path fill="currentColor" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/></svg>
                Sign in with Google
              </Button>
              <p className="text-[11px] text-muted-foreground">
                Откроется новая вкладка → авторизуйтесь → вернитесь сюда (обновится автоматически)
              </p>
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }

  // ── Connected ───────────────────────────────────────────────────────────────
  return (
    <div className="flex h-[100dvh] flex-col">
      {/* Header */}
      <header className="flex items-center gap-3 px-4 py-3 border-b bg-background/95 backdrop-blur sticky top-0 z-10">
        <Button variant="ghost" size="icon" onClick={() => setLocation("/")}>
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <h1 className="font-semibold flex-1">Google Contacts</h1>
        <VCardImportDialog onImported={handleImported} />
        <ContactFormDialog onSave={handleCreate} trigger={
          <Button size="sm" className="gap-1.5"><Plus className="h-3.5 w-3.5" /> New</Button>
        } />
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button variant="ghost" size="icon" title="Disconnect Google"><LogOut className="h-4 w-4" /></Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Disconnect Google Contacts?</AlertDialogTitle>
              <AlertDialogDescription>Это только отзовёт токен в приложении. Ваши контакты в Google останутся нетронутыми.</AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction onClick={handleDisconnect}>Disconnect</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </header>

      <div className="flex flex-1 min-h-0">
        {/* Contact list */}
        <div className="w-72 shrink-0 border-r flex flex-col">
          {/* Search */}
          <div className="p-3 border-b">
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
              <Input
                className="pl-8 text-sm h-8"
                placeholder="Search contacts…"
                value={query}
                onChange={e => setQuery(e.target.value)}
              />
              {query && (
                <button className="absolute right-2 top-1/2 -translate-y-1/2" onClick={() => setQuery("")}>
                  <X className="h-3.5 w-3.5 text-muted-foreground" />
                </button>
              )}
            </div>
          </div>

          {/* List */}
          <ScrollArea className="flex-1">
            {loading && contacts.length === 0 ? (
              <div className="flex justify-center py-8"><Loader2 className="h-4 w-4 animate-spin text-muted-foreground" /></div>
            ) : contacts.length === 0 ? (
              <div className="text-center py-8 px-4 text-sm text-muted-foreground">
                {query ? "No contacts found" : "No contacts yet"}
              </div>
            ) : (
              <div className="py-1">
                {contacts.map((c, i) => {
                  const name = displayName(c);
                  const phone = c.phoneNumbers?.[0]?.value;
                  const email = c.emailAddresses?.[0]?.value;
                  const isSelected = selected?.resourceName === c.resourceName;
                  return (
                    <div
                      key={c.resourceName ?? i}
                      onClick={() => setSelected(c)}
                      className={`flex items-center gap-3 px-3 py-2.5 cursor-pointer hover:bg-accent transition-colors ${isSelected ? "bg-accent" : ""}`}
                    >
                      <div className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-semibold shrink-0 uppercase ${avatarColor(name)}`}>
                        {initials(c) || <User className="h-3.5 w-3.5" />}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium truncate">{name}</p>
                        <p className="text-[11px] text-muted-foreground truncate">{phone ?? email ?? ""}</p>
                      </div>
                    </div>
                  );
                })}
                {nextPageToken && (
                  <div className="px-3 py-2">
                    <Button variant="ghost" size="sm" className="w-full text-xs" onClick={() => loadContacts(query, nextPageToken)} disabled={loading}>
                      {loading ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : <RefreshCw className="h-3 w-3 mr-1" />}
                      Load more
                    </Button>
                  </div>
                )}
              </div>
            )}
          </ScrollArea>
        </div>

        {/* Detail panel */}
        <div className="flex-1 min-w-0">
          {!selected ? (
            <div className="flex h-full items-center justify-center text-center text-muted-foreground">
              <div className="space-y-2">
                <User className="h-10 w-10 mx-auto opacity-30" />
                <p className="text-sm">Select a contact to view details</p>
              </div>
            </div>
          ) : (
            <ContactDetail
              contact={selected}
              onUpdate={handleUpdate}
              onDelete={() => handleDelete(selected)}
            />
          )}
        </div>
      </div>
    </div>
  );
}

// ── Contact detail ─────────────────────────────────────────────────────────────
function ContactDetail({
  contact, onUpdate, onDelete,
}: {
  contact: GooglePerson;
  onUpdate: (data: ContactPayload) => Promise<void>;
  onDelete: () => void;
}) {
  const name = displayName(contact);
  const phones = contact.phoneNumbers ?? [];
  const emails = contact.emailAddresses ?? [];
  const orgs = contact.organizations ?? [];
  const addrs = contact.addresses ?? [];
  const notes = contact.biographies ?? [];
  const photo = contact.photos?.[0]?.url;

  return (
    <div className="h-full flex flex-col">
      {/* Contact header */}
      <div className="flex items-center gap-4 px-6 py-5 border-b">
        {photo ? (
          <img src={photo} alt={name} className="w-14 h-14 rounded-full object-cover" />
        ) : (
          <div className={`w-14 h-14 rounded-full flex items-center justify-center text-lg font-semibold uppercase ${avatarColor(name)}`}>
            {initials(contact) || <User className="h-6 w-6" />}
          </div>
        )}
        <div className="flex-1 min-w-0">
          <h2 className="text-xl font-semibold truncate">{name}</h2>
          {orgs[0]?.name && <p className="text-sm text-muted-foreground">{orgs[0].name}{orgs[0].title ? ` · ${orgs[0].title}` : ""}</p>}
        </div>
        <div className="flex items-center gap-2">
          <ContactFormDialog initial={contact} onSave={onUpdate} trigger={
            <Button variant="outline" size="sm" className="gap-1.5"><Pencil className="h-3.5 w-3.5" /> Edit</Button>
          } />
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button variant="outline" size="sm" className="gap-1.5 text-destructive hover:text-destructive">
                <Trash2 className="h-3.5 w-3.5" /> Delete
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Delete {name}?</AlertDialogTitle>
                <AlertDialogDescription>Контакт будет удалён из Google Contacts. Это действие нельзя отменить.</AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction onClick={onDelete} className="bg-destructive hover:bg-destructive/90">Delete</AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      </div>

      <ScrollArea className="flex-1 px-6 py-4">
        <div className="space-y-4 max-w-lg">
          {phones.length > 0 && (
            <Section icon={<Phone className="h-4 w-4" />} label="Phone">
              {phones.map((p, i) => (
                <div key={i} className="flex items-center justify-between">
                  <a href={`tel:${p.value}`} className="text-sm hover:underline">{p.value}</a>
                  {p.type && <Badge variant="secondary" className="text-[10px]">{p.type}</Badge>}
                </div>
              ))}
            </Section>
          )}
          {emails.length > 0 && (
            <Section icon={<Mail className="h-4 w-4" />} label="Email">
              {emails.map((e, i) => (
                <div key={i} className="flex items-center justify-between">
                  <a href={`mailto:${e.value}`} className="text-sm hover:underline">{e.value}</a>
                  {e.type && <Badge variant="secondary" className="text-[10px]">{e.type}</Badge>}
                </div>
              ))}
            </Section>
          )}
          {orgs.length > 0 && (
            <Section icon={<Building2 className="h-4 w-4" />} label="Organization">
              {orgs.map((o, i) => (
                <p key={i} className="text-sm">{o.name}{o.title ? ` — ${o.title}` : ""}</p>
              ))}
            </Section>
          )}
          {addrs.length > 0 && (
            <Section icon={<MapPin className="h-4 w-4" />} label="Address">
              {addrs.map((a, i) => <p key={i} className="text-sm whitespace-pre-line">{a.formattedValue}</p>)}
            </Section>
          )}
          {notes.length > 0 && notes[0].value && (
            <Section icon={<span className="text-xs">📝</span>} label="Note">
              <p className="text-sm whitespace-pre-wrap">{notes[0].value}</p>
            </Section>
          )}
          {!phones.length && !emails.length && !orgs.length && !addrs.length && (
            <p className="text-sm text-muted-foreground">No contact details available.</p>
          )}
        </div>
      </ScrollArea>
    </div>
  );
}

function Section({ icon, label, children }: { icon: React.ReactNode; label: string; children: React.ReactNode }) {
  return (
    <div className="flex gap-3">
      <div className="mt-0.5 text-muted-foreground">{icon}</div>
      <div className="flex-1 min-w-0">
        <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider mb-1">{label}</p>
        <div className="space-y-1">{children}</div>
      </div>
    </div>
  );
}
