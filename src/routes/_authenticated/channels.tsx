import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import { Bot, Check, CheckCircle2, Loader2, MessageCircle, Phone, Plug, Search, Send, ShieldAlert, UserRound } from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { EvolutionQuickConnect } from "@/components/onboarding/EvolutionQuickConnect";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useAccount } from "@/lib/account-context";
import { fetchEvolutionStatus } from "@/lib/evolution";
import { deleteDeployment, deployPersona, fetchDeployments, fetchPersonas, type Persona } from "@/lib/personas";
import { supabase } from "@/integrations/supabase/client";
import { fetchDebtors, formatBRL, type DebtorRow } from "@/lib/debtors";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/channels")({
  head: () => ({ meta: [
    { title: "Canais — cobrAI" },
    { name: "description", content: "Conecte o WhatsApp e escolha a agente responsável pelas mensagens." },
    { property: "og:title", content: "Canais — cobrAI" },
    { property: "og:description", content: "Conecte o WhatsApp e escolha a agente responsável pelas mensagens." },
    { property: "og:type", content: "website" },
    { name: "twitter:card", content: "summary" },
  ] }),
  component: ChannelsPage,
});

type WhatsAppChannel = { id: string; name: string; config: Record<string, string>; enabled: boolean };
type Inbox = { id: string; name: string };
type RecipientMode = "registered" | "new";

function ChannelsPage() {
  const { accountId, role } = useAccount();
  const [channel, setChannel] = useState<WhatsAppChannel | null>(null);
  const [inbox, setInbox] = useState<Inbox | null>(null);
  const [personas, setPersonas] = useState<Persona[]>([]);
  const [activePersonaId, setActivePersonaId] = useState<string | null>(null);
  const [deploymentId, setDeploymentId] = useState<number | null>(null);
  const [dailyBudget, setDailyBudget] = useState(100);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [connectOpen, setConnectOpen] = useState(false);
  const [recipientMode, setRecipientMode] = useState<RecipientMode>("registered");
  const [debtorQuery, setDebtorQuery] = useState("");
  const [debtorResults, setDebtorResults] = useState<DebtorRow[]>([]);
  const [selectedDebtor, setSelectedDebtor] = useState<DebtorRow | null>(null);
  const [searchingDebtors, setSearchingDebtors] = useState(false);
  const [testPhone, setTestPhone] = useState("");
  const [testMessage, setTestMessage] = useState("Olá! Aqui é a Bia, assistente virtual da POPMED. Podemos conversar sobre sua pendência?");
  const [sendingTest, setSendingTest] = useState(false);

  const load = useCallback(async () => {
    if (!accountId) { setLoading(false); return; }
    setLoading(true);
    try {
      const [{ data: channelData }, personaData] = await Promise.all([
        supabase.from("channels").select("id, name, config, enabled").eq("account_id", accountId).eq("channel_type", "whatsapp").maybeSingle(),
        fetchPersonas(accountId),
      ]);
      const nextChannel = channelData as WhatsAppChannel | null;
      setChannel(nextChannel);
      setPersonas(personaData.filter((persona) => persona.enabled && persona.status === "active"));
      if (!nextChannel) { setInbox(null); setActivePersonaId(null); setDeploymentId(null); return; }
      const { data: inboxData } = await supabase.from("inboxes").select("id, name").eq("channel_id", nextChannel.id).maybeSingle();
      const nextInbox = inboxData as Inbox | null;
      setInbox(nextInbox);
      if (nextInbox) {
        const deployments = await Promise.all(personaData.map((persona) => fetchDeployments(persona.id)));
        const active = deployments.flat().find((item) => item.inbox_id === nextInbox.id && item.enabled);
        setActivePersonaId(active?.persona_id ?? null);
        setDeploymentId(active?.id ?? null);
        setDailyBudget(active?.daily_message_budget ?? 100);
      }
    } catch (error) { toast.error(error instanceof Error ? error.message : "Não foi possível carregar os canais"); }
    finally { setLoading(false); }
  }, [accountId]);

  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    if (!accountId || recipientMode !== "registered" || selectedDebtor) return;
    const timer = window.setTimeout(async () => {
      setSearchingDebtors(true);
      try {
        const result = await fetchDebtors(accountId, { q: debtorQuery, limit: 8 });
        setDebtorResults(result.rows.filter((debtor) => debtor.phone_number));
      } catch {
        setDebtorResults([]);
      } finally {
        setSearchingDebtors(false);
      }
    }, 250);
    return () => window.clearTimeout(timer);
  }, [accountId, debtorQuery, recipientMode, selectedDebtor]);

  const connected = channel?.config?.evolution_instance_status === "connected";
  const recipientPhone = recipientMode === "registered" ? selectedDebtor?.phone_number ?? "" : testPhone;

  function changeRecipientMode(mode: RecipientMode) {
    setRecipientMode(mode);
    setSelectedDebtor(null);
    setDebtorQuery("");
    setDebtorResults([]);
    setTestPhone("");
  }

  function selectDebtor(debtor: DebtorRow) {
    setSelectedDebtor(debtor);
    setDebtorQuery("");
    setDebtorResults([]);
  }

  async function refreshConnection() {
    if (!channel) return;
    const result = await fetchEvolutionStatus(channel.id);
    if (result.error) toast.error(result.error);
    else if (result.status === "connected") toast.success("WhatsApp conectado");
    else toast.info("WhatsApp ainda não está conectado");
    await load();
  }

  async function togglePersona(personaId: string, enabled: boolean) {
    if (!accountId || !inbox || !connected) return;
    setSaving(true);
    try {
      if (!enabled) {
        if (deploymentId) await deleteDeployment(deploymentId);
        setActivePersonaId(null); setDeploymentId(null);
        toast.success("Respostas automáticas desativadas");
      } else {
        if (deploymentId) await deleteDeployment(deploymentId);
        const created = await deployPersona({ personaId, accountId, inboxId: inbox.id, autonomy: "auto", mode: "always", confidenceThreshold: 0.7, dailyMessageBudget: dailyBudget });
        setActivePersonaId(personaId); setDeploymentId(created.id);
        toast.success("Agente ativada no WhatsApp");
      }
    } catch (error) { toast.error(error instanceof Error ? error.message : "Não foi possível salvar"); }
    finally { setSaving(false); }
  }

  async function sendTestMessage() {
    if (!accountId || !recipientPhone.trim() || !testMessage.trim()) return;
    setSendingTest(true);
    try {
      const { data, error } = await supabase.functions.invoke("chat-send-message", {
        body: { account_id: accountId, phone: recipientPhone, content: testMessage },
      });
      const result = data as { ok?: boolean; error?: string } | null;
      if (error || !result?.ok) throw new Error(result?.error ?? error?.message ?? "Não foi possível enviar");
      toast.success("Mensagem enviada pela Bia");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Não foi possível enviar");
    } finally {
      setSendingTest(false);
    }
  }

  return <div className="flex flex-col">
    <PageHeader eyebrow="Configuração" title="Canais" description="Conecte cada canal separadamente e escolha onde a agente responde." />
    <div className="space-y-6 px-6 py-6">
      <section className="rounded-lg border border-border bg-card p-5">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-3"><div className="rounded-md bg-emerald-500/10 p-2 text-emerald-500"><MessageCircle className="h-5 w-5" /></div><div><h2 className="font-semibold">WhatsApp via Evolution</h2><p className="mt-1 text-sm text-muted-foreground">{connected ? "Conectada e pronta para mensagens" : channel ? "Com problema ou aguardando pareamento" : "Não configurada"}</p></div></div>
          <div className="flex gap-2">{channel && <Button variant="outline" onClick={refreshConnection}>Verificar conexão</Button>}<Button onClick={() => setConnectOpen(true)} disabled={role !== "admin"}><Plug />{channel ? "Reconectar" : "Conectar"}</Button></div>
        </div>
        <div className="mt-4 flex items-center gap-2 border-t border-border pt-4 text-xs text-muted-foreground">{connected ? <CheckCircle2 className="h-4 w-4 text-emerald-500" /> : <ShieldAlert className="h-4 w-4 text-amber-500" />}{connected ? "Conexão confirmada pelo servidor Evolution" : "O envio permanece desativado até a conexão ser confirmada"}</div>
      </section>
      <section className="rounded-lg border border-border bg-card p-5">
        <div className="mb-4 flex items-center gap-3"><Bot className="h-5 w-5 text-primary" /><div><h2 className="font-semibold">Agente de mensagens</h2><p className="text-sm text-muted-foreground">Ative uma agente somente depois de conectar o WhatsApp.</p></div></div>
        {loading ? <Loader2 className="h-5 w-5 animate-spin text-primary" /> : personas.length === 0 ? <p className="text-sm text-muted-foreground">Nenhuma agente ativa disponível.</p> : <div className="space-y-3">
          {personas.map((persona) => <div key={persona.id} className="flex items-center justify-between rounded-md border border-border p-3"><div><p className="text-sm font-medium">{persona.name}</p><p className="text-xs text-muted-foreground">{activePersonaId === persona.id ? "Ativa no WhatsApp" : "Somente ligações ou inativa neste canal"}</p></div><Switch checked={activePersonaId === persona.id} disabled={!connected || !inbox || saving || role !== "admin"} onCheckedChange={(checked) => void togglePersona(persona.id, checked)} aria-label={`Ativar ${persona.name} no WhatsApp`} /></div>)}
          <div className="max-w-xs space-y-1.5 pt-2"><Label htmlFor="daily-budget">Limite diário de respostas</Label><Input id="daily-budget" type="number" min={1} max={1000} value={dailyBudget} disabled={!!activePersonaId || !connected} onChange={(event) => setDailyBudget(Math.max(1, Math.min(1000, Number(event.target.value) || 1)))} /><p className="text-xs text-muted-foreground">Para alterar, desative a agente e ative novamente.</p></div>
        </div>}
      </section>
      <section className="rounded-lg border border-border bg-card p-5">
        <div className="mb-4 flex items-center gap-3"><Send className="h-5 w-5 text-primary" /><div><h2 className="font-semibold">Enviar mensagem</h2><p className="text-sm text-muted-foreground">Escolha um devedor da carteira ou informe um número novo.</p></div></div>
        <div className="mb-4 inline-flex rounded-md border border-border bg-muted/30 p-1">
          <Button type="button" size="sm" variant={recipientMode === "registered" ? "default" : "ghost"} onClick={() => changeRecipientMode("registered")} disabled={sendingTest}>
            <UserRound className="h-4 w-4" /> Devedor cadastrado
          </Button>
          <Button type="button" size="sm" variant={recipientMode === "new" ? "default" : "ghost"} onClick={() => changeRecipientMode("new")} disabled={sendingTest}>
            <Phone className="h-4 w-4" /> Número novo
          </Button>
        </div>
        <div className="grid gap-4 md:grid-cols-[minmax(280px,0.6fr)_minmax(320px,1fr)_auto] md:items-end">
          {recipientMode === "registered" ? (
            <div className="space-y-1.5">
              <Label htmlFor="debtor-search">Devedor</Label>
              {selectedDebtor ? (
                <div className="flex min-h-10 items-center justify-between gap-3 rounded-md border border-border bg-background px-3 py-2">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{selectedDebtor.name ?? "Sem nome"}</p>
                    <p className="truncate text-xs text-muted-foreground">{selectedDebtor.phone_number} · {formatBRL(selectedDebtor.valor_aberto)} em aberto</p>
                  </div>
                  <Button type="button" size="sm" variant="ghost" onClick={() => setSelectedDebtor(null)} disabled={sendingTest}>Trocar</Button>
                </div>
              ) : (
                <div className="relative">
                  <Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
                  <Input id="debtor-search" value={debtorQuery} onChange={(event) => setDebtorQuery(event.target.value)} placeholder="Buscar por nome ou telefone" className="pl-9" disabled={!connected || !activePersonaId || sendingTest} autoComplete="off" />
                  {(searchingDebtors || debtorResults.length > 0) && (
                    <div className="absolute z-20 mt-1 max-h-64 w-full overflow-y-auto rounded-md border border-border bg-popover p-1 shadow-md">
                      {searchingDebtors ? <div className="flex items-center justify-center py-4"><Loader2 className="h-4 w-4 animate-spin text-primary" /></div> : debtorResults.map((debtor) => (
                        <Button key={debtor.contact_id} type="button" variant="ghost" className="h-auto w-full justify-start px-2 py-2 text-left" onClick={() => selectDebtor(debtor)}>
                          <Check className="h-4 w-4 opacity-0" />
                          <span className="min-w-0"><span className="block truncate text-sm font-medium">{debtor.name ?? "Sem nome"}</span><span className="block truncate text-xs font-normal text-muted-foreground">{debtor.phone_number} · {formatBRL(debtor.valor_aberto)} em aberto</span></span>
                        </Button>
                      ))}
                    </div>
                  )}
                  {!searchingDebtors && debtorQuery.trim() && debtorResults.length === 0 && <p className="mt-1.5 text-xs text-muted-foreground">Nenhum devedor com telefone encontrado.</p>}
                </div>
              )}
            </div>
          ) : (
            <div className="space-y-1.5"><Label htmlFor="test-phone">WhatsApp do devedor</Label><Input id="test-phone" inputMode="tel" placeholder="5548999999999" value={testPhone} onChange={(event) => setTestPhone(event.target.value)} disabled={!connected || !activePersonaId || sendingTest} /></div>
          )}
          <div className="space-y-1.5"><Label htmlFor="test-message">Mensagem</Label><Textarea id="test-message" value={testMessage} onChange={(event) => setTestMessage(event.target.value)} disabled={!connected || !activePersonaId || sendingTest} className="min-h-[72px] resize-none" /></div>
          <Button onClick={() => void sendTestMessage()} disabled={!connected || !activePersonaId || !recipientPhone.trim() || !testMessage.trim() || sendingTest || role !== "admin"} className="md:mb-0.5">{sendingTest ? <Loader2 className="animate-spin" /> : <Send />}Enviar</Button>
        </div>
        {!activePersonaId && <p className="mt-3 text-xs text-muted-foreground">Ative a Bia acima para liberar o envio.</p>}
      </section>
      <p className="text-sm text-muted-foreground">As campanhas de WhatsApp ficam em <a href="/voice-campaigns?tab=whatsapp" className="text-primary underline underline-offset-2">Campanhas → WhatsApp</a>.</p>
    </div>
    {accountId && <EvolutionQuickConnect open={connectOpen} onOpenChange={setConnectOpen} accountId={accountId} onConnected={() => void load()} />}
  </div>;
}