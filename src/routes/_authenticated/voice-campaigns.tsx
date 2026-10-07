import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import {
  PhoneOutgoing,
  Play,
  Pause,
  X,
  Plus,
  Loader2,
  Users,
  PhoneCall,
  PhoneForwarded,
  Voicemail,
  AlertCircle,
  AlertTriangle,
  Headphones,
  Upload,
  FileSpreadsheet,
  CheckCircle2,
  Trash2,
  MessageCircle,
} from "lucide-react";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { WhatsAppCampaignsTab } from "@/components/channels/WhatsAppCampaignsTab";
import { toast } from "sonner";
import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
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
import { supabase } from "@/integrations/supabase/client";
import { useAccount } from "@/lib/account-context";
import { fetchPersonas, type Persona } from "@/lib/personas";
import { fetchPhoneNumbers, type PhoneNumber } from "@/lib/voice";
import {
  listVoiceCampaigns,
  startVoiceCampaign,
  pauseVoiceCampaign,
  resumeVoiceCampaign,
  cancelVoiceCampaign,
  deleteVoiceCampaign,
  type VoiceCampaign,
  type EscalationRule,
  type VoiceScriptMode,
} from "@/lib/voice-campaigns";
import { cn } from "@/lib/utils";
import { VoiceCampaignDetailDrawer } from "@/components/voice/VoiceCampaignDetailDrawer";

export const Route = createFileRoute("/_authenticated/voice-campaigns")({
  head: () => ({
    meta: [
      { title: "Campanhas — POPMED" },
      {
        name: "description",
        content:
          "Disparos outbound de voz com IA, script builder, escalonamento e dashboard ao vivo.",
      },
      { property: "og:title", content: "Campanhas de Voz — cobrAI" },
      {
        property: "og:description",
        content: "Crie e acompanhe campanhas de ligações em massa com agentes de voz.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: VoiceCampaignsPage,
});

type CampaignTab = "voz" | "whatsapp";

function VoiceCampaignsPage() {
  const { accountId, role } = useAccount();
  const [tab, setTab] = useState<CampaignTab>("voz");

  // ?tab=whatsapp (link from Canais). Read after mount so SSR and the first
  // client render match.
  useEffect(() => {
    if (new URLSearchParams(window.location.search).get("tab") === "whatsapp") setTab("whatsapp");
  }, []);
  const [campaigns, setCampaigns] = useState<VoiceCampaign[]>([]);
  const [loading, setLoading] = useState(true);
  const [createOpen, setCreateOpen] = useState(false);
  const [drawerCampaign, setDrawerCampaign] = useState<VoiceCampaign | null>(null);

  const load = async () => {
    if (!accountId) return;
    setLoading(true);
    try {
      setCampaigns(await listVoiceCampaigns(accountId));
    } catch (e: any) {
      toast.error("Não conseguimos carregar as campanhas. Tente novamente.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accountId]);

  // Realtime: progress updates live as the dispatcher places calls.
  useEffect(() => {
    if (!accountId) return;
    const channel = supabase
      .channel(`voice-campaigns:${accountId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "voice_campaigns",
          filter: `account_id=eq.${accountId}`,
        },
        () => load(),
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accountId]);

  return (
    <div className="flex flex-col">
      <PageHeader
        eyebrow="Campanhas"
        title="Campanhas"
        description={
          tab === "voz"
            ? "A Bia liga para os clientes e passa para alguém da equipe quando precisa."
            : "A Bia manda uma mensagem individual no WhatsApp usando os dados da dívida."
        }
        actions={
          tab === "voz" ? (
            <Button size="sm" onClick={() => setCreateOpen(true)}>
              <Plus className="mr-1 h-3.5 w-3.5" />
              Nova campanha
            </Button>
          ) : undefined
        }
      />

      <Tabs value={tab} onValueChange={(v) => setTab(v as CampaignTab)} className="px-6 pt-4">
        <TabsList>
          <TabsTrigger value="voz">
            <PhoneCall className="mr-1.5 h-3.5 w-3.5" />
            Ligações
          </TabsTrigger>
          <TabsTrigger value="whatsapp">
            <MessageCircle className="mr-1.5 h-3.5 w-3.5" />
            WhatsApp
          </TabsTrigger>
        </TabsList>
      </Tabs>

      {tab === "whatsapp" ? (
        <div className="px-6 py-6">
          {accountId && <WhatsAppCampaignsTab accountId={accountId} isAdmin={role === "admin"} />}
        </div>
      ) : (
      <div className="grid gap-3 px-6 py-6">
        {loading ? (
          <div className="py-12 text-center text-sm text-muted-foreground">
            <Loader2 className="mx-auto mb-2 h-5 w-5 animate-spin" />
            Carregando…
          </div>
        ) : campaigns.length === 0 ? (
          <div className="glass mx-auto max-w-md rounded-xl px-6 py-10 text-center">
            <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-violet-500/10 text-violet-300">
              <PhoneOutgoing className="h-5 w-5" />
            </div>
            <p className="text-base font-semibold">Nenhuma campanha de voz ainda</p>
            <p className="mt-1 text-sm text-muted-foreground">
              Antes de criar, conecte um número de telefone e escolha um agente que vai
              fazer as ligações.
            </p>
            <div className="mt-5 flex flex-wrap justify-center gap-2">
              <Button size="sm" onClick={() => setCreateOpen(true)}>
                <Plus className="mr-1.5 h-3.5 w-3.5" />
                Criar campanha
              </Button>
              <Button size="sm" variant="outline" asChild>
                <a href="/phone-numbers">Conectar número</a>
              </Button>
            </div>
          </div>
        ) : (
          campaigns.map((c) => <CampaignRow key={c.id} campaign={c} onReload={load} onOpen={() => setDrawerCampaign(c)} />)
        )}
      </div>
      )}

      <CreateCampaignDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        accountId={accountId ?? ""}
        onCreated={() => {
          setCreateOpen(false);
          load();
        }}
      />

      <VoiceCampaignDetailDrawer
        campaign={drawerCampaign}
        open={drawerCampaign !== null}
        onOpenChange={(o) => { if (!o) setDrawerCampaign(null); }}
        onChanged={load}
      />
    </div>
  );
}

function CampaignRow({ campaign, onReload, onOpen }: { campaign: VoiceCampaign; onReload: () => void; onOpen: () => void }) {
  const [deleting, setDeleting] = useState(false);
  const progress = campaign.contact_count > 0
    ? Math.round((campaign.placed_count / campaign.contact_count) * 100)
    : 0;
  const isActive = campaign.status === "running" || campaign.status === "scheduled";
  const isLive = campaign.status === "running";
  const isCanceled = campaign.status === "canceled";

  return (
    <div className="glass rounded-xl p-4 cursor-pointer hover:bg-white/[0.02] transition-colors" onClick={onOpen}>
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <p className="truncate text-sm font-semibold">{campaign.name}</p>
            {campaign.test_mode && (
              <span className="rounded border border-amber-500/40 bg-amber-500/10 px-1.5 py-0.5 text-[9px] font-semibold text-amber-300">
                TESTE
              </span>
            )}
            {isLive && (
              <span className="flex items-center gap-1 rounded-full border border-emerald-500/40 bg-emerald-500/10 px-1.5 py-0.5 text-[9px] font-semibold text-emerald-300">
                <span className="relative flex h-1.5 w-1.5">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
                  <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-emerald-500" />
                </span>
                AO VIVO
              </span>
            )}
            <Badge
              variant="outline"
              className={cn(
                "text-[10px]",
                campaign.status === "running" && "border-emerald-500/40 text-emerald-300",
                campaign.status === "completed" && "border-sky-500/40 text-sky-300",
                campaign.status === "failed" && "border-red-500/40 text-red-300",
                campaign.status === "canceled" && "border-red-500/40 text-red-300",
                campaign.status === "draft" && "border-white/20 text-muted-foreground",
              )}
            >
              {campaign.status}
            </Badge>
            <Badge variant="outline" className="text-[10px]">
              {campaign.script_mode}
            </Badge>
          </div>
          {campaign.description && (
            <p className="mt-1 line-clamp-1 text-xs text-muted-foreground">{campaign.description}</p>
          )}

          <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-5">
            <Stat icon={Users} label="Contatos" value={campaign.contact_count} />
            <Stat icon={PhoneCall} label="Ligadas" value={campaign.placed_count} accent="emerald" />
            <Stat icon={Headphones} label="Atendidas" value={campaign.connected_count} accent="sky" />
            <Stat icon={PhoneForwarded} label="Escaladas" value={campaign.escalated_count} accent="violet" />
            <Stat icon={AlertCircle} label="Falhas" value={campaign.failed_count} accent="red" />
          </div>

          <div className="mt-3 h-1 overflow-hidden rounded-full bg-white/[0.05]">
            <div
              className="h-full rounded-full bg-gradient-to-r from-fuchsia-500 to-violet-600 transition-all"
              style={{ width: `${progress}%` }}
            />
          </div>
          <p className="mt-1 text-[10px] text-muted-foreground">
            {isCanceled && campaign.canceled_after_placed != null
              ? `Cancelada após ${campaign.canceled_after_placed} chamada${campaign.canceled_after_placed === 1 ? "" : "s"}`
              : `${progress}% disparado`}
          </p>
        </div>

        <div className="flex gap-1" onClick={(e) => e.stopPropagation()}>
          {campaign.status === "running" && (
            <Button
              size="sm"
              variant="outline"
              onClick={async () => {
                await pauseVoiceCampaign(campaign.id);
                toast.success("pausada");
                onReload();
              }}
            >
              <Pause className="h-3 w-3" />
            </Button>
          )}
          {campaign.status === "paused" && (
            <Button
              size="sm"
              variant="outline"
              onClick={async () => {
                await resumeVoiceCampaign(campaign.id);
                toast.success("retomada");
                onReload();
              }}
            >
              <Play className="h-3 w-3" />
            </Button>
          )}
          {isActive && (
            <Button
              size="sm"
              variant="ghost"
              className="text-red-400 hover:text-red-300"
              onClick={async () => {
                if (!confirm("Cancelar campanha? Chamadas em curso serão abortadas.")) return;
                await cancelVoiceCampaign(campaign.id);
                toast.success("cancelada");
                onReload();
              }}
            >
              <X className="h-3 w-3" />
            </Button>
          )}
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button
                size="sm"
                variant="ghost"
                className="text-destructive hover:text-destructive"
                disabled={deleting}
                title="Excluir campanha"
              >
                {deleting ? <Loader2 className="h-3 w-3 animate-spin" /> : <Trash2 className="h-3 w-3" />}
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Excluir campanha “{campaign.name}”?</AlertDialogTitle>
                <AlertDialogDescription>
                  {campaign.placed_count > 0
                    ? "Esta campanha possui histórico de ligações e não pode ser excluída. Cancele-a para mantê-la apenas como histórico."
                    : isActive
                      ? "Pause ou cancele esta campanha antes de excluí-la."
                      : "A campanha e sua lista de contatos serão removidas. Essa ação não pode ser desfeita."}
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>{campaign.placed_count > 0 || isActive ? "Entendi" : "Cancelar"}</AlertDialogCancel>
                {campaign.placed_count === 0 && !isActive && (
                  <AlertDialogAction
                    className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                    onClick={async () => {
                      setDeleting(true);
                      try {
                        await deleteVoiceCampaign(campaign.id);
                        toast.success("Campanha excluída");
                        onReload();
                      } catch (error) {
                        toast.error(error instanceof Error ? error.message : "Não foi possível excluir a campanha");
                      } finally {
                        setDeleting(false);
                      }
                    }}
                  >
                    Excluir
                  </AlertDialogAction>
                )}
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      </div>
    </div>
  );
}

function Stat({
  icon: Icon,
  label,
  value,
  accent,
}: {
  icon: any;
  label: string;
  value: number;
  accent?: "emerald" | "sky" | "violet" | "red";
}) {
  const color = accent
    ? {
        emerald: "text-emerald-400",
        sky: "text-sky-400",
        violet: "text-violet-400",
        red: "text-red-400",
      }[accent]
    : "text-muted-foreground";
  return (
    <div className="flex items-center gap-2">
      <Icon className={cn("h-3.5 w-3.5", color)} />
      <div>
        <p className="text-sm font-semibold tabular-nums">{value}</p>
        <p className="text-[9px] uppercase tracking-wider text-muted-foreground">{label}</p>
      </div>
    </div>
  );
}

function CreateCampaignDialog({
  open,
  onOpenChange,
  accountId,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  accountId: string;
  onCreated: () => void;
}) {
  const [name, setName] = useState("");
  const [mode, setMode] = useState<VoiceScriptMode>("conversational");
  const [opening, setOpening] = useState("");
  const [systemPrompt, setSystemPrompt] = useState("");
  const [personaId, setPersonaId] = useState<string>("");
  const [phoneNumberId, setPhoneNumberId] = useState<string>("");
  const [voicemailDetection, setVoicemailDetection] = useState(true);
  const [recordCall, setRecordCall] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [testMode, setTestMode] = useState(false);

  // Tab state — Básico / Negociação / Audiência
  const [tab, setTab] = useState<"basico" | "negociacao" | "audiencia">("basico");

  // Regras de negociação (collection_config)
  const [discountPct, setDiscountPct] = useState<number>(10);
  const [maxInstallments, setMaxInstallments] = useState<number>(6);
  const [minInstallmentValue, setMinInstallmentValue] = useState<number>(50);
  const [firstDueMinDays, setFirstDueMinDays] = useState<number>(3);
  const [firstDueMaxDays, setFirstDueMaxDays] = useState<number>(10);
  const [respectDnc, setRespectDnc] = useState<boolean>(true);
  const [respectWindow, setRespectWindow] = useState<boolean>(true);
  const [skipHolidays, setSkipHolidays] = useState<boolean>(true);
  const [priorityBy, setPriorityBy] = useState<"valor_desc" | "atraso_desc" | "vencimento_asc">("valor_desc");

  // Quotas de disparo (vazio = sem limite)
  const [maxCallsDay, setMaxCallsDay] = useState<string>("");
  const [maxCallsWeek, setMaxCallsWeek] = useState<string>("");
  const [maxCallsMonth, setMaxCallsMonth] = useState<string>("");
  const [maxMsgsDay, setMaxMsgsDay] = useState<string>("");
  const [maxMsgsWeek, setMaxMsgsWeek] = useState<string>("");
  const [maxMsgsMonth, setMaxMsgsMonth] = useState<string>("");

  // Snapshot da carteira pra mostrar na aba (totais em aberto)
  const [walletSnapshot, setWalletSnapshot] = useState<{ count: number; total: number; loading: boolean }>({
    count: 0, total: 0, loading: true,
  });

  const [personas, setPersonas] = useState<Persona[]>([]);
  const [phoneNumbers, setPhoneNumbers] = useState<PhoneNumber[]>([]);
  const [contacts, setContacts] = useState<Array<{ id: string; name: string | null; phone_number: string | null }>>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState("");

  // CSV import state.
  const [audienceMode, setAudienceMode] = useState<"existing" | "csv">("existing");
  const [csvText, setCsvText] = useState("");
  const [csvRows, setCsvRows] = useState<CsvRow[]>([]);

  useEffect(() => {
    if (!open || !accountId) return;
    let cancelled = false;
    (async () => {
      const [pRes, nRes, cRes, dRes, settingsRes] = await Promise.all([
        fetchPersonas(accountId),
        fetchPhoneNumbers(accountId),
        supabase
          .from("contacts")
          .select("id, name, phone_number")
          .eq("account_id", accountId)
          .not("phone_number", "is", null)
          .order("last_activity_at", { ascending: false, nullsFirst: false })
          .limit(300),
        // Snapshot: dívidas em aberto (valor + count)
        (supabase as any)
          .from("debts")
          .select("valor_atual")
          .eq("account_id", accountId)
          .in("status", ["aberto", "em_negociacao"]),
        // Padrões da empresa pra hidratar campos
        (supabase as any)
          .from("company_settings")
          .select("default_discount_pct, default_max_installments")
          .eq("account_id", accountId)
          .maybeSingle(),
      ]);
      if (cancelled) return;
      setPersonas(pRes.filter((p) => p.status === "active"));
      setPhoneNumbers(nRes);
      setContacts(((cRes.data as any) ?? []) as typeof contacts);
      const debts = (dRes.data ?? []) as Array<{ valor_atual: number }>;
      setWalletSnapshot({
        count: debts.length,
        total: debts.reduce((s, d) => s + Number(d.valor_atual ?? 0), 0),
        loading: false,
      });
      const settings = settingsRes.data as { default_discount_pct?: number; default_max_installments?: number } | null;
      if (settings?.default_discount_pct != null) setDiscountPct(Number(settings.default_discount_pct));
      if (settings?.default_max_installments != null) setMaxInstallments(Number(settings.default_max_installments));
    })();
    return () => {
      cancelled = true;
    };
  }, [open, accountId]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return contacts;
    return contacts.filter(
      (c) =>
        (c.name ?? "").toLowerCase().includes(q) ||
        (c.phone_number ?? "").toLowerCase().includes(q),
    );
  }, [contacts, search]);

  const handleStart = async () => {
    if (!name || !phoneNumberId) {
      toast.error("Nome e número são obrigatórios");
      return;
    }
    if (mode !== "conversational" && !opening.trim()) {
      toast.error("Script de abertura obrigatório neste modo");
      return;
    }

    let contactIds: string[];
    let variablesByContact: Record<string, Record<string, unknown>> = {};

    if (audienceMode === "csv") {
      const validRows = csvRows.filter((r) => r.status === "ready");
      if (validRows.length === 0) {
        toast.error("Nenhuma linha válida no CSV. Corrija e tente de novo.");
        return;
      }
      setSubmitting(true);
      try {
        const { ids, variables } = await ensureCsvContactsInDb(accountId, validRows);
        contactIds = ids;
        variablesByContact = variables;
      } catch (e: any) {
        toast.error(e?.message ?? "Falha ao importar contatos do CSV");
        setSubmitting(false);
        return;
      }
    } else {
      if (selected.size === 0) {
        toast.error("Selecione ao menos 1 contato");
        return;
      }
      contactIds = Array.from(selected);
      setSubmitting(true);
    }

    const rules: EscalationRule[] = [];
    rules.push({ trigger: "explicit_request", action: "transfer_to_human" });

    try {
      const res = await startVoiceCampaign({
        accountId,
        name,
        personaId: personaId || undefined,
        phoneNumberId,
        scriptMode: mode,
        openingScript: opening || undefined,
        systemPrompt: systemPrompt || undefined,
        contactIds,
        variablesByContact,
        escalationRules: rules,
        voicemailDetection,
        recordCall,
        testMode,
        collectionConfig: {
          discount_pct: discountPct,
          max_installments: maxInstallments,
          min_installment_value: minInstallmentValue,
          first_due_min_days: firstDueMinDays,
          first_due_max_days: firstDueMaxDays,
          respect_dnc: respectDnc,
          respect_window: respectWindow,
          skip_holidays: skipHolidays,
          priority_by: priorityBy,
        },
        quotas: {
          max_calls_per_day: maxCallsDay ? Number(maxCallsDay) : null,
          max_calls_per_week: maxCallsWeek ? Number(maxCallsWeek) : null,
          max_calls_per_month: maxCallsMonth ? Number(maxCallsMonth) : null,
          max_messages_per_day: maxMsgsDay ? Number(maxMsgsDay) : null,
          max_messages_per_week: maxMsgsWeek ? Number(maxMsgsWeek) : null,
          max_messages_per_month: maxMsgsMonth ? Number(maxMsgsMonth) : null,
        },
      });
      toast.success(
        testMode
          ? `Modo TESTE — ${res.queued} contato(s) na fila (máx 3)`
          : `Campanha iniciada — ${res.queued} contatos na fila`,
      );
      onCreated();
    } catch (e: any) {
      toast.error(e?.message ?? "Não conseguimos iniciar a campanha.");
    } finally {
      setSubmitting(false);
    }
  };

  // Estimativa de valor recuperado mínimo se todos pagarem com regras
  const estimMin = walletSnapshot.total * (1 - discountPct / 100);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Nova campanha de voz</DialogTitle>
          <DialogDescription>
            A IA discará do número abaixo e seguirá o script. Escalação por palavra-chave já
            está ativa por padrão (atendente/humano/gerente/supervisor).
          </DialogDescription>
        </DialogHeader>

        {/* Tabs */}
        <div className="mb-3 flex items-center gap-1 rounded-md bg-muted/30 p-1">
          {[
            { id: "basico" as const,     label: "Básico" },
            { id: "negociacao" as const, label: "Regras de negociação" },
            { id: "audiencia" as const,  label: "Audiência" },
          ].map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setTab(t.id)}
              className={cn(
                "flex-1 rounded px-3 py-1.5 text-[11px] font-medium transition-colors",
                tab === t.id
                  ? "bg-primary/20 text-primary"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {t.label}
            </button>
          ))}
        </div>

        {tab === "negociacao" && (
          <div className="grid gap-4 py-2">
            {/* Snapshot da carteira */}
            <div className="rounded-lg border border-violet-500/20 bg-violet-500/5 p-3">
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
                    Carteira em aberto agora
                  </div>
                  <div className="mt-0.5 font-mono text-lg font-semibold tabular-nums">
                    {walletSnapshot.loading
                      ? <Loader2 className="h-4 w-4 animate-spin" />
                      : new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(walletSnapshot.total)}
                  </div>
                  <div className="mt-0.5 text-[10px] text-muted-foreground">
                    {walletSnapshot.count} dívida{walletSnapshot.count === 1 ? "" : "s"} em aberto / em negociação
                  </div>
                </div>
                <div className="text-right">
                  <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
                    Estimativa pior caso
                  </div>
                  <div className="mt-0.5 font-mono text-lg font-semibold tabular-nums text-emerald-300">
                    {new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(estimMin)}
                  </div>
                  <div className="mt-0.5 text-[10px] text-muted-foreground">
                    se 100% pagar com {discountPct}% de desconto
                  </div>
                </div>
              </div>
            </div>

            {/* Desconto + parcelas */}
            <div className="grid gap-3 md:grid-cols-2">
              <div>
                <Label>Desconto à vista (%)</Label>
                <Input
                  type="number" min={0} max={100} step={1}
                  value={discountPct}
                  onChange={(e) => setDiscountPct(Number(e.target.value))}
                />
                <p className="mt-1 text-[10px] text-muted-foreground">
                  0% = sem desconto. Aplicado quando o devedor paga em 1×.
                </p>
              </div>
              <div>
                <Label>Máximo de parcelas</Label>
                <Input
                  type="number" min={1} max={24} step={1}
                  value={maxInstallments}
                  onChange={(e) => setMaxInstallments(Number(e.target.value))}
                />
                <p className="mt-1 text-[10px] text-muted-foreground">
                  O agente nunca oferece mais que isso.
                </p>
              </div>
            </div>

            {/* Vencimentos + valor mínimo */}
            <div className="grid gap-3 md:grid-cols-3">
              <div>
                <Label>Valor mínimo por parcela (R$)</Label>
                <Input
                  type="number" min={0} step={10}
                  value={minInstallmentValue}
                  onChange={(e) => setMinInstallmentValue(Number(e.target.value))}
                />
              </div>
              <div>
                <Label>Primeiro vencimento mín. (dias)</Label>
                <Input
                  type="number" min={0} max={60} step={1}
                  value={firstDueMinDays}
                  onChange={(e) => setFirstDueMinDays(Number(e.target.value))}
                />
              </div>
              <div>
                <Label>Primeiro vencimento máx. (dias)</Label>
                <Input
                  type="number" min={0} max={90} step={1}
                  value={firstDueMaxDays}
                  onChange={(e) => setFirstDueMaxDays(Number(e.target.value))}
                />
              </div>
            </div>

            {/* Prioridade */}
            <div>
              <Label>Prioridade da fila</Label>
              <Select value={priorityBy} onValueChange={(v) => setPriorityBy(v as typeof priorityBy)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="valor_desc">Maior valor primeiro</SelectItem>
                  <SelectItem value="atraso_desc">Mais atrasados primeiro</SelectItem>
                  <SelectItem value="vencimento_asc">Vencimento mais antigo primeiro</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* Compliance toggles */}
            <div className="space-y-2">
              <div className="flex items-center justify-between rounded-md border border-white/[0.06] px-3 py-2">
                <div>
                  <Label className="text-xs">Honrar lista DNC</Label>
                  <p className="text-[10px] text-muted-foreground">Pula números que pediram pra não ligar mais.</p>
                </div>
                <Switch checked={respectDnc} onCheckedChange={setRespectDnc} />
              </div>
              <div className="flex items-center justify-between rounded-md border border-white/[0.06] px-3 py-2">
                <div>
                  <Label className="text-xs">Respeitar janela legal de contato</Label>
                  <p className="text-[10px] text-muted-foreground">Seg-sex 8h-20h, sáb 8h-14h, dom bloqueado.</p>
                </div>
                <Switch checked={respectWindow} onCheckedChange={setRespectWindow} />
              </div>
              <div className="flex items-center justify-between rounded-md border border-white/[0.06] px-3 py-2">
                <div>
                  <Label className="text-xs">Pular feriados nacionais</Label>
                  <p className="text-[10px] text-muted-foreground">Não liga em feriados da tabela `holidays_br`.</p>
                </div>
                <Switch checked={skipHolidays} onCheckedChange={setSkipHolidays} />
              </div>
            </div>

            {/* Quotas de disparo */}
            <div className="rounded-lg border border-white/[0.06] bg-white/[0.02] p-3">
              <div className="mb-2">
                <Label className="text-xs">Limites de disparo desta campanha</Label>
                <p className="mt-0.5 text-[10px] text-muted-foreground">
                  Quando atingir o teto, a campanha pausa automaticamente até o próximo período.
                  Deixe em branco para sem limite.
                </p>
              </div>

              <div className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                Ligações
              </div>
              <div className="grid gap-2 md:grid-cols-3">
                <div>
                  <Label className="text-[10px] text-muted-foreground">por dia</Label>
                  <Input
                    type="number" min={1} step={1} placeholder="∞"
                    value={maxCallsDay}
                    onChange={(e) => setMaxCallsDay(e.target.value)}
                  />
                </div>
                <div>
                  <Label className="text-[10px] text-muted-foreground">por semana</Label>
                  <Input
                    type="number" min={1} step={1} placeholder="∞"
                    value={maxCallsWeek}
                    onChange={(e) => setMaxCallsWeek(e.target.value)}
                  />
                </div>
                <div>
                  <Label className="text-[10px] text-muted-foreground">por mês</Label>
                  <Input
                    type="number" min={1} step={1} placeholder="∞"
                    value={maxCallsMonth}
                    onChange={(e) => setMaxCallsMonth(e.target.value)}
                  />
                </div>
              </div>

              <div className="mb-2 mt-3 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                Mensagens (WhatsApp)
              </div>
              <div className="grid gap-2 md:grid-cols-3">
                <div>
                  <Label className="text-[10px] text-muted-foreground">por dia</Label>
                  <Input
                    type="number" min={1} step={1} placeholder="∞"
                    value={maxMsgsDay}
                    onChange={(e) => setMaxMsgsDay(e.target.value)}
                  />
                </div>
                <div>
                  <Label className="text-[10px] text-muted-foreground">por semana</Label>
                  <Input
                    type="number" min={1} step={1} placeholder="∞"
                    value={maxMsgsWeek}
                    onChange={(e) => setMaxMsgsWeek(e.target.value)}
                  />
                </div>
                <div>
                  <Label className="text-[10px] text-muted-foreground">por mês</Label>
                  <Input
                    type="number" min={1} step={1} placeholder="∞"
                    value={maxMsgsMonth}
                    onChange={(e) => setMaxMsgsMonth(e.target.value)}
                  />
                </div>
              </div>
            </div>
          </div>
        )}

        {tab === "basico" && (
          <div className="space-y-3 py-2">
            <div>
              <Label>Nome da campanha</Label>
              <Input value={name} onChange={(e) => setName(e.target.value)} />
            </div>

            <div>
              <Label>Número emissor</Label>
              <Select value={phoneNumberId} onValueChange={setPhoneNumberId}>
                <SelectTrigger>
                  <SelectValue placeholder="selecione" />
                </SelectTrigger>
                <SelectContent>
                  {phoneNumbers.filter((p) => p.outbound_enabled).map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.friendly_name} · {p.e164}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div>
              <Label>Persona (voice clone + estilo)</Label>
              <Select value={personaId} onValueChange={setPersonaId}>
                <SelectTrigger>
                  <SelectValue placeholder="nenhuma (voz padrão)" />
                </SelectTrigger>
                <SelectContent>
                  {personas.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.name} {p.voice_clone_id ? "🎙" : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div>
              <Label>Modo do script</Label>
              <div className="mt-1 flex gap-1 rounded-md bg-muted/30 p-1">
                {(["conversational", "hybrid", "script_readback"] as VoiceScriptMode[]).map((m) => (
                  <button
                    key={m}
                    onClick={() => setMode(m)}
                    className={cn(
                      "flex-1 rounded px-2 py-1 text-[10px] font-medium transition-colors",
                      mode === m
                        ? "bg-primary/20 text-primary"
                        : "text-muted-foreground hover:text-foreground",
                    )}
                  >
                    {m === "conversational" ? "Conversacional" : m === "hybrid" ? "Híbrido" : "Roteiro fixo"}
                  </button>
                ))}
              </div>
              <p className="mt-1 text-[10px] text-muted-foreground">
                {mode === "conversational"
                  ? "IA conduz conversa livre com a persona. Sem script obrigatório."
                  : mode === "hybrid"
                    ? "IA abre com o script de abertura e depois conversa."
                    : "IA apenas lê o script — sem conversação, sem LLM durante a call (mais barato)."}
              </p>
            </div>

            {mode !== "conversational" && (
              <div>
                <Label>Script de abertura {mode === "script_readback" && "*"}</Label>
                <Textarea
                  rows={4}
                  value={opening}
                  onChange={(e) => setOpening(e.target.value)}
                  placeholder="Olá {{nome}}! Aqui é {{empresa}}. O motivo do meu contato é…"
                />
                <p className="mt-1 text-[9px] text-muted-foreground">
                  Variáveis: use {"{{nome}}"} etc. — preenchidas por contato.
                </p>
              </div>
            )}

            {mode === "conversational" && (
              <div>
                <Label>System prompt (override da persona)</Label>
                <Textarea
                  rows={4}
                  value={systemPrompt}
                  onChange={(e) => setSystemPrompt(e.target.value)}
                  placeholder="opcional — usa persona.system_prompt se vazio"
                />
              </div>
            )}

            <p className="rounded-md border border-white/[0.06] px-3 py-2 text-[11px] text-muted-foreground">
              A ligação não é transferida: quando a Bia não consegue resolver, ela pede para o cliente
              anotar o WhatsApp da equipe (telefone de suporte em Configurações).
            </p>

            <div className="flex items-center justify-between rounded-md border border-white/[0.06] px-3 py-2">
              <Label className="text-xs">Detectar secretária eletrônica</Label>
              <Switch checked={voicemailDetection} onCheckedChange={setVoicemailDetection} />
            </div>
            <div className="flex items-center justify-between rounded-md border border-white/[0.06] px-3 py-2">
              <Label className="text-xs">Gravar chamadas</Label>
              <Switch checked={recordCall} onCheckedChange={setRecordCall} />
            </div>
            <div className="flex items-center justify-between rounded-md border border-amber-500/30 bg-amber-500/[0.04] px-3 py-2">
              <div>
                <Label className="text-xs text-amber-200">Modo teste (3 contatos)</Label>
                <p className="text-[10px] text-amber-200/60">Dispara só pros 3 primeiros — bom pra validar antes de soltar pra base inteira.</p>
              </div>
              <Switch checked={testMode} onCheckedChange={setTestMode} />
            </div>
          </div>
        )}

        {tab === "audiencia" && (
          <div className="space-y-2 py-2">
            <div className="flex items-center gap-1 rounded-md bg-muted/30 p-1">
              <button
                type="button"
                onClick={() => setAudienceMode("existing")}
                className={cn(
                  "flex flex-1 items-center justify-center gap-1.5 rounded px-2 py-1 text-[11px] font-medium transition-colors",
                  audienceMode === "existing"
                    ? "bg-primary/20 text-primary"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                <Users className="h-3 w-3" />
                Contatos da base ({selected.size})
              </button>
              <button
                type="button"
                onClick={() => setAudienceMode("csv")}
                className={cn(
                  "flex flex-1 items-center justify-center gap-1.5 rounded px-2 py-1 text-[11px] font-medium transition-colors",
                  audienceMode === "csv"
                    ? "bg-primary/20 text-primary"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                <FileSpreadsheet className="h-3 w-3" />
                Subir CSV ({csvRows.filter((r) => r.status === "ready").length} válidos)
              </button>
            </div>

            {audienceMode === "existing" ? (
              <>
                <Input
                  placeholder="buscar por nome ou telefone"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
                <div className="max-h-[420px] space-y-0.5 overflow-y-auto rounded-md border border-white/[0.06] p-2">
                  {filtered.length === 0 ? (
                    <p className="py-6 text-center text-xs text-muted-foreground">
                      nenhum contato com telefone
                    </p>
                  ) : (
                    filtered.map((c) => (
                      <label
                        key={c.id}
                        className={cn(
                          "flex items-center gap-2 rounded px-2 py-1.5 text-xs hover:bg-white/[0.03]",
                          selected.has(c.id) && "bg-primary/10",
                        )}
                      >
                        <input
                          type="checkbox"
                          checked={selected.has(c.id)}
                          onChange={(e) =>
                            setSelected((prev) => {
                              const next = new Set(prev);
                              if (e.target.checked) next.add(c.id);
                              else next.delete(c.id);
                              return next;
                            })
                          }
                        />
                        <span className="flex-1 truncate">{c.name ?? "(sem nome)"}</span>
                        <span className="font-mono text-[10px] text-muted-foreground">
                          {c.phone_number}
                        </span>
                      </label>
                    ))
                  )}
                </div>
              </>
            ) : (
              <CsvUploader
                accountId={accountId}
                csvText={csvText}
                setCsvText={setCsvText}
                csvRows={csvRows}
                setCsvRows={setCsvRows}
              />
            )}
          </div>
        )}

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button onClick={handleStart} disabled={submitting}>
            {submitting && <Loader2 className="mr-2 h-3 w-3 animate-spin" />}
            Iniciar campanha
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── CSV import ──────────────────────────────────────────────────────

interface CsvRow {
  name: string | null;
  phone: string;
  phoneNormalized: string;      // E.164 attempt
  variables: Record<string, string>;
  status: "ready" | "invalid_phone" | "duplicate_in_csv" | "already_in_db";
  existingContactId?: string;   // populated if match found in DB
  reason?: string;
}

/** Normalize BR phone input into E.164. Accepts many common formats. */
function normalizePhoneBR(raw: string): string | null {
  if (!raw) return null;
  const digits = raw.replace(/\D/g, "");
  if (!digits) return null;
  // Already in international format
  if (raw.trim().startsWith("+")) {
    if (digits.length >= 10 && digits.length <= 15) return `+${digits}`;
    return null;
  }
  // BR heuristic: 10-11 digits (DDD + number). Prepend +55.
  if (digits.length === 10 || digits.length === 11) return `+55${digits}`;
  // 12-13 digits already has 55 prefix
  if (digits.length === 12 || digits.length === 13) {
    if (digits.startsWith("55")) return `+${digits}`;
  }
  return null;
}

/** Split CSV into rows. Handles comma or semicolon delimiters. Strips BOM. */
function parseCsv(text: string): { headers: string[]; rows: string[][] } {
  const cleaned = text.replace(/^﻿/, "").trim();
  if (!cleaned) return { headers: [], rows: [] };
  const lines = cleaned.split(/\r?\n/).filter((l) => l.trim());
  if (lines.length === 0) return { headers: [], rows: [] };

  // Detect delimiter.
  const first = lines[0];
  const delim = first.includes(";") && !first.includes(",") ? ";" : ",";

  const splitLine = (line: string): string[] => {
    // Minimal CSV parsing — handles quoted values with the delimiter inside.
    const out: string[] = [];
    let cur = "";
    let inQuote = false;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (inQuote) {
        if (c === '"' && line[i + 1] === '"') { cur += '"'; i++; }
        else if (c === '"') inQuote = false;
        else cur += c;
      } else {
        if (c === '"') inQuote = true;
        else if (c === delim) { out.push(cur); cur = ""; }
        else cur += c;
      }
    }
    out.push(cur);
    return out.map((s) => s.trim());
  };

  const headers = splitLine(lines[0]).map((h) => h.toLowerCase());
  const rows = lines.slice(1).map(splitLine);
  return { headers, rows };
}

/** Bulk-inserts new contacts and resolves IDs for existing ones. */
async function ensureCsvContactsInDb(
  accountId: string,
  rows: CsvRow[],
): Promise<{ ids: string[]; variables: Record<string, Record<string, unknown>> }> {
  const ids: string[] = [];
  const variables: Record<string, Record<string, unknown>> = {};

  // Upsert by (account_id, phone_number).
  const toInsert = rows
    .filter((r) => !r.existingContactId)
    .map((r) => ({
      account_id: accountId,
      name: r.name,
      phone_number: r.phoneNormalized,
      identifier: `csv:${r.phoneNormalized}`,
      custom_attributes: { source: "voice_campaign_csv" },
    }));

  if (toInsert.length > 0) {
    const { data: inserted, error } = await supabase
      .from("contacts")
      .upsert(toInsert as any, { onConflict: "account_id,identifier", ignoreDuplicates: false })
      .select("id, phone_number");
    if (error) throw new Error(`Falha ao importar: ${error.message}`);
    for (const c of (inserted ?? []) as any[]) {
      const row = rows.find((r) => r.phoneNormalized === c.phone_number);
      if (row) {
        row.existingContactId = c.id;
      }
    }
  }

  for (const r of rows) {
    if (!r.existingContactId) continue;
    ids.push(r.existingContactId);
    if (Object.keys(r.variables).length > 0) {
      variables[r.existingContactId] = r.variables;
    }
    if (r.name) variables[r.existingContactId] = { ...(variables[r.existingContactId] ?? {}), nome: r.name };
  }

  return { ids, variables };
}

function CsvUploader({
  accountId,
  csvText,
  setCsvText,
  csvRows,
  setCsvRows,
}: {
  accountId: string;
  csvText: string;
  setCsvText: (s: string) => void;
  csvRows: CsvRow[];
  setCsvRows: (rows: CsvRow[]) => void;
}) {
  const [validating, setValidating] = useState(false);

  const parseAndValidate = async (text: string) => {
    setCsvText(text);
    if (!text.trim()) { setCsvRows([]); return; }
    setValidating(true);
    try {
      const { headers, rows } = parseCsv(text);
      const phoneIdx = headers.findIndex((h) => /^(phone|telefone|celular|whatsapp)$/.test(h));
      const nameIdx = headers.findIndex((h) => /^(name|nome)$/.test(h));
      if (phoneIdx === -1) {
        toast.error("CSV precisa ter uma coluna 'phone' ou 'telefone'");
        setCsvRows([]);
        return;
      }

      const seenPhones = new Set<string>();
      const parsed: CsvRow[] = rows.map((cells) => {
        const rawPhone = cells[phoneIdx] ?? "";
        const name = nameIdx >= 0 ? cells[nameIdx] || null : null;
        const normalized = normalizePhoneBR(rawPhone);
        const variables: Record<string, string> = {};
        headers.forEach((h, i) => {
          if (i === phoneIdx || i === nameIdx) return;
          const v = cells[i];
          if (v) variables[h] = v;
        });

        if (!normalized) {
          return { name, phone: rawPhone, phoneNormalized: "", variables, status: "invalid_phone", reason: "formato inválido" };
        }
        if (seenPhones.has(normalized)) {
          return { name, phone: rawPhone, phoneNormalized: normalized, variables, status: "duplicate_in_csv", reason: "repetido no CSV" };
        }
        seenPhones.add(normalized);
        return { name, phone: rawPhone, phoneNormalized: normalized, variables, status: "ready" as const };
      });

      // Check DB for existing contacts.
      const phones = parsed.filter((p) => p.status === "ready").map((p) => p.phoneNormalized);
      if (phones.length > 0) {
        const { data: existing } = await supabase
          .from("contacts")
          .select("id, phone_number")
          .eq("account_id", accountId)
          .in("phone_number", phones);
        const byPhone = new Map<string, string>();
        (existing ?? []).forEach((c: any) => byPhone.set(c.phone_number, c.id));
        for (const r of parsed) {
          if (r.status === "ready" && byPhone.has(r.phoneNormalized)) {
            r.existingContactId = byPhone.get(r.phoneNormalized);
            // Keep status "ready" — we'll reuse the existing contact, no need to flag.
          }
        }
      }

      setCsvRows(parsed);
    } finally {
      setValidating(false);
    }
  };

  const handleFile = async (file: File) => {
    const txt = await file.text();
    await parseAndValidate(txt);
  };

  const ready = csvRows.filter((r) => r.status === "ready").length;
  const invalid = csvRows.filter((r) => r.status !== "ready").length;

  return (
    <div className="space-y-2">
      <div className="rounded-md border border-white/[0.06] p-3 text-[11px] text-muted-foreground">
        <p className="mb-1 font-medium text-foreground">Formato esperado:</p>
        <pre className="overflow-x-auto rounded bg-black/30 p-2 font-mono text-[10px]">
nome,telefone,produto,valor
João Silva,48999999999,camiseta,89
Maria,+5511988887777,calça,199
        </pre>
        <p className="mt-1.5">Colunas extras viram variáveis pra IA: <code>{"{{produto}}"}</code>.</p>
      </div>

      <div className="flex items-center gap-2">
        <input
          type="file"
          accept=".csv,text/csv,text/plain"
          onChange={(e) => e.target.files?.[0] && handleFile(e.target.files[0])}
          className="hidden"
          id="csv-file-input"
        />
        <label
          htmlFor="csv-file-input"
          className="flex cursor-pointer items-center gap-1.5 rounded-md border border-white/[0.06] bg-white/[0.02] px-3 py-1.5 text-[11px] hover:bg-white/[0.04]"
        >
          <Upload className="h-3 w-3" /> Escolher arquivo CSV
        </label>
        <span className="text-[10px] text-muted-foreground">ou cole abaixo</span>
      </div>

      <Textarea
        rows={4}
        value={csvText}
        onChange={(e) => parseAndValidate(e.target.value)}
        placeholder="Cole o CSV aqui (primeira linha = cabeçalho)"
        className="font-mono text-[11px]"
      />

      {validating && (
        <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
          <Loader2 className="h-3 w-3 animate-spin" /> Validando…
        </div>
      )}

      {csvRows.length > 0 && (
        <>
          <div className="flex items-center gap-3 text-[11px]">
            <span className="flex items-center gap-1 text-emerald-400">
              <CheckCircle2 className="h-3 w-3" /> {ready} válido{ready === 1 ? "" : "s"}
            </span>
            {invalid > 0 && (
              <span className="flex items-center gap-1 text-amber-400">
                <AlertTriangle className="h-3 w-3" /> {invalid} com problema
              </span>
            )}
          </div>
          <div className="max-h-[260px] overflow-y-auto rounded-md border border-white/[0.06]">
            <table className="w-full text-[11px]">
              <thead className="sticky top-0 bg-background/80 text-[10px] uppercase tracking-wider text-muted-foreground backdrop-blur">
                <tr>
                  <th className="px-2 py-1 text-left">Status</th>
                  <th className="px-2 py-1 text-left">Nome</th>
                  <th className="px-2 py-1 text-left">Telefone</th>
                </tr>
              </thead>
              <tbody>
                {csvRows.slice(0, 100).map((r, i) => (
                  <tr key={i} className="border-t border-white/[0.04]">
                    <td className="px-2 py-1">
                      {r.status === "ready" ? (
                        r.existingContactId ? (
                          <span className="text-sky-300" title="Já existia na base — será reutilizado">
                            reutilizar
                          </span>
                        ) : (
                          <span className="text-emerald-300">novo</span>
                        )
                      ) : r.status === "invalid_phone" ? (
                        <span className="text-amber-300">telefone inválido</span>
                      ) : (
                        <span className="text-amber-300">{r.reason}</span>
                      )}
                    </td>
                    <td className="px-2 py-1 truncate">{r.name ?? "—"}</td>
                    <td className="px-2 py-1 font-mono text-[10px] text-muted-foreground">
                      {r.phoneNormalized || r.phone}
                    </td>
                  </tr>
                ))}
                {csvRows.length > 100 && (
                  <tr><td colSpan={3} className="px-2 py-1 text-center text-muted-foreground">
                    + {csvRows.length - 100} linhas (mostrando primeiras 100)
                  </td></tr>
                )}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
