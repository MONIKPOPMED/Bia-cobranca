import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import {
  Search, Send, Loader2, MessageCircle, Bot, User as UserIcon,
  Pause, Play, Phone, RefreshCw,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAccount } from "@/lib/account-context";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/chat")({
  head: () => ({
    meta: [
      { title: "Chat ao Vivo — cobrAI" },
      { name: "description", content: "Acompanhe e responda mensagens WhatsApp em tempo real." },
    ],
  }),
  component: LiveChatPage,
});

type ConversationRow = {
  id: string;
  account_id: string;
  inbox_id: string;
  contact_id: string;
  status: number;
  last_activity_at: string;
  additional_attributes: Record<string, unknown> | null;
};

type ConversationListItem = ConversationRow & {
  contact_name: string | null;
  contact_phone: string | null;
  last_message: string | null;
  last_message_at: string | null;
  last_sender_type: string | null;
  unread_count: number;
};

type MessageRow = {
  id: string;
  conversation_id: string;
  content: string | null;
  message_type: number;
  sender_type: string | null;
  sender_id: string | null;
  created_at: string;
  private: boolean;
};

function formatTime(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  const today = new Date();
  if (d.toDateString() === today.toDateString()) {
    return d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
  }
  return d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });
}

function initials(name: string | null | undefined): string {
  if (!name) return "?";
  return name
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? "")
    .join("") || "?";
}

function LiveChatPage() {
  const { accountId } = useAccount();
  const [conversations, setConversations] = useState<ConversationListItem[]>([]);
  const [loadingList, setLoadingList] = useState(true);
  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [messages, setMessages] = useState<MessageRow[]>([]);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [sending, setSending] = useState(false);
  const [draft, setDraft] = useState("");
  const [contactDetail, setContactDetail] = useState<{ name: string | null; phone: string | null; identifier: string | null } | null>(null);
  const [aiPaused, setAiPaused] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement | null>(null);

  const selected = useMemo(
    () => conversations.find((c) => c.id === selectedId) ?? null,
    [conversations, selectedId],
  );

  // Load conversation list (whatsapp inbox only)
  const loadConversations = useCallback(async () => {
    if (!accountId) return;
    setLoadingList(true);
    try {
      // 1) get whatsapp inbox ids
      const { data: inboxes } = await supabase
        .from("inboxes")
        .select("id")
        .eq("account_id", accountId)
        .eq("channel_type", "whatsapp");
      const inboxIds = (inboxes ?? []).map((i) => i.id);
      if (inboxIds.length === 0) {
        setConversations([]);
        return;
      }

      const { data: convs } = await supabase
        .from("conversations")
        .select("id, account_id, inbox_id, contact_id, status, last_activity_at, additional_attributes")
        .eq("account_id", accountId)
        .in("inbox_id", inboxIds)
        .order("last_activity_at", { ascending: false })
        .limit(80);
      const rows = (convs ?? []) as ConversationRow[];

      const contactIds = Array.from(new Set(rows.map((r) => r.contact_id).filter(Boolean)));
      const { data: contacts } = contactIds.length
        ? await supabase
            .from("contacts")
            .select("id, name, phone_number")
            .in("id", contactIds)
        : { data: [] as any[] };
      const cMap = new Map((contacts ?? []).map((c: any) => [c.id, c]));

      // last message per conv (one query, then group client-side)
      const convIds = rows.map((r) => r.id);
      const { data: lastMsgs } = convIds.length
        ? await supabase
            .from("messages")
            .select("conversation_id, content, sender_type, created_at")
            .in("conversation_id", convIds)
            .order("created_at", { ascending: false })
            .limit(convIds.length * 4)
        : { data: [] as any[] };
      const lastMap = new Map<string, any>();
      for (const m of lastMsgs ?? []) {
        if (!lastMap.has(m.conversation_id)) lastMap.set(m.conversation_id, m);
      }

      // Conversations with no message at all (left by duplicated "@lid"
      // webhooks as "WhatsApp (sem número)") don't show — POPMED, 06/11.
      const semUltima = convIds.filter((id) => !lastMap.has(id));
      const comMensagem = new Set<string>(lastMap.keys());
      if (semUltima.length) {
        const { data: algum } = await supabase
          .from("messages")
          .select("conversation_id")
          .in("conversation_id", semUltima)
          .limit(2000);
        for (const m of algum ?? []) comMensagem.add(m.conversation_id);
      }

      const list: ConversationListItem[] = rows.filter((r) => comMensagem.has(r.id)).map((r) => {
        const c = cMap.get(r.contact_id);
        const lm = lastMap.get(r.id);
        return {
          ...r,
          contact_name: c?.name ?? null,
          contact_phone: c?.phone_number ?? null,
          last_message: lm?.content ?? null,
          last_message_at: lm?.created_at ?? r.last_activity_at,
          last_sender_type: lm?.sender_type ?? null,
          unread_count: 0,
        };
      });
      setConversations(list);
    } finally {
      setLoadingList(false);
    }
  }, [accountId]);

  useEffect(() => {
    loadConversations();
  }, [loadConversations]);

  // Realtime: refresh list when any new message arrives in this account
  useEffect(() => {
    if (!accountId) return;
    const channel = supabase
      .channel(`live-chat-list-${accountId}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "messages", filter: `account_id=eq.${accountId}` },
        () => loadConversations(),
      )
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "conversations", filter: `account_id=eq.${accountId}` },
        () => loadConversations(),
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [accountId, loadConversations]);

  // Load thread for the selected conversation
  const loadThread = useCallback(async (convId: string) => {
    setLoadingMessages(true);
    try {
      const { data } = await supabase
        .from("messages")
        .select("id, conversation_id, content, message_type, sender_type, sender_id, created_at, private")
        .eq("conversation_id", convId)
        .order("created_at", { ascending: true })
        .limit(300);
      setMessages((data ?? []) as MessageRow[]);
    } finally {
      setLoadingMessages(false);
    }
  }, []);

  useEffect(() => {
    if (!selectedId) {
      setMessages([]);
      setContactDetail(null);
      return;
    }
    loadThread(selectedId);

    // contact detail
    const c = conversations.find((x) => x.id === selectedId);
    if (c) {
      supabase
        .from("contacts")
        .select("name, phone_number, identifier")
        .eq("id", c.contact_id)
        .maybeSingle()
        .then(({ data }) => {
          setContactDetail({
            name: data?.name ?? null,
            phone: data?.phone_number ?? null,
            identifier: data?.identifier ?? null,
          });
        });
      const paused = (c.additional_attributes as any)?.ai_paused === true;
      setAiPaused(paused);
    }
  }, [selectedId, loadThread, conversations]);

  // Realtime thread
  useEffect(() => {
    if (!selectedId) return;
    const channel = supabase
      .channel(`live-chat-thread-${selectedId}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "messages", filter: `conversation_id=eq.${selectedId}` },
        (payload) => {
          setMessages((prev) => {
            const next = payload.new as MessageRow;
            if (prev.some((m) => m.id === next.id)) return prev;
            return [...prev, next];
          });
        },
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [selectedId]);

  // Auto-scroll
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length, selectedId]);

  const filteredConversations = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return conversations;
    return conversations.filter((c) => {
      return (
        (c.contact_name ?? "").toLowerCase().includes(q) ||
        (c.contact_phone ?? "").toLowerCase().includes(q) ||
        (c.last_message ?? "").toLowerCase().includes(q)
      );
    });
  }, [conversations, search]);

  const handleSend = async () => {
    if (!selectedId) return;
    const text = draft.trim();
    if (!text) return;
    setSending(true);
    try {
      const { data, error } = await supabase.functions.invoke("chat-send-message", {
        body: { conversation_id: selectedId, content: text },
      });
      if (error || (data as any)?.error) {
        const msg = (data as any)?.error ?? error?.message ?? "Erro ao enviar";
        toast.error(`Falha ao enviar: ${msg}`);
        return;
      }
      setDraft("");
    } catch (e: any) {
      toast.error(`Erro: ${e?.message ?? e}`);
    } finally {
      setSending(false);
    }
  };

  const toggleAiPaused = async () => {
    if (!selected) return;
    const next = !aiPaused;
    const newAttrs = {
      ...(selected.additional_attributes ?? {}),
      ai_paused: next,
    };
    const { error } = await supabase
      .from("conversations")
      .update({ additional_attributes: newAttrs })
      .eq("id", selected.id);
    if (error) {
      toast.error("Não foi possível alterar a IA");
      return;
    }
    setAiPaused(next);
    toast.success(next ? "IA pausada — você assumiu a conversa" : "IA reativada");
    loadConversations();
  };

  return (
    <div className="flex h-[calc(100vh-4rem)] min-h-0 w-full">
      {/* Column 1: conversation list */}
      <aside className="flex h-full w-[320px] shrink-0 flex-col border-r border-border bg-background">
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <div>
            <h2 className="text-sm font-semibold">Chat ao Vivo</h2>
            <p className="text-xs text-muted-foreground">{conversations.length} conversas</p>
          </div>
          <Button variant="ghost" size="icon" onClick={loadConversations} title="Atualizar">
            <RefreshCw className="h-4 w-4" />
          </Button>
        </div>
        <div className="border-b border-border px-3 py-2">
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Buscar nome, telefone ou mensagem"
              className="pl-8"
            />
          </div>
        </div>
        <ScrollArea className="flex-1">
          {loadingList ? (
            <div className="flex h-32 items-center justify-center">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : filteredConversations.length === 0 ? (
            <div className="px-4 py-12 text-center text-sm text-muted-foreground">
              Nenhuma conversa encontrada.
            </div>
          ) : (
            <ul className="divide-y divide-border/50">
              {filteredConversations.map((c) => (
                <li key={c.id}>
                  <button
                    onClick={() => setSelectedId(c.id)}
                    className={cn(
                      "flex w-full items-start gap-3 px-3 py-3 text-left transition-colors hover:bg-muted/50",
                      selectedId === c.id && "bg-muted",
                    )}
                  >
                    <Avatar className="h-9 w-9 shrink-0">
                      <AvatarFallback className="text-xs">
                        {initials(c.contact_name)}
                      </AvatarFallback>
                    </Avatar>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-baseline justify-between gap-2">
                        <span className="truncate text-sm font-medium">
                          {c.contact_name ?? c.contact_phone ?? "Sem nome"}
                        </span>
                        <span className="shrink-0 text-[10px] text-muted-foreground">
                          {formatTime(c.last_message_at)}
                        </span>
                      </div>
                      <div className="flex items-center gap-1.5">
                        {c.last_sender_type === "User" && (
                          <UserIcon className="h-3 w-3 shrink-0 text-muted-foreground" />
                        )}
                        {c.last_sender_type === "AgentBot" && (
                          <Bot className="h-3 w-3 shrink-0 text-primary" />
                        )}
                        <p className="truncate text-xs text-muted-foreground">
                          {c.last_message ?? "—"}
                        </p>
                      </div>
                      {(c.additional_attributes as any)?.ai_paused === true && (
                        <Badge variant="outline" className="mt-1 h-4 px-1.5 text-[9px]">
                          IA pausada
                        </Badge>
                      )}
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </ScrollArea>
      </aside>

      {/* Column 2: thread */}
      <section className="flex h-full min-w-0 flex-1 flex-col bg-muted/20">
        {!selected ? (
          <div className="flex h-full flex-col items-center justify-center text-center">
            <MessageCircle className="mb-3 h-12 w-12 text-muted-foreground/40" />
            <p className="text-sm text-muted-foreground">Selecione uma conversa para começar</p>
          </div>
        ) : (
          <>
            <header className="flex items-center justify-between border-b border-border bg-background px-5 py-3">
              <div className="flex items-center gap-3">
                <Avatar className="h-9 w-9">
                  <AvatarFallback className="text-xs">
                    {initials(contactDetail?.name ?? selected.contact_name)}
                  </AvatarFallback>
                </Avatar>
                <div>
                  <div className="text-sm font-semibold">
                    {contactDetail?.name ?? selected.contact_name ?? "Sem nome"}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {contactDetail?.phone ?? selected.contact_phone ?? "—"}
                  </div>
                </div>
              </div>
              <Button
                variant={aiPaused ? "default" : "outline"}
                size="sm"
                onClick={toggleAiPaused}
                className="gap-2"
              >
                {aiPaused ? (
                  <>
                    <Play className="h-3.5 w-3.5" />
                    Reativar IA
                  </>
                ) : (
                  <>
                    <Pause className="h-3.5 w-3.5" />
                    Pausar IA / assumir
                  </>
                )}
              </Button>
            </header>

            <ScrollArea className="flex-1">
              <div className="mx-auto w-full max-w-3xl space-y-2 px-5 py-6">
                {loadingMessages ? (
                  <div className="flex justify-center py-12">
                    <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                  </div>
                ) : messages.length === 0 ? (
                  <p className="py-12 text-center text-sm text-muted-foreground">
                    Sem mensagens ainda.
                  </p>
                ) : (
                  messages.map((m) => <MessageBubble key={m.id} message={m} />)
                )}
                <div ref={messagesEndRef} />
              </div>
            </ScrollArea>

            <footer className="border-t border-border bg-background px-5 py-3">
              {!aiPaused && (
                <p className="mb-2 text-[11px] text-amber-600 dark:text-amber-400">
                  ⚠️ A IA está respondendo automaticamente. Pause-a se quiser conduzir manualmente.
                </p>
              )}
              <div className="flex items-end gap-2">
                <textarea
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      handleSend();
                    }
                  }}
                  rows={2}
                  placeholder="Digite sua mensagem... (Enter envia, Shift+Enter quebra linha)"
                  className="min-h-[44px] flex-1 resize-none rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                  disabled={sending}
                />
                <Button onClick={handleSend} disabled={sending || !draft.trim()} className="gap-2">
                  {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                  Enviar
                </Button>
              </div>
            </footer>
          </>
        )}
      </section>

      {/* Column 3: contact panel */}
      {selected && (
        <aside className="hidden h-full w-[280px] shrink-0 flex-col border-l border-border bg-background xl:flex">
          <div className="border-b border-border px-5 py-4">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Contato
            </h3>
          </div>
          <div className="space-y-4 px-5 py-4">
            <div>
              <div className="text-[11px] uppercase tracking-wide text-muted-foreground">Nome</div>
              <div className="text-sm font-medium">{contactDetail?.name ?? "—"}</div>
            </div>
            <div>
              <div className="text-[11px] uppercase tracking-wide text-muted-foreground">Telefone</div>
              <div className="flex items-center gap-2 text-sm">
                <Phone className="h-3.5 w-3.5 text-muted-foreground" />
                {contactDetail?.phone ?? "—"}
              </div>
            </div>
            <div>
              <div className="text-[11px] uppercase tracking-wide text-muted-foreground">Identificador</div>
              <div className="break-all text-xs text-muted-foreground">
                {contactDetail?.identifier ?? "—"}
              </div>
            </div>
            <div>
              <div className="text-[11px] uppercase tracking-wide text-muted-foreground">Total mensagens</div>
              <div className="text-sm">{messages.length}</div>
            </div>
            <div>
              <div className="text-[11px] uppercase tracking-wide text-muted-foreground">IA</div>
              <Badge variant={aiPaused ? "destructive" : "secondary"}>
                {aiPaused ? "Pausada" : "Ativa"}
              </Badge>
            </div>
          </div>
        </aside>
      )}
    </div>
  );
}

function MessageBubble({ message }: { message: MessageRow }) {
  // message_type: 0 = incoming (Contact), 1 = outgoing (User/AgentBot)
  const isOutgoing = message.message_type === 1;
  const isBot = message.sender_type === "AgentBot";
  const isOperator = message.sender_type === "User";

  return (
    <div className={cn("flex w-full", isOutgoing ? "justify-end" : "justify-start")}>
      <div
        className={cn(
          "max-w-[75%] rounded-2xl px-3.5 py-2 text-sm shadow-sm",
          isOutgoing
            ? isBot
              ? "bg-primary/15 text-foreground"
              : "bg-primary text-primary-foreground"
            : "bg-background text-foreground border border-border",
        )}
      >
        {isOutgoing && (
          <div className="mb-0.5 flex items-center gap-1 text-[10px] opacity-80">
            {isBot ? <Bot className="h-3 w-3" /> : <UserIcon className="h-3 w-3" />}
            <span>{isBot ? "IA" : isOperator ? "Operador" : "Saída"}</span>
          </div>
        )}
        <div className="whitespace-pre-wrap break-words">{message.content ?? "—"}</div>
        <div className={cn("mt-1 text-[10px]", isOutgoing ? "opacity-70" : "text-muted-foreground")}>
          {formatTime(message.created_at)}
        </div>
      </div>
    </div>
  );
}
