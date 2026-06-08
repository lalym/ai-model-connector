import { useState, useEffect, useRef } from "react";
import { useLocation } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import { Send, LogOut, Check, ChevronRight } from "lucide-react";
import { 
  useGetAuthMe, 
  getGetAuthMeQueryKey,
  useGoogleAuthStart,
  useLogout,
  useParseContact,
  useCreateContact,
  useUpdateContact,
  ParsedContact 
} from "@workspace/api-client-react";

import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

type Message = {
  id: string;
  type: "user" | "system" | "contact_card" | "success" | "correction_card";
  content?: string;
  contact?: ParsedContact;
  resourceName?: string;
};

export default function Home() {
  const [location, setLocation] = useLocation();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState<Message[]>([]);
  const [lastParsedContact, setLastParsedContact] = useState<ParsedContact | null>(null);
  const [lastResourceName, setLastResourceName] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  
  // Auth handling
  const { data: user, isLoading: isAuthLoading } = useGetAuthMe({
    query: { queryKey: getGetAuthMeQueryKey() }
  });
  
  const googleAuthStart = useGoogleAuthStart({
    query: { enabled: false }
  });
  
  const logout = useLogout();

  // Mutations
  const parseContact = useParseContact();
  const createContact = useCreateContact();
  const updateContact = useUpdateContact();

  // Handle OAuth callbacks
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("auth") === "success") {
      toast({ title: "Successfully connected Google account." });
      window.history.replaceState({}, document.title, window.location.pathname);
    } else if (params.get("error") === "auth_failed") {
      toast({ title: "Failed to connect Google account.", variant: "destructive" });
      window.history.replaceState({}, document.title, window.location.pathname);
    }
  }, [toast]);

  // Scroll to bottom of chat
  useEffect(() => {
    if (messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [messages]);

  const handleLogin = async () => {
    try {
      const result = await googleAuthStart.refetch();
      if (result.data?.url) {
        window.location.href = result.data.url;
      }
    } catch (e) {
      toast({ title: "Failed to start Google Auth.", variant: "destructive" });
    }
  };

  const handleLogout = () => {
    logout.mutate(undefined, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getGetAuthMeQueryKey() });
        setMessages([]);
        setLastParsedContact(null);
        setLastResourceName(null);
        toast({ title: "Disconnected Google account." });
      }
    });
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim()) return;

    const text = input.trim();
    setInput("");
    
    // Add user message
    const msgId = Date.now().toString();
    setMessages(prev => [...prev, { id: msgId, type: "user", content: text }]);
    
    // If we have a saved contact, we might be correcting it
    if (lastResourceName && lastParsedContact) {
      updateContact.mutate({
        data: {
          resourceName: lastResourceName,
          correction: text,
          currentContact: lastParsedContact
        }
      }, {
        onSuccess: (data) => {
          setLastParsedContact(data.contact);
          setMessages(prev => [...prev, { 
            id: Date.now().toString(), 
            type: "correction_card", 
            contact: data.contact,
            resourceName: data.resourceName
          }]);
        },
        onError: () => {
          setMessages(prev => [...prev, { id: Date.now().toString(), type: "system", content: "Failed to update contact. Please try again." }]);
        }
      });
    } else {
      // Parse new contact
      parseContact.mutate({ data: { text } }, {
        onSuccess: (contact) => {
          setLastParsedContact(contact);
          setMessages(prev => [...prev, { 
            id: Date.now().toString(), 
            type: "contact_card", 
            contact 
          }]);
        },
        onError: () => {
          setMessages(prev => [...prev, { id: Date.now().toString(), type: "system", content: "Failed to parse contact. Please try again with different text." }]);
        }
      });
    }
  };

  const handleSaveContact = (contact: ParsedContact) => {
    createContact.mutate({ data: contact }, {
      onSuccess: (data) => {
        setLastResourceName(data.resourceName);
        setLastParsedContact(data.contact);
        setMessages(prev => [...prev, { 
          id: Date.now().toString(), 
          type: "success", 
          content: `${contact.givenName || ''} ${contact.familyName || ''}`.trim() + " saved to Google Contacts ✓" 
        }]);
      },
      onError: () => {
        toast({ title: "Failed to save contact.", variant: "destructive" });
      }
    });
  };

  if (isAuthLoading) {
    return (
      <div className="flex h-screen items-center justify-center bg-background">
        <Skeleton className="h-32 w-64 rounded-xl" />
      </div>
    );
  }

  // Not connected state
  if (!user) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center bg-background px-4">
        <div className="max-w-md text-center space-y-6">
          <div className="space-y-2">
            <h1 className="text-3xl font-semibold tracking-tight text-foreground">Contact Importer</h1>
            <p className="text-muted-foreground text-lg">
              Paste email signatures or business cards to cleanly save them to Google Contacts.
            </p>
          </div>
          <Button 
            size="lg" 
            className="w-full text-md h-12" 
            onClick={handleLogin}
            disabled={googleAuthStart.isFetching}
          >
            Connect Google Account
            <ChevronRight className="ml-2 h-4 w-4" />
          </Button>
        </div>
      </div>
    );
  }

  // Connected state
  return (
    <div className="flex flex-col h-[100dvh] bg-background md:bg-muted/30">
      <div className="w-full max-w-3xl mx-auto flex flex-col h-full bg-background md:border-x md:shadow-sm relative">
        
        {/* Header */}
        <header className="flex items-center justify-between px-6 py-4 border-b bg-background/95 backdrop-blur z-10 sticky top-0">
          <div className="font-medium text-foreground tracking-tight">Importer</div>
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2">
              <Avatar className="h-8 w-8">
                {user.picture ? <AvatarImage src={user.picture} /> : null}
                <AvatarFallback>{user.name?.charAt(0).toUpperCase() || 'U'}</AvatarFallback>
              </Avatar>
              <span className="text-sm font-medium hidden sm:inline-block">{user.name}</span>
            </div>
            <Button variant="ghost" size="sm" onClick={handleLogout} className="text-muted-foreground hover:text-foreground">
              <LogOut className="h-4 w-4 mr-2" />
              Disconnect
            </Button>
          </div>
        </header>

        {/* Chat Area */}
        <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-6">
          {messages.length === 0 && (
            <div className="flex flex-col items-center justify-center h-full text-center space-y-3 opacity-70">
              <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center text-primary">
                <ChevronRight className="h-6 w-6" />
              </div>
              <p className="text-muted-foreground max-w-sm">
                Paste any unstructured contact info here. <br/>
                "John Doe, CEO of Acme. john@acme.com"
              </p>
            </div>
          )}

          {messages.map((msg) => (
            <div key={msg.id} className={`flex flex-col ${msg.type === 'user' ? 'items-end' : 'items-start'}`}>
              
              {msg.type === 'user' && (
                <div className="bg-primary text-primary-foreground px-4 py-2 rounded-2xl rounded-tr-sm max-w-[85%] text-sm shadow-sm whitespace-pre-wrap">
                  {msg.content}
                </div>
              )}

              {msg.type === 'system' && (
                <div className="bg-muted text-muted-foreground px-4 py-2 rounded-2xl rounded-tl-sm max-w-[85%] text-sm">
                  {msg.content}
                </div>
              )}

              {msg.type === 'success' && (
                <div className="bg-emerald-50 text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-400 px-4 py-2 rounded-2xl rounded-tl-sm max-w-[85%] text-sm font-medium border border-emerald-100 dark:border-emerald-900/50">
                  {msg.content}
                </div>
              )}

              {(msg.type === 'contact_card' || msg.type === 'correction_card') && msg.contact && (
                <div className="max-w-[90%] sm:max-w-[80%] w-full animate-in fade-in slide-in-from-bottom-2 duration-300">
                  <Card className="border shadow-sm">
                    <CardContent className="p-5 space-y-4">
                      {msg.type === 'correction_card' && (
                        <div className="text-xs font-medium text-primary mb-2">Updated Contact</div>
                      )}
                      
                      <div>
                        <h3 className="text-lg font-semibold text-foreground">
                          {msg.contact.givenName} {msg.contact.familyName}
                        </h3>
                        {(msg.contact.jobTitle || msg.contact.company) && (
                          <div className="text-sm text-muted-foreground mt-0.5">
                            {msg.contact.jobTitle} {msg.contact.jobTitle && msg.contact.company ? 'at' : ''} {msg.contact.company}
                          </div>
                        )}
                      </div>

                      <div className="space-y-2 text-sm">
                        {msg.contact.emails && msg.contact.emails.length > 0 && (
                          <div className="flex gap-2 text-foreground">
                            <span className="text-muted-foreground w-16">Email</span>
                            <div className="flex flex-col">
                              {msg.contact.emails.map((e, i) => <span key={i}>{e}</span>)}
                            </div>
                          </div>
                        )}
                        
                        {msg.contact.phones && msg.contact.phones.length > 0 && (
                          <div className="flex gap-2 text-foreground">
                            <span className="text-muted-foreground w-16">Phone</span>
                            <div className="flex flex-col">
                              {msg.contact.phones.map((p, i) => <span key={i}>{p}</span>)}
                            </div>
                          </div>
                        )}

                        {msg.contact.websites && msg.contact.websites.length > 0 && (
                          <div className="flex gap-2 text-foreground">
                            <span className="text-muted-foreground w-16">Web</span>
                            <div className="flex flex-col">
                              {msg.contact.websites.map((w, i) => <span key={i}>{w}</span>)}
                            </div>
                          </div>
                        )}

                        {msg.contact.notes && (
                          <div className="flex gap-2 text-foreground mt-3 pt-3 border-t">
                            <span className="text-muted-foreground w-16">Notes</span>
                            <div className="whitespace-pre-wrap">{msg.contact.notes}</div>
                          </div>
                        )}
                      </div>

                      {msg.type === 'contact_card' && (
                        <Button 
                          className="w-full mt-2" 
                          onClick={() => handleSaveContact(msg.contact!)}
                          disabled={createContact.isPending}
                        >
                          {createContact.isPending ? "Saving..." : "Save to Google Contacts"}
                        </Button>
                      )}
                    </CardContent>
                  </Card>
                </div>
              )}
            </div>
          ))}
          
          {(parseContact.isPending || updateContact.isPending) && (
            <div className="flex items-start">
              <div className="bg-muted text-muted-foreground px-4 py-3 rounded-2xl rounded-tl-sm max-w-[85%] text-sm flex items-center gap-2">
                <span className="flex gap-1">
                  <span className="animate-bounce inline-block">.</span>
                  <span className="animate-bounce inline-block" style={{ animationDelay: '0.2s' }}>.</span>
                  <span className="animate-bounce inline-block" style={{ animationDelay: '0.4s' }}>.</span>
                </span>
              </div>
            </div>
          )}
          
          <div ref={messagesEndRef} />
        </div>

        {/* Input Area */}
        <div className="p-4 bg-background border-t">
          <form onSubmit={handleSubmit} className="relative flex items-end gap-2 max-w-full">
            <Textarea 
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  handleSubmit(e);
                }
              }}
              placeholder={lastResourceName ? "Type a correction (e.g. 'Actually it's Acme Corp')" : "Paste contact text..."}
              className="min-h-[52px] w-full resize-none rounded-xl pr-12 py-3 bg-muted/50 border-transparent focus-visible:ring-1 focus-visible:ring-primary focus-visible:bg-background transition-colors"
              rows={1}
            />
            <Button 
              type="submit" 
              size="icon" 
              className="absolute right-2 bottom-2 h-9 w-9 rounded-lg"
              disabled={!input.trim() || parseContact.isPending || updateContact.isPending}
            >
              <Send className="h-4 w-4" />
              <span className="sr-only">Send</span>
            </Button>
          </form>
          <div className="text-center mt-2 text-[10px] text-muted-foreground">
            Press Enter to send, Shift+Enter for new line
          </div>
        </div>
      </div>
    </div>
  );
}
