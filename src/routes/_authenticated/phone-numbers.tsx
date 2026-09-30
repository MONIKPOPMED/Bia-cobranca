import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Phone, PhoneCall, PhoneIncoming, PhoneOutgoing, Plus, Trash2, Mic,
  Upload, Loader2, Copy, Check, AlertCircle, Power,
} from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { useAccount } from "@/lib/account-context";
import { supabase } from "@/integrations/supabase/client";
import {
  fetchPhoneNumbers, createPhoneNumber, updatePhoneNumber, deletePhoneNumber,
  fetchVoiceCalls, placeCall, cloneVoiceForPersona, isVerifiedCallerIdOnly,
  INBOUND_LABELS, STATUS_LABELS, STATUS_TONE,
  type InboundBehavior, type PhoneNumber,
} from "@/lib/voice";
import type { OwnedTwilioNumber } from "@/lib/twilio";
import { fetchPersonas, type Persona } from "@/lib/personas";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/phone-numbers")({
  head: () => ({
    meta: [
      { title: "Telefonia — cobrAI" },
      { name: "description", content: "Conecte números Twilio, voice clone e atendimento por voz com IA." },
      { property: "og:title", content: "Telefonia — cobrAI" },
      {
        property: "og:description",
        content: "Números Twilio com compra self-service, gravação e voz por persona.",
      },
    ],
  }),
  component: PhoneNumbersPage,
});

function PhoneNumbersPage() {
  const { accountId, role } = useAccount();
  const qc = useQueryClient();
  const [createOpen, setCreateOpen] = useState(false);
  const [buyOpen, setBuyOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [cloneFor, setCloneFor] = useState<Persona | null>(null);
  const [activeCall, setActiveCall] = useState<any>(null);

  const phoneQuery = useQuery({
    queryKey: ["phone-numbers", accountId],
    queryFn: () => fetchPhoneNumbers(accountId!),
    enabled: !!accountId,
  });

  const personasQuery = useQuery({
    queryKey: ["personas", accountId],
    queryFn: () => fetchPersonas(accountId!),
    enabled: !!accountId,
  });

  const inboxesQuery = useQuery({
    queryKey: ["inboxes", accountId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("inboxes")
        .select("id, name, channel_type")
        .eq("account_id", accountId!)
        .order("name");
      if (error) throw error;
      return data ?? [];
    },
    enabled: !!accountId,
  });

  const callsQuery = useQuery({
    queryKey: ["voice-calls", accountId],
    queryFn: () => fetchVoiceCalls(accountId!, 25),
    enabled: !!accountId,
    refetchInterval: 10000,
  });

  // Realtime: inbound call or status callback bumps the list instantly,
  // replacing the 10s poll as primary update path.
  useEffect(() => {
    if (!accountId) return;
    const channel = supabase
      .channel(`voice-calls-list:${accountId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "voice_calls",
          filter: `account_id=eq.${accountId}`,
        },
        () => qc.invalidateQueries({ queryKey: ["voice-calls", accountId] }),
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [accountId, qc]);

  const accountQuery = useQuery({
    queryKey: ["account-flags", accountId],
    queryFn: async () => {
      const { data } = await supabase
        .from("accounts")
        .select("feature_flags")
        .eq("id", accountId!)
        .single();
      return (data?.feature_flags ?? {}) as Record<string, unknown>;
    },
    enabled: !!accountId,
  });

  const voiceCloneEnabled = accountQuery.data?.voice_clone_enabled === true;
  const isAdmin = role === "admin";

  const updateMut = useMutation({
    mutationFn: ({ id, updates }: { id: string; updates: Partial<PhoneNumber> }) =>
      updatePhoneNumber(id, updates),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["phone-numbers", accountId] });
      toast.success("Número atualizado");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const deleteMut = useMutation({
    mutationFn: deletePhoneNumber,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["phone-numbers", accountId] });
      toast.success("Número removido");
    },
  });

  const phoneNumbers = phoneQuery.data ?? [];
  const personas = personasQuery.data ?? [];
  const inboxes = inboxesQuery.data ?? [];
  const calls = callsQuery.data ?? [];

  return (
    <div className="flex flex-col">
      <PageHeader
        eyebrow="Telefonia"
        title="Números de telefone"
        description="Conecte números da Twilio pra receber e fazer ligações com IA. Cada número pode ter um agente fixo, voz própria e comportamento específico."
        actions={
          isAdmin && (
            <div className="flex items-center gap-2">
              <Button onClick={() => setImportOpen(true)} size="sm" variant="outline">
                Importar existente
              </Button>
              <Button onClick={() => setBuyOpen(true)} size="sm" variant="outline">
                Comprar número
              </Button>
              <Button onClick={() => setCreateOpen(true)} size="sm">
                <Plus className="h-4 w-4" />
                Novo número
              </Button>
            </div>
          )
        }
      />

      <div className="grid grid-cols-1 gap-6 px-6 py-6 lg:grid-cols-[1fr_360px]">
        <div className="space-y-6">
          {/* Numbers list */}
          <section>
            <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Números conectados
            </h3>
            {phoneQuery.isLoading ? (
              <div className="glass rounded-xl p-6 text-center text-sm text-muted-foreground">
                <Loader2 className="mx-auto mb-2 h-5 w-5 animate-spin" />
                Carregando…
              </div>
            ) : phoneNumbers.length === 0 ? (
              <div className="glass rounded-xl p-8 text-center">
                <Phone className="mx-auto mb-3 h-8 w-8 text-muted-foreground" />
                <p className="text-sm font-medium">Nenhum número conectado ainda</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  Compre um número no Twilio Console e cadastre aqui usando o formato E.164 (+5511...).
                </p>
              </div>
            ) : (
              <div className="space-y-3">
                {phoneNumbers.map((p) => (
                  <PhoneNumberCard
                    key={p.id}
                    phoneNumber={p}
                    inboxes={inboxes}
                    personas={personas}
                    canEdit={isAdmin}
                    onUpdate={(updates) => updateMut.mutate({ id: p.id, updates })}
                    onDelete={() => deleteMut.mutate(p.id)}
                  />
                ))}
              </div>
            )}
          </section>

          {/* Personas — voice clone management */}
          {personas.length > 0 && (
            <section>
              <div className="mb-3 flex items-center justify-between">
                <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Voice clones por persona
                </h3>
                {!voiceCloneEnabled && (
                  <Badge variant="outline" className="text-[10px]">
                    <AlertCircle className="mr-1 h-3 w-3" />
                    Feature flag desativada
                  </Badge>
                )}
              </div>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                {personas.map((persona) => (
                  <div key={persona.id} className="glass flex items-center justify-between rounded-xl p-4">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <p className="truncate text-sm font-semibold">{persona.name}</p>
                        {persona.voice_clone_id && (
                          <Badge variant="secondary" className="text-[10px]">
                            <Mic className="mr-1 h-3 w-3" />
                            Voz clonada
                          </Badge>
                        )}
                      </div>
                      <p className="mt-0.5 truncate text-xs text-muted-foreground">
                        {persona.voice_provider ?? "Voz padrão (ElevenLabs)"}
                      </p>
                    </div>
                    {isAdmin && voiceCloneEnabled && (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => setCloneFor(persona)}
                      >
                        <Upload className="h-3.5 w-3.5" />
                        {persona.voice_clone_id ? "Reclonar" : "Clonar"}
                      </Button>
                    )}
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* Twilio webhook box */}
          <TwilioInstructionsBox />
        </div>

        {/* Recent calls sidebar */}
        <aside className="space-y-3">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Chamadas recentes
          </h3>
          {calls.length === 0 ? (
            <div className="glass rounded-xl p-4 text-center text-xs text-muted-foreground">
              Nenhuma chamada ainda
            </div>
          ) : (
            <div className="space-y-2">
              {calls.map((c) => (
                <button
                  key={c.id}
                  onClick={() => setActiveCall(c)}
                  className={cn(
                    "glass w-full rounded-lg p-3 text-left text-xs transition-colors hover:bg-white/[0.04]",
                    activeCall?.id === c.id && "ring-1 ring-primary/40",
                  )}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-1.5 font-medium">
                      {c.direction === "inbound" ? (
                        <PhoneIncoming className="h-3.5 w-3.5 text-info" />
                      ) : (
                        <PhoneOutgoing className="h-3.5 w-3.5 text-primary" />
                      )}
                      <span className="font-mono text-[11px]">
                        {c.direction === "inbound" ? c.from_number : c.to_number}
                      </span>
                    </div>
                    <Badge
                      variant="outline"
                      className={cn(
                        "text-[10px]",
                        STATUS_TONE[c.status] === "good" && "border-success/40 text-success",
                        STATUS_TONE[c.status] === "bad" && "border-destructive/40 text-destructive",
                        STATUS_TONE[c.status] === "active" && "border-primary/40 text-primary",
                      )}
                    >
                      {STATUS_LABELS[c.status]}
                    </Badge>
                  </div>
                  <div className="mt-1 flex items-center justify-between text-muted-foreground">
                    <span>{c.duration_seconds}s</span>
                    <span>{new Date(c.created_at).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}</span>
                  </div>
                  {(c as any).recording_url && (
                    <div className="mt-1.5 text-[9px] text-primary">🎧 gravação disponível</div>
                  )}
                </button>
              ))}
            </div>
          )}
        </aside>
      </div>

      <CreateNumberDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        accountId={accountId}
        inboxes={inboxes}
        personas={personas}
        onCreated={() => qc.invalidateQueries({ queryKey: ["phone-numbers", accountId] })}
      />

      <VoiceCloneDialog
        persona={cloneFor}
        onClose={() => setCloneFor(null)}
        onCloned={() => {
          qc.invalidateQueries({ queryKey: ["personas", accountId] });
          setCloneFor(null);
        }}
      />

      <NumberBuyWizard
        open={buyOpen}
        onOpenChange={setBuyOpen}
        accountId={accountId ?? ""}
        inboxes={inboxes}
        personas={personas}
        onBought={() => {
          setBuyOpen(false);
          qc.invalidateQueries({ queryKey: ["phone-numbers", accountId] });
        }}
      />

      <ImportNumberDialog
        open={importOpen}
        onOpenChange={setImportOpen}
        accountId={accountId ?? ""}
        personas={personas}
        onImported={() => {
          setImportOpen(false);
          qc.invalidateQueries({ queryKey: ["phone-numbers", accountId] });
        }}
      />

      <VoiceCallDetailSheet
        call={activeCall}
        onClose={() => setActiveCall(null)}
        onRetry={() => {
          // lightweight: just refresh the list
          qc.invalidateQueries({ queryKey: ["voice-calls", accountId] });
        }}
      />
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────
function PhoneNumberCard({
  phoneNumber,
  inboxes,
  personas,
  canEdit,
  onUpdate,
  onDelete,
}: {
  phoneNumber: PhoneNumber;
  inboxes: Array<{ id: string; name: string }>;
  personas: Persona[];
  canEdit: boolean;
  onUpdate: (updates: Partial<PhoneNumber>) => void;
  onDelete: () => void;
}) {
  const qc = useQueryClient();
  const [dialing, setDialing] = useState(false);
  const [dialError, setDialError] = useState<string | null>(null);
  const [target, setTarget] = useState("");
  const [activating, setActivating] = useState(false);

  const elActive = !!phoneNumber.elevenlabs_phone_number_id;
  // Verified Caller ID: usable as outbound "From" only, never rings inbound.
  const callerIdOnly = isVerifiedCallerIdOnly(phoneNumber);

  async function handleDial() {
    if (!target.trim()) return;
    try {
      setDialing(true);
      setDialError(null);
      const r = await placeCall({
        fromNumberId: phoneNumber.id,
        toNumber: target.trim(),
        personaId: phoneNumber.pinned_persona_id ?? undefined,
      });
      if (!r.ok) {
        setDialError(r.message || "Não foi possível iniciar a ligação. Tente novamente.");
        toast.error(r.message ?? "Falha ao discar");
        return;
      }
      if (r.via === "twilio_fallback") {
        toast.warning(`ElevenLabs indisponível — chamada saiu via Twilio direto pra ${target}`);
      } else if (r.via === "elevenlabs") {
        toast.success(`IA ligando pra ${target}…`);
      } else {
        toast.success(`Chamando ${target}…`);
      }
      setTarget("");
    } catch (e: unknown) {
      const err = e as Error;
      setDialError(err.message || "Não foi possível iniciar a ligação. Tente novamente.");
      toast.error(err.message ?? "Falha ao discar");
    } finally {
      setDialing(false);
    }
  }

  async function handleActivateEl() {
    if (!phoneNumber.pinned_persona_id) {
      toast.error("Pina uma persona sincronizada com ElevenLabs primeiro");
      return;
    }
    setActivating(true);
    const toastId = toast.loading("Ativando IA do ElevenLabs… vinculando agente e webhooks", {
      duration: Infinity,
    });
    try {
      const { registerPhoneWithElevenLabs } = await import("@/lib/voice");
      await registerPhoneWithElevenLabs(phoneNumber.id);
      toast.success("IA ativada — inbound e outbound agora atendidos pelo ElevenLabs", {
        id: toastId,
        duration: 5000,
      });
      // Force refetch so the card re-renders with elActive=true immediately.
      await qc.invalidateQueries({ queryKey: ["phone-numbers"] });
    } catch (e: unknown) {
      const err = e as Error;
      toast.error(err.message ?? "Falha ao ativar IA", { id: toastId, duration: 6000 });
    } finally {
      setActivating(false);
    }
  }

  return (
    <div className="glass rounded-xl p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <PhoneCall className="h-4 w-4 text-primary" />
            <p className="font-mono text-sm font-semibold">{phoneNumber.e164}</p>
            {phoneNumber.friendly_name && (
              <span className="text-xs text-muted-foreground">· {phoneNumber.friendly_name}</span>
            )}
            {!phoneNumber.enabled && <Badge variant="outline">Desativado</Badge>}
            {callerIdOnly && (
              <Badge
                variant="outline"
                className="border-amber-500/40 text-[10px] text-amber-600"
                title="Caller ID verificado na Twilio — só pode ser usado para ligar. Não recebe ligações nem SMS."
              >
                <PhoneOutgoing className="mr-1 h-3 w-3" />
                Só saída
              </Badge>
            )}
            {elActive && (
              <span
                className="inline-flex items-center gap-1 rounded-md border border-emerald-500/40 bg-emerald-50 px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-emerald-800"
                title="Calls are handled by the ElevenLabs native Twilio integration"
              >
                <Check className="h-3 w-3" />
                IA ativa
              </span>
            )}
          </div>
          <p className="mt-0.5 text-[10px] uppercase tracking-wider text-muted-foreground">
            {phoneNumber.provider}
            {callerIdOnly && " · Caller ID verificado"}
          </p>
        </div>
        {canEdit && (
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => onUpdate({ enabled: !phoneNumber.enabled })}
              className={cn(
                "inline-flex h-8 w-8 items-center justify-center rounded-md border transition-colors",
                phoneNumber.enabled
                  ? "border-success/40 text-success"
                  : "border-border text-muted-foreground"
              )}
              title={phoneNumber.enabled ? "Desativar" : "Ativar"}
            >
              <Power className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              onClick={() => {
                if (confirm(`Remover ${phoneNumber.e164}?`)) onDelete();
              }}
              className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-border text-muted-foreground transition-colors hover:border-destructive/50 hover:text-destructive"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </div>
        )}
      </div>

      <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div>
          <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            Caixa de entrada
          </label>
          <Select
            value={phoneNumber.inbox_id ?? "none"}
            onValueChange={(v) => onUpdate({ inbox_id: v === "none" ? null : v })}
            disabled={!canEdit}
          >
            <SelectTrigger className="h-9 text-xs">
              <SelectValue placeholder="Sem caixa" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none">— sem caixa —</SelectItem>
              {inboxes.map((i) => (
                <SelectItem key={i.id} value={i.id}>{i.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div>
          <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            Persona fixada
          </label>
          <Select
            value={phoneNumber.pinned_persona_id ?? "none"}
            onValueChange={(v) => onUpdate({ pinned_persona_id: v === "none" ? null : v })}
            disabled={!canEdit}
          >
            <SelectTrigger className="h-9 text-xs">
              <SelectValue placeholder="Sem persona" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none">— nenhuma —</SelectItem>
              {personas.map((p) => (
                <SelectItem key={p.id} value={p.id}>
                  {p.name} {p.voice_clone_id ? "🎙️" : ""}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div>
          <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            Comportamento de entrada
          </label>
          {callerIdOnly ? (
            <div
              className="flex h-9 items-center rounded-md border border-border bg-muted/40 px-3 text-xs text-muted-foreground"
              title="Caller ID verificado não recebe ligações pela Twilio"
            >
              Não recebe ligações
            </div>
          ) : (
            <Select
              value={phoneNumber.inbound_behavior}
              onValueChange={(v) => onUpdate({ inbound_behavior: v as InboundBehavior })}
              disabled={!canEdit}
            >
              <SelectTrigger className="h-9 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(Object.keys(INBOUND_LABELS) as InboundBehavior[]).map((b) => (
                  <SelectItem key={b} value={b}>{INBOUND_LABELS[b]}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </div>
      </div>

      {callerIdOnly && (
        <div className="mt-4 flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/[0.05] p-3">
          <PhoneOutgoing className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-600" />
          <p className="text-[11px] leading-relaxed text-foreground/80">
            <strong className="font-semibold">Número só de saída.</strong> Ele foi
            verificado como Caller ID na Twilio, não comprado lá. Dá pra usar como
            remetente em campanhas e ligações individuais, mas ligações e SMS
            recebidos continuam indo pra operadora do chip — nunca chegam aqui.
          </p>
        </div>
      )}

      {/* Activate IA (ElevenLabs native) — one-click registration. */}
      {canEdit && !elActive && phoneNumber.pinned_persona_id && (
        <div className="mt-4 flex items-center justify-between gap-3 rounded-lg border border-primary/30 bg-primary/[0.04] p-3">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5 text-[13px] font-semibold text-primary">
              <Mic className="h-3.5 w-3.5" /> Ativar IA nativa do ElevenLabs
            </div>
            <p className="mt-1 text-[11px] leading-relaxed text-foreground/80">
              Vincula esse número ao agente da persona no EL. Toda ligação (inbound
              e outbound) passa a ser atendida direto por eles, com latência
              menor que a rota padrão.
            </p>
          </div>
          <Button size="sm" onClick={handleActivateEl} disabled={activating} className="shrink-0">
            {activating ? (
              <>
                <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                Ativando…
              </>
            ) : (
              <>
                <Mic className="mr-1.5 h-3.5 w-3.5" />
                Ativar IA
              </>
            )}
          </Button>
        </div>
      )}

      {/* IA active — persistent confirmation block */}
      {elActive && (
        <div className="mt-4 flex items-start gap-3 rounded-lg border border-emerald-500/40 bg-emerald-50 p-3">
          <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-emerald-500/20 text-emerald-700">
            <Check className="h-4 w-4" strokeWidth={3} />
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-[13px] font-semibold text-emerald-900">
              IA do ElevenLabs ativa neste número
            </div>
            <p className="mt-0.5 text-[11px] leading-relaxed text-emerald-800/90">
              Inbound e outbound estão sendo atendidos direto pelo agente da persona
              fixada, via integração nativa Twilio ↔ ElevenLabs.
            </p>
          </div>
        </div>
      )}

      {/* Outbound */}
      <div className="mt-4 flex items-center justify-between rounded-lg border border-border bg-card/40 p-3">
        <div className="flex items-center gap-2">
          <Switch
            id={`out-${phoneNumber.id}`}
            checked={phoneNumber.outbound_enabled}
            onCheckedChange={(v) => onUpdate({ outbound_enabled: v })}
            disabled={!canEdit}
          />
          <label htmlFor={`out-${phoneNumber.id}`} className="text-xs font-medium">
            Discagem ativa habilitada
          </label>
        </div>
        {phoneNumber.outbound_enabled && (
          <div className="flex items-center gap-2">
            <Input
              value={target}
              onChange={(e) => setTarget(e.target.value)}
              placeholder="+5511..."
              aria-label="Número de destino"
              aria-describedby={dialError ? `dial-error-${phoneNumber.id}` : undefined}
              disabled={dialing}
              className="h-8 w-40 font-mono text-xs"
            />
            <Button
              size="sm"
              onClick={handleDial}
              disabled={dialing || !target.trim()}
              title={elActive ? "Liga via ElevenLabs native" : "Liga via Twilio /Calls.json"}
            >
              {dialing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <PhoneOutgoing className="h-3.5 w-3.5" />}
              {elActive ? "Ligar (IA)" : "Ligar"}
            </Button>
          </div>
        )}
      </div>
      {dialError && (
        <p id={`dial-error-${phoneNumber.id}`} role="alert" className="mt-2 text-sm text-destructive">
          {dialError}
        </p>
      )}
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────
function CreateNumberDialog({
  open, onOpenChange, accountId, inboxes, personas, onCreated,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  accountId: string | null;
  inboxes: Array<{ id: string; name: string }>;
  personas: Persona[];
  onCreated: () => void;
}) {
  const [e164, setE164] = useState("");
  const [friendly, setFriendly] = useState("");
  const [inboxId, setInboxId] = useState<string>("none");
  const [personaId, setPersonaId] = useState<string>("none");
  const [behavior, setBehavior] = useState<InboundBehavior>("ai_answer");
  const [saving, setSaving] = useState(false);

  async function submit() {
    if (!accountId || !e164.trim()) return;
    if (!/^\+[1-9]\d{6,14}$/.test(e164.trim())) {
      toast.error("Use formato E.164 (ex: +5511987654321)");
      return;
    }
    try {
      setSaving(true);
      await createPhoneNumber({
        accountId,
        e164: e164.trim(),
        friendlyName: friendly.trim() || undefined,
        inboxId: inboxId === "none" ? null : inboxId,
        pinnedPersonaId: personaId === "none" ? null : personaId,
        inboundBehavior: behavior,
      });
      toast.success("Número adicionado");
      onCreated();
      onOpenChange(false);
      setE164(""); setFriendly(""); setInboxId("none"); setPersonaId("none"); setBehavior("ai_answer");
    } catch (e: unknown) {
      const err = e as Error;
      toast.error(err.message ?? "Falha ao adicionar");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Novo número de telefone</DialogTitle>
          <DialogDescription>
            Conecte um número Twilio existente. Lembre de configurar os webhooks no Twilio Console depois.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <label className="mb-1 block text-xs font-semibold">Número (E.164)</label>
            <Input value={e164} onChange={(e) => setE164(e.target.value)} placeholder="+5511987654321" className="font-mono" />
          </div>
          <div>
            <label className="mb-1 block text-xs font-semibold">Nome amigável (opcional)</label>
            <Input value={friendly} onChange={(e) => setFriendly(e.target.value)} placeholder="SAC Brasil" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-xs font-semibold">Caixa de entrada</label>
              <Select value={inboxId} onValueChange={setInboxId}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">— nenhuma —</SelectItem>
                  {inboxes.map((i) => <SelectItem key={i.id} value={i.id}>{i.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="mb-1 block text-xs font-semibold">Persona</label>
              <Select value={personaId} onValueChange={setPersonaId}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">— nenhuma —</SelectItem>
                  {personas.map((p) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div>
            <label className="mb-1 block text-xs font-semibold">Comportamento de entrada</label>
            <Select value={behavior} onValueChange={(v) => setBehavior(v as InboundBehavior)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {(Object.keys(INBOUND_LABELS) as InboundBehavior[]).map((b) => (
                  <SelectItem key={b} value={b}>{INBOUND_LABELS[b]}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button onClick={submit} disabled={saving || !e164.trim()}>
            {saving && <Loader2 className="h-4 w-4 animate-spin" />}
            Adicionar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ──────────────────────────────────────────────────────────────────
function VoiceCloneDialog({
  persona, onClose, onCloned,
}: {
  persona: Persona | null;
  onClose: () => void;
  onCloned: () => void;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);

  useEffect(() => { if (!persona) setFile(null); }, [persona]);

  async function submit() {
    if (!persona || !file) return;
    try {
      setUploading(true);
      await cloneVoiceForPersona({ personaId: persona.id, file });
      toast.success("Voz clonada com sucesso");
      onCloned();
    } catch (e: unknown) {
      const err = e as { message?: string; context?: { message?: string } };
      toast.error(err.message ?? err.context?.message ?? "Falha ao clonar voz");
    } finally {
      setUploading(false);
    }
  }

  return (
    <Dialog open={!!persona} onOpenChange={(v) => !v && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Clonar voz para {persona?.name}</DialogTitle>
          <DialogDescription>
            Faça upload de 30s a 2min de áudio limpo da voz original (formato MP3/WAV/M4A).
            A clonagem usa ElevenLabs Instant Voice Clone.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <label className="flex cursor-pointer flex-col items-center gap-2 rounded-xl border-2 border-dashed border-border bg-card/30 p-8 text-center transition-colors hover:border-primary/50">
            <Upload className="h-6 w-6 text-muted-foreground" />
            <span className="text-sm font-medium">
              {file ? file.name : "Clique para selecionar áudio"}
            </span>
            <span className="text-xs text-muted-foreground">
              {file ? `${(file.size / 1024 / 1024).toFixed(2)} MB · ${file.type}` : "MP3, WAV, M4A"}
            </span>
            <input
              type="file"
              accept="audio/*"
              className="hidden"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            />
          </label>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancelar</Button>
          <Button onClick={submit} disabled={!file || uploading}>
            {uploading && <Loader2 className="h-4 w-4 animate-spin" />}
            Clonar voz
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ──────────────────────────────────────────────────────────────────
function TwilioInstructionsBox() {
  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL ?? "";
  const incoming = `${supabaseUrl}/functions/v1/twilio-incoming`;
  const status = `${supabaseUrl}/functions/v1/twilio-status`;
  const [copied, setCopied] = useState<string | null>(null);

  function copy(label: string, text: string) {
    navigator.clipboard.writeText(text);
    setCopied(label);
    setTimeout(() => setCopied(null), 1500);
  }

  return (
    <section className="glass rounded-xl p-5">
      <h3 className="mb-2 flex items-center gap-2 text-sm font-semibold">
        <AlertCircle className="h-4 w-4 text-primary" />
        Como conectar um número
      </h3>
      <p className="mb-3 text-xs text-muted-foreground">
        Você tem três caminhos, todos self-service:
      </p>
      <ul className="mb-4 space-y-1.5 text-xs text-muted-foreground">
        <li>
          <strong className="text-foreground">Comprar número</strong> — busca direta no
          inventário da Twilio (BR/US/etc.). Nós compramos, registramos e apontamos os
          webhooks de voz e SMS automaticamente.
        </li>
        <li>
          <strong className="text-foreground">Importar existente</strong> — ideal para o
          número grátis do trial Twilio ou números que você já comprou. Re-aponta os
          webhooks pra cá sem cobrar.
        </li>
        <li>
          <strong className="text-foreground">Novo número</strong> — só cadastra o E.164.
          Use quando o número está em outra subaccount Twilio. Nesse caso você cola as
          URLs abaixo manualmente no Console.
        </li>
      </ul>
      <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
        URLs dos webhooks (apenas pro caso "Novo número"):
      </p>
      <div className="space-y-2">
        <WebhookRow label="A CALL COMES IN (Voice)" hint="Webhook · HTTP POST" url={incoming} copied={copied === "in"} onCopy={() => copy("in", incoming)} />
        <WebhookRow label="CALL STATUS CHANGES" hint="Webhook · HTTP POST" url={status} copied={copied === "st"} onCopy={() => copy("st", status)} />
      </div>
      <p className="mt-4 text-[11px] text-muted-foreground">
        ✓ Stack 100% serverless: a Twilio hospeda o áudio bidirecional via{" "}
        <code className="rounded bg-background/60 px-1 font-mono text-[10px]">ConversationRelay</code>,
        com reconhecimento de fala e TTS pelo ElevenLabs. Quando a persona tem agente
        ElevenLabs ConvAI sincronizado, a chamada vai direto pro WebSocket assinado da EL —
        sem worker externo (Fly.io/Railway) e sem fila de áudio intermediária.
      </p>
    </section>
  );
}

function WebhookRow({ label, hint, url, copied, onCopy }: { label: string; hint: string; url: string; copied: boolean; onCopy: () => void }) {
  return (
    <div className="rounded-lg border border-border bg-card/40 p-3">
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <p className="text-[11px] font-semibold uppercase tracking-wider">{label}</p>
          <p className="text-[10px] text-muted-foreground">{hint}</p>
        </div>
        <Button variant="outline" size="sm" onClick={onCopy}>
          {copied ? <Check className="h-3.5 w-3.5 text-success" /> : <Copy className="h-3.5 w-3.5" />}
          {copied ? "Copiado" : "Copiar"}
        </Button>
      </div>
      <code className="mt-2 block break-all rounded bg-background/60 p-2 font-mono text-[10px] text-muted-foreground">
        {url}
      </code>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────
// NumberBuyWizard — search on Twilio + buy + auto-register in phone_numbers
function NumberBuyWizard({
  open,
  onOpenChange,
  accountId,
  inboxes,
  personas,
  onBought,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  accountId: string;
  inboxes: Array<{ id: string; name: string }>;
  personas: Persona[];
  onBought: () => void;
}) {
  const [countryCode, setCountryCode] = useState("BR");
  const [areaCode, setAreaCode] = useState("");
  const [contains, setContains] = useState("");
  const [type, setType] = useState<"Local" | "TollFree" | "Mobile">("Local");
  const [searching, setSearching] = useState(false);
  const [results, setResults] = useState<import("@/lib/twilio").AvailableNumber[]>([]);
  const [buying, setBuying] = useState<string | null>(null);
  const [pickedInboxId, setPickedInboxId] = useState<string>("");
  const [pickedPersonaId, setPickedPersonaId] = useState<string>("");

  const handleSearch = async () => {
    if (!accountId) return;
    setSearching(true);
    setResults([]);
    try {
      const { searchAvailableNumbers } = await import("@/lib/twilio");
      const rows = await searchAvailableNumbers({
        countryCode,
        type,
        areaCode: areaCode.trim() || undefined,
        contains: contains.trim() || undefined,
        accountId,
      });
      setResults(rows);
      if (rows.length === 0) toast.info("Nenhum número disponível para esses filtros");
    } catch (e: any) {
      toast.error(e?.message ?? "Falha na busca");
    } finally {
      setSearching(false);
    }
  };

  const handleBuy = async (phoneNumber: string) => {
    if (!accountId) return;
    setBuying(phoneNumber);
    try {
      const { buyNumber } = await import("@/lib/twilio");
      await buyNumber({
        accountId,
        phoneNumber,
        inboxId: pickedInboxId || null,
        pinnedPersonaId: pickedPersonaId || null,
      });
      toast.success(`${phoneNumber} comprado e configurado`);
      onBought();
    } catch (e: any) {
      toast.error(e?.message ?? "Falha na compra");
    } finally {
      setBuying(null);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Comprar número Twilio</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div className="grid grid-cols-4 gap-2">
            <div>
              <Label className="text-xs">País</Label>
              <Input value={countryCode} onChange={(e) => setCountryCode(e.target.value.toUpperCase())} maxLength={2} />
            </div>
            <div>
              <Label className="text-xs">Tipo</Label>
              <select
                value={type}
                onChange={(e) => setType(e.target.value as any)}
                className="w-full rounded-md border border-white/[0.08] bg-transparent px-2 py-1.5 text-xs"
              >
                <option value="Local">Local</option>
                <option value="TollFree">Toll-Free</option>
                <option value="Mobile">Mobile</option>
              </select>
            </div>
            <div>
              <Label className="text-xs">Area code</Label>
              <Input value={areaCode} onChange={(e) => setAreaCode(e.target.value)} placeholder="11" />
            </div>
            <div>
              <Label className="text-xs">Contém</Label>
              <Input value={contains} onChange={(e) => setContains(e.target.value)} placeholder="999*" />
            </div>
          </div>

          <Button onClick={handleSearch} disabled={searching} className="w-full">
            {searching ? "Buscando…" : "Buscar números disponíveis"}
          </Button>

          {results.length > 0 && (
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <Label className="text-xs">Inbox para receber</Label>
                  <select
                    value={pickedInboxId}
                    onChange={(e) => setPickedInboxId(e.target.value)}
                    className="w-full rounded-md border border-white/[0.08] bg-transparent px-2 py-1.5 text-xs"
                  >
                    <option value="">— nenhuma —</option>
                    {inboxes.map((i) => (
                      <option key={i.id} value={i.id}>{i.name}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <Label className="text-xs">Persona pinada</Label>
                  <select
                    value={pickedPersonaId}
                    onChange={(e) => setPickedPersonaId(e.target.value)}
                    className="w-full rounded-md border border-white/[0.08] bg-transparent px-2 py-1.5 text-xs"
                  >
                    <option value="">— nenhuma —</option>
                    {personas.map((p) => (
                      <option key={p.id} value={p.id}>{p.name}</option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="max-h-80 space-y-1.5 overflow-y-auto">
                {results.map((r) => (
                  <div key={r.phoneNumber} className="flex items-center justify-between rounded-md border border-white/[0.06] p-2.5">
                    <div>
                      <div className="font-mono text-xs">{r.phoneNumber}</div>
                      <div className="text-[10px] text-muted-foreground">
                        {r.locality ?? ""} {r.region ?? ""} · {" "}
                        {r.capabilities.voice && "📞 "}
                        {r.capabilities.sms && "💬 "}
                        {r.capabilities.mms && "🖼️ "}
                      </div>
                    </div>
                    <Button size="sm" onClick={() => handleBuy(r.phoneNumber)} disabled={buying !== null}>
                      {buying === r.phoneNumber ? "Comprando…" : "Comprar"}
                    </Button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ──────────────────────────────────────────────────────────────────
// VoiceCallDetailSheet — recording player + transcript + metadata
function VoiceCallDetailSheet({
  call,
  onClose,
}: {
  call: any | null;
  onClose: () => void;
  onRetry: () => void;
}) {
  if (!call) return null;

  const utterances = Array.isArray(call.transcript) ? (call.transcript as any[]) : [];
  const status = call.transcription_status ?? "idle";

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>
            <span className="font-mono">{call.direction === "inbound" ? call.from_number : call.to_number}</span>
            <span className="ml-2 text-sm text-muted-foreground">
              {call.direction === "inbound" ? "→ entrante" : "→ saída"} · {call.duration_seconds}s
            </span>
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <CallRecordingPlayer call={call} />


          <div className="space-y-1">
            <div className="flex items-center justify-between">
              <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">
                Transcrição ({status})
              </Label>
            </div>
            {utterances.length === 0 ? (
              <p className="rounded-md border border-dashed border-white/[0.1] p-3 text-center text-xs text-muted-foreground">
                {status === "failed" ? call.transcription_error ?? "falha" : "Transcrição não configurada"}
              </p>
            ) : (
              <div className="max-h-80 space-y-2 overflow-y-auto rounded-md border border-white/[0.06] bg-white/[0.01] p-3">
                {utterances.map((u: any, i: number) => (
                  <div key={i} className="text-xs">
                    <span className="mr-2 rounded bg-primary/15 px-1.5 py-0.5 text-[9px] text-primary">
                      Speaker {u.speaker}
                    </span>
                    <span className="text-muted-foreground">
                      {formatSec(u.start)} · {u.transcript}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function formatSec(n: number): string {
  const m = Math.floor(n / 60);
  const s = Math.floor(n % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

// Import an existing Twilio number (e.g. the trial's free +1 number) into
// cobrAI. Just takes the E.164 number the user sees on the Twilio dashboard,
// re-points its webhooks, and registers the phone_numbers row. No purchase.
function ImportNumberDialog({
  open,
  onOpenChange,
  accountId,
  personas,
  onImported,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  accountId: string;
  personas: Persona[];
  onImported: () => void;
}) {
  const [selected, setSelected] = useState<string>("");
  const [manual, setManual] = useState("");
  const [personaId, setPersonaId] = useState<string>("");
  const [behavior, setBehavior] = useState<"ai_answer" | "voicemail">("ai_answer");
  const [saving, setSaving] = useState(false);
  const [owned, setOwned] = useState<OwnedTwilioNumber[] | null>(null);
  const [loadingOwned, setLoadingOwned] = useState(false);
  const [ownedError, setOwnedError] = useState<string | null>(null);

  // Picked a verified Caller ID from the list → outbound-only, so inbound
  // settings don't apply (backend forces inbound_behavior to voicemail).
  const selectedCallerIdOnly = useMemo(
    () => !!owned?.find((n) => n.phone_number === selected)?.verified_caller_id_only,
    [owned, selected],
  );

  useEffect(() => {
    if (!open) return;
    const active = personas.find((p) => p.status === "active") ?? personas[0];
    if (active) setPersonaId(active.id);
    setSelected("");
    setManual("");
    setOwnedError(null);
    // Fetch Twilio-owned numbers.
    (async () => {
      setLoadingOwned(true);
      try {
        const { fetchOwnedTwilioNumbers } = await import("@/lib/twilio");
        const list = await fetchOwnedTwilioNumbers(accountId);
        setOwned(list);
        const firstAvailable = list.find((n) => !n.already_imported);
        if (firstAvailable) setSelected(firstAvailable.phone_number);
      } catch (e: any) {
        setOwnedError(e?.message ?? "Não consegui listar números Twilio");
      } finally {
        setLoadingOwned(false);
      }
    })();
  }, [open, personas, accountId]);

  const handleImport = async () => {
    const input = selected || manual;
    const normalized = input.trim().startsWith("+") ? input.trim() : `+${input.trim()}`;
    if (!/^\+\d{8,15}$/.test(normalized)) {
      toast.error("Selecione um número da lista ou digite em E.164 (ex: +17179907747)");
      return;
    }
    setSaving(true);
    try {
      const { importTwilioNumber } = await import("@/lib/twilio");
      const res = await importTwilioNumber({
        accountId,
        phoneNumber: normalized,
        pinnedPersonaId: personaId || null,
        inboundBehavior: behavior,
      });
      if (res?.phone_number && isVerifiedCallerIdOnly(res.phone_number)) {
        toast.success(
          `Número ${normalized} importado como Caller ID — só saída (não recebe ligações/SMS)`,
        );
      } else {
        toast.success(`Número ${normalized} importado — ligue e teste`);
      }
      onImported();
    } catch (e: any) {
      toast.error(e?.message ?? "Falha ao importar");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Importar número Twilio existente</DialogTitle>
          <DialogDescription>
            Use pra registrar o número que você já tem na conta Twilio (incluindo o número grátis da
            trial). A gente aponta os webhooks sozinhos. Números verificados como Caller ID também
            aparecem, mas servem só pra ligar — não recebem ligações nem SMS.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 text-sm">
          <div className="space-y-1.5">
            <Label>Número na conta Twilio</Label>
            {loadingOwned ? (
              <div className="flex items-center gap-2 rounded-md border border-white/[0.06] px-3 py-2 text-[11px] text-muted-foreground">
                <Loader2 className="h-3 w-3 animate-spin" /> Buscando números na Twilio…
              </div>
            ) : ownedError ? (
              <div className="rounded-md border border-rose-500/30 bg-rose-500/[0.05] px-3 py-2 text-[11px] text-rose-300">
                {ownedError}
              </div>
            ) : (owned?.length ?? 0) === 0 ? (
              <div className="rounded-md border border-amber-500/30 bg-amber-500/[0.05] px-3 py-2 text-[11px] text-amber-200">
                Nenhum número na tua conta Twilio ainda. Compre/pegue o grátis da trial primeiro.
              </div>
            ) : (
              <div className="space-y-1">
                {owned!.map((n) => {
                  const disabled = n.already_imported;
                  const active = selected === n.phone_number;
                  return (
                    <button
                      key={n.sid}
                      type="button"
                      disabled={disabled}
                      onClick={() => {
                        setSelected(n.phone_number);
                        setManual("");
                      }}
                      className={cn(
                        "flex w-full items-center justify-between rounded-md border p-2 text-left transition-colors",
                        disabled && "cursor-not-allowed opacity-50",
                        active
                          ? "border-violet-500/40 bg-violet-500/[0.08]"
                          : "border-white/[0.06] hover:bg-white/[0.03]",
                      )}
                    >
                      <div className="min-w-0">
                        <div className="font-mono text-[12px] font-medium">{n.phone_number}</div>
                        <div className="truncate text-[10px] text-muted-foreground">
                          {n.friendly_name || "sem apelido"}
                          {disabled
                            ? " · já importado"
                            : n.verified_caller_id_only
                              ? " · Caller ID verificado"
                              : n.capabilities?.voice
                                ? " · voz"
                                : ""}
                        </div>
                      </div>
                      <div className="flex shrink-0 items-center gap-1.5">
                        {n.verified_caller_id_only && (
                          <span
                            className="inline-flex items-center gap-1 rounded border border-amber-500/40 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-amber-600"
                            title="Só pode ser usado pra ligar. Não recebe ligações nem SMS."
                          >
                            <PhoneOutgoing className="h-2.5 w-2.5" />
                            Só saída
                          </span>
                        )}
                        {active && <Check className="h-3.5 w-3.5 text-violet-300" />}
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="imp-manual" className="text-[10px] text-muted-foreground">
              ou digite manualmente
            </Label>
            <Input
              id="imp-manual"
              value={manual}
              onChange={(e) => {
                setManual(e.target.value);
                if (e.target.value) setSelected("");
              }}
              placeholder="+17179907747"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="imp-persona">
              {selectedCallerIdOnly ? "Agente que liga" : "Agente que atende"}
            </Label>
            <select
              id="imp-persona"
              value={personaId}
              onChange={(e) => setPersonaId(e.target.value)}
              className="h-9 w-full rounded-md border border-white/[0.08] bg-background px-2 text-sm"
            >
              <option value="">— Nenhum (voicemail) —</option>
              {personas.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                  {p.voice_clone_id ? " (voz configurada)" : " (voz padrão)"}
                </option>
              ))}
            </select>
          </div>
          {selectedCallerIdOnly ? (
            <div className="flex items-start gap-2 rounded-md border border-amber-500/30 bg-amber-500/[0.05] px-3 py-2 text-[11px] leading-relaxed text-foreground/80">
              <PhoneOutgoing className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-600" />
              <span>
                Esse número é um <strong>Caller ID verificado</strong>, não foi comprado na Twilio.
                Ele entra como <strong>só saída</strong>: dá pra usar em campanhas e ligações, mas
                ligações e SMS recebidos continuam indo pra operadora do chip.
              </span>
            </div>
          ) : (
            <div className="space-y-1.5">
              <Label>Comportamento de entrada</Label>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setBehavior("ai_answer")}
                  className={cn(
                    "flex-1 rounded-md border px-3 py-2 text-[12px] font-medium transition-colors",
                    behavior === "ai_answer"
                      ? "border-primary bg-primary/10 text-primary"
                      : "border-border bg-background text-foreground hover:bg-muted",
                  )}
                >
                  IA atende
                </button>
                <button
                  type="button"
                  onClick={() => setBehavior("voicemail")}
                  className={cn(
                    "flex-1 rounded-md border px-3 py-2 text-[12px] font-medium transition-colors",
                    behavior === "voicemail"
                      ? "border-primary bg-primary/10 text-primary"
                      : "border-border bg-background text-foreground hover:bg-muted",
                  )}
                >
                  Voicemail
                </button>
              </div>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            Cancelar
          </Button>
          <Button onClick={handleImport} disabled={saving}>
            {saving && <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />}
            Importar e ativar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// Plays a call recording from either the legacy Twilio recording_url
// (public signed URL) or ElevenLabs's /v1/convai/conversations/{id}/audio
// (proxied via elevenlabs-call-audio to keep the API key server-side).
function CallRecordingPlayer({ call }: { call: any }) {
  const [loading, setLoading] = useState(false);
  const [audioSrc, setAudioSrc] = useState<string | null>(call?.recording_url ?? null);
  const [error, setError] = useState<string | null>(null);

  // Legacy Twilio case — URL already public, render audio right away.
  const hasTwilioUrl = !!call?.recording_url;
  const hasElSource = !!call?.source_id && !hasTwilioUrl;

  const handleLoad = async () => {
    if (!call?.id) return;
    setLoading(true);
    setError(null);
    try {
      const sess = await supabase.auth.getSession();
      const token = sess.data.session?.access_token;
      if (!token) throw new Error("Você precisa estar logado");
      const res = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/elevenlabs-call-audio`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY ?? "",
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ voice_call_id: call.id }),
        },
      );
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(`${res.status}: ${text.slice(0, 150)}`);
      }
      const blob = await res.blob();
      setAudioSrc(URL.createObjectURL(blob));
    } catch (e: any) {
      setError(e?.message ?? "Falha ao carregar gravação");
    } finally {
      setLoading(false);
    }
  };

  if (audioSrc) {
    return (
      <div className="space-y-1">
        <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">
          Gravação
        </Label>
        <audio src={audioSrc} controls className="w-full" />
        <a
          href={audioSrc}
          download={`call-${call?.id?.slice(0, 8) ?? "audio"}.mp3`}
          className="text-[10px] text-violet-300 hover:text-violet-200"
        >
          Baixar MP3
        </a>
      </div>
    );
  }

  if (hasElSource) {
    return (
      <div className="space-y-1">
        <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">
          Gravação
        </Label>
        <div className="rounded-md border border-dashed border-white/[0.1] p-3 text-center">
          {error ? (
            <p className="text-xs text-rose-300">{error}</p>
          ) : (
            <p className="text-xs text-muted-foreground">
              Áudio gerenciado pelo ElevenLabs — clique pra carregar.
            </p>
          )}
          <Button size="sm" variant="outline" onClick={handleLoad} disabled={loading} className="mt-2">
            {loading ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : null}
            {loading ? "Carregando…" : error ? "Tentar de novo" : "Carregar gravação"}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <p className="rounded-md border border-dashed border-white/[0.1] p-3 text-center text-xs text-muted-foreground">
      Sem gravação disponível para esta chamada.
    </p>
  );
}
