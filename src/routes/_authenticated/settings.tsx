import { useEffect, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { Copy, Check, Loader2, KeyRound, PhoneCall } from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useAccount } from "@/lib/account-context";
import {
  ensureWebhookSecret,
  fetchAccount,
  updateAccountSettings,
  fetchDialingSettings,
  updateDialingSettings,
  DEFAULT_DIALING_SETTINGS,
  type DialingSettings,
  type DayKey,
} from "@/lib/settings";
import { advanceOnboardingStep, reopenOnboarding } from "@/lib/onboarding";
import {
  fetchCompanySettings,
  upsertCompanySettings,
  mirrorCompanyNameIfEmpty,
  type CompanySettings,
} from "@/lib/company-settings";
import { WebhookDeliveriesPanel } from "@/components/settings/WebhookDeliveriesPanel";
import { IntegrationsTab } from "@/components/settings/IntegrationsTab";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/settings")({
  head: () => ({
    meta: [
      { title: "Configurações — cobrAI" },
      {
        name: "description",
        content: "Integrações, dados da empresa e webhooks.",
      },
    ],
  }),
  component: SettingsPage,
});

function SettingsPage() {
  return (
    <div className="flex flex-col">
      <PageHeader
        eyebrow="Ajustes"
        title="Configurações"
        description="Dados da empresa, integrações e chaves de acesso."
      />
      <div className="px-6 py-6">
        <Tabs defaultValue="integrations" className="w-full">
          <TabsList className="mb-4 bg-white/[0.04]">
            <TabsTrigger value="integrations">Integrações</TabsTrigger>
            <TabsTrigger value="general">Geral</TabsTrigger>
            <TabsTrigger value="dialing">Discagem</TabsTrigger>
            <TabsTrigger value="api-keys">Chaves de acesso</TabsTrigger>
            <TabsTrigger value="webhooks">Webhooks</TabsTrigger>
          </TabsList>
          <TabsContent value="integrations">
            <IntegrationsTab />
          </TabsContent>
          <TabsContent value="general">
            <GeneralTab />
          </TabsContent>
          <TabsContent value="dialing">
            <DialingTab />
          </TabsContent>
          <TabsContent value="api-keys">
            <ApiKeysTab />
          </TabsContent>
          <TabsContent value="webhooks">
            <WebhooksTab />
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}

function Card({ children, title, desc }: { children: React.ReactNode; title: string; desc?: string }) {
  return (
    <section className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-5">
      <div className="mb-4">
        <h2 className="text-[14px] font-semibold">{title}</h2>
        {desc && <p className="mt-1 text-[12px] text-muted-foreground">{desc}</p>}
      </div>
      {children}
    </section>
  );
}

function GeneralTab() {
  const { accountId, role } = useAccount();
  const [name, setName] = useState("");
  const [supportEmail, setSupportEmail] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [reopening, setReopening] = useState(false);

  const handleReopenOnboarding = async () => {
    if (!accountId) return;
    setReopening(true);
    try {
      await reopenOnboarding(accountId);
      toast.success("Reabrindo o assistente de configuração...");
      setTimeout(() => window.location.reload(), 600);
    } catch (e: any) {
      toast.error(e?.message ?? "Não foi possível reabrir o onboarding.");
      setReopening(false);
    }
  };

  useEffect(() => {
    if (!accountId) {
      setLoading(false);
      return;
    }
    fetchAccount(accountId)
      .then((acct) => {
        setName(acct.name ?? "");
        setSupportEmail(acct.support_email ?? "");
      })
      .finally(() => setLoading(false));
  }, [accountId]);

  const save = async () => {
    if (!accountId) return;
    setSaving(true);
    try {
      await updateAccountSettings(accountId, { name, support_email: supportEmail });
      await advanceOnboardingStep(accountId, "empresa", { name, support_email: supportEmail }).catch(() => {});
      // Garante que a IA fala o nome certo na ligação. Não sobrescreve se o
      // admin já editou o nome em "Dados da empresa" abaixo.
      await mirrorCompanyNameIfEmpty(accountId, name).catch(() => {});
      toast.success("Configurações salvas");
    } catch (e) {
      toast.error("Não conseguimos salvar. Verifique os dados e tente novamente.");
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-5 w-5 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <Card title="Organização" desc="Nome da empresa cobradora e e-mail de suporte.">
        <div className="space-y-4">
          <div>
            <label className="mb-1.5 block text-[11px] font-medium text-muted-foreground">
              Nome da empresa
            </label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full rounded-md border border-white/[0.06] bg-white/[0.02] px-3 py-2 text-[13px] focus:outline-none focus:ring-1 focus:ring-primary/40"
            />
          </div>
          <div>
            <label className="mb-1.5 block text-[11px] font-medium text-muted-foreground">
              E-mail de suporte
            </label>
            <input
              type="email"
              value={supportEmail}
              onChange={(e) => setSupportEmail(e.target.value)}
              placeholder="suporte@empresa.com"
              className="w-full rounded-md border border-white/[0.06] bg-white/[0.02] px-3 py-2 text-[13px] focus:outline-none focus:ring-1 focus:ring-primary/40"
            />
          </div>
          <button
            onClick={save}
            disabled={saving}
            className="inline-flex items-center gap-2 rounded-md bg-gradient-to-r from-fuchsia-500 to-violet-500 px-4 py-2 text-[12px] font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            Salvar
          </button>
        </div>
      </Card>

      <CompanyDataCard />

      {role === "admin" && (
        <Card
          title="Assistente de configuração"
          desc="Reabra o passo a passo inicial para reconfigurar provedores, agente e número."
        >
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-[12px] text-muted-foreground">
              O wizard só aparece automaticamente uma vez. Use este botão para abri-lo
              novamente — útil após trocar credenciais ou onboarding de novos provedores.
            </p>
            <button
              onClick={handleReopenOnboarding}
              disabled={reopening}
              className="inline-flex shrink-0 items-center gap-2 rounded-md border border-white/[0.08] bg-white/[0.04] px-4 py-2 text-[12px] font-semibold transition-colors hover:bg-white/[0.08] disabled:opacity-50"
            >
              {reopening && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              Reabrir onboarding
            </button>
          </div>
        </Card>
      )}
    </div>
  );
}

// ============================================================
// Dados da empresa — usados em ligação pela IA
// ============================================================
// Esta seção edita company_settings (NÃO accounts). É de onde o agente
// de voz puxa {{company_name}}, {{support_phone}}, defaults de negociação.
// Sem isso preenchido, a IA fala "sua empresa" e não tem pra onde transferir.
function CompanyDataCard() {
  const { accountId, role } = useAccount();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [data, setData] = useState<CompanySettings>({
    account_id: "",
    company_name: "",
    cnpj: null,
    support_phone: null,
    reply_email: null,
    legal_footer: null,
    default_discount_pct: 10,
    default_max_installments: 6,
  });

  useEffect(() => {
    if (!accountId) return;
    setLoading(true);
    fetchCompanySettings(accountId)
      .then((cs) => {
        if (cs) setData(cs);
        else {
          // Pré-popula com o nome do account para reduzir fricção.
          fetchAccount(accountId)
            .then((acct) => setData((d) => ({ ...d, company_name: acct.name ?? "" })))
            .catch(() => {});
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [accountId]);

  const save = async () => {
    if (!accountId) return;
    if (!data.company_name.trim()) {
      toast.error("Informe o nome da empresa.");
      return;
    }
    setSaving(true);
    try {
      await upsertCompanySettings(accountId, {
        company_name: data.company_name.trim(),
        cnpj: data.cnpj,
        support_phone: data.support_phone,
        reply_email: data.reply_email,
        legal_footer: data.legal_footer,
        default_discount_pct: data.default_discount_pct,
        default_max_installments: data.default_max_installments,
      });
      toast.success("Dados da empresa salvos. A IA vai usar nas próximas chamadas.");
    } catch (e) {
      toast.error("Não conseguimos salvar. Tente novamente.");
    } finally {
      setSaving(false);
    }
  };

  if (role !== "admin") return null;
  if (loading) {
    return (
      <Card title="Dados da empresa (usados pela IA)" desc="Carregando…">
        <div className="flex items-center justify-center py-6">
          <Loader2 className="h-4 w-4 animate-spin text-primary" />
        </div>
      </Card>
    );
  }

  const fieldClass =
    "w-full rounded-md border border-white/[0.06] bg-white/[0.02] px-3 py-2 text-[13px] focus:outline-none focus:ring-1 focus:ring-primary/40";

  return (
    <Card
      title="Dados da empresa (usados pela IA em ligação)"
      desc="A Bia usa esses dados para se identificar, passar o caso para a equipe quando não consegue resolver e respeitar os limites de negociação."
    >
      <div className="space-y-4">
        <div>
          <label className="mb-1.5 block text-[11px] font-medium text-muted-foreground">
            Nome da empresa <span className="text-rose-500">*</span>
          </label>
          <input
            value={data.company_name}
            onChange={(e) => setData({ ...data, company_name: e.target.value })}
            placeholder="Ex: Imóveis Atlas"
            className={fieldClass}
          />
          <p className="mt-1 text-[11px] text-muted-foreground">
            A IA dirá: <em>"…aqui é &lt;nome do agente&gt; da <strong>{data.company_name || "{empresa}"}</strong>"</em>.
          </p>
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div>
            <label className="mb-1.5 block text-[11px] font-medium text-muted-foreground">
              WhatsApp da equipe
            </label>
            <input
              value={data.support_phone ?? ""}
              onChange={(e) => setData({ ...data, support_phone: e.target.value || null })}
              placeholder="+5548999999999"
              className={fieldClass}
            />
            <p className="mt-1 text-[11px] text-muted-foreground">
              Quando a Bia não consegue resolver, a equipe recebe aqui o resumo do caso e chama o cliente.
            </p>
          </div>

          <div>
            <label className="mb-1.5 block text-[11px] font-medium text-muted-foreground">
              CNPJ
            </label>
            <input
              value={data.cnpj ?? ""}
              onChange={(e) => setData({ ...data, cnpj: e.target.value || null })}
              placeholder="00.000.000/0001-00"
              className={fieldClass}
            />
          </div>

          <div>
            <label className="mb-1.5 block text-[11px] font-medium text-muted-foreground">
              E-mail de retorno
            </label>
            <input
              type="email"
              value={data.reply_email ?? ""}
              onChange={(e) => setData({ ...data, reply_email: e.target.value || null })}
              placeholder="cobranca@empresa.com"
              className={fieldClass}
            />
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="mb-1.5 block text-[11px] font-medium text-muted-foreground">
                Desconto padrão (%)
              </label>
              <input
                type="number"
                min={0}
                max={100}
                value={data.default_discount_pct ?? 0}
                onChange={(e) =>
                  setData({ ...data, default_discount_pct: Number(e.target.value) || 0 })
                }
                className={fieldClass}
              />
            </div>
            <div>
              <label className="mb-1.5 block text-[11px] font-medium text-muted-foreground">
                Máx. parcelas
              </label>
              <input
                type="number"
                min={1}
                max={36}
                value={data.default_max_installments ?? 1}
                onChange={(e) =>
                  setData({ ...data, default_max_installments: Number(e.target.value) || 1 })
                }
                className={fieldClass}
              />
            </div>
          </div>
        </div>

        <div>
          <label className="mb-1.5 block text-[11px] font-medium text-muted-foreground">
            Rodapé legal (opcional)
          </label>
          <textarea
            value={data.legal_footer ?? ""}
            onChange={(e) => setData({ ...data, legal_footer: e.target.value || null })}
            rows={2}
            placeholder="Ex: Esta cobrança é amparada pelo CDC art. 42…"
            className={cn(fieldClass, "resize-y font-mono text-[12px]")}
          />
        </div>

        <button
          onClick={save}
          disabled={saving}
          className="inline-flex items-center gap-2 rounded-md bg-gradient-to-r from-fuchsia-500 to-violet-500 px-4 py-2 text-[12px] font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-50"
        >
          {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
          Salvar dados da empresa
        </button>
      </div>
    </Card>
  );
}

// ============================================================
// Dialing window settings
// ============================================================

const DAY_LABELS: Record<DayKey, string> = {
  mon: "Segunda",
  tue: "Terça",
  wed: "Quarta",
  thu: "Quinta",
  fri: "Sexta",
  sat: "Sábado",
  sun: "Domingo",
};

const DAY_ORDER: DayKey[] = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];

function DialingTab() {
  const { accountId } = useAccount();
  const [settings, setSettings] = useState<DialingSettings>(DEFAULT_DIALING_SETTINGS);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!accountId) {
      setLoading(false);
      return;
    }
    fetchDialingSettings(accountId)
      .then(setSettings)
      .catch(() => toast.error("Não foi possível carregar a configuração."))
      .finally(() => setLoading(false));
  }, [accountId]);

  const toggleDay = (day: DayKey, enabled: boolean) => {
    setSettings((prev) => ({
      ...prev,
      allowed_hours_local: {
        ...prev.allowed_hours_local,
        [day]: enabled ? [9, 18] : null,
      },
    }));
  };

  const setHour = (day: DayKey, idx: 0 | 1, value: number) => {
    setSettings((prev) => {
      const cur = prev.allowed_hours_local[day];
      if (!cur) return prev;
      const next: [number, number] = [...cur] as [number, number];
      next[idx] = value;
      return {
        ...prev,
        allowed_hours_local: { ...prev.allowed_hours_local, [day]: next },
      };
    });
  };

  const save = async () => {
    if (!accountId) return;
    // validação básica: end > start
    for (const d of DAY_ORDER) {
      const r = settings.allowed_hours_local[d];
      if (r && r[1] <= r[0]) {
        toast.error(`${DAY_LABELS[d]}: hora final deve ser maior que a inicial.`);
        return;
      }
    }
    setSaving(true);
    try {
      await updateDialingSettings(accountId, settings);
      toast.success("Janela de discagem salva.");
    } catch {
      toast.error("Não conseguimos salvar.");
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-5 w-5 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <Card
        title="Janela de discagem"
        desc="Quando o sistema pode disparar ligações outbound. Fora desta janela, qualquer ligação (manual ou em campanha) é bloqueada."
      >
        <div className="space-y-4">
          <div>
            <label className="mb-1.5 block text-[11px] font-medium text-muted-foreground">
              Fuso horário
            </label>
            <input
              value={settings.timezone}
              onChange={(e) => setSettings((p) => ({ ...p, timezone: e.target.value }))}
              className="w-full max-w-xs rounded-md border border-white/[0.06] bg-white/[0.02] px-3 py-2 text-[13px] focus:outline-none focus:ring-1 focus:ring-primary/40"
              placeholder="America/Sao_Paulo"
            />
          </div>

          <div className="space-y-2">
            <label className="block text-[11px] font-medium text-muted-foreground">
              Dias e horários permitidos
            </label>
            {DAY_ORDER.map((day) => {
              const range = settings.allowed_hours_local[day];
              const enabled = range !== null;
              return (
                <div
                  key={day}
                  className="flex items-center gap-3 rounded-md border border-white/[0.06] bg-white/[0.02] px-3 py-2"
                >
                  <label className="flex w-32 items-center gap-2 text-[12px]">
                    <input
                      type="checkbox"
                      checked={enabled}
                      onChange={(e) => toggleDay(day, e.target.checked)}
                      className="h-3.5 w-3.5 accent-primary"
                    />
                    {DAY_LABELS[day]}
                  </label>
                  {enabled && range ? (
                    <div className="flex items-center gap-2 text-[12px]">
                      <HourInput
                        value={range[0]}
                        onChange={(v) => setHour(day, 0, v)}
                      />
                      <span className="text-muted-foreground">até</span>
                      <HourInput
                        value={range[1]}
                        onChange={(v) => setHour(day, 1, v)}
                      />
                    </div>
                  ) : (
                    <span className="text-[11px] text-muted-foreground">
                      Sem ligações
                    </span>
                  )}
                </div>
              );
            })}
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <label className="mb-1.5 block text-[11px] font-medium text-muted-foreground">
                Máx. tentativas por dia (mesmo número)
              </label>
              <input
                type="number"
                min={1}
                max={50}
                value={settings.max_attempts_per_day}
                onChange={(e) =>
                  setSettings((p) => ({
                    ...p,
                    max_attempts_per_day: Math.max(1, Number(e.target.value) || 1),
                  }))
                }
                className="w-full rounded-md border border-white/[0.06] bg-white/[0.02] px-3 py-2 text-[13px] focus:outline-none focus:ring-1 focus:ring-primary/40"
              />
            </div>
            <div>
              <label className="mb-1.5 block text-[11px] font-medium text-muted-foreground">
                Intervalo mínimo entre tentativas (min)
              </label>
              <input
                type="number"
                min={0}
                max={1440}
                value={settings.min_minutes_between_attempts}
                onChange={(e) =>
                  setSettings((p) => ({
                    ...p,
                    min_minutes_between_attempts: Math.max(0, Number(e.target.value) || 0),
                  }))
                }
                className="w-full rounded-md border border-white/[0.06] bg-white/[0.02] px-3 py-2 text-[13px] focus:outline-none focus:ring-1 focus:ring-primary/40"
              />
            </div>
          </div>

          <div className="flex items-center gap-3 pt-2">
            <button
              onClick={save}
              disabled={saving}
              className="inline-flex items-center gap-2 rounded-md bg-gradient-to-r from-fuchsia-500 to-violet-500 px-4 py-2 text-[12px] font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-50"
            >
              {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              Salvar
            </button>
            <button
              onClick={() => setSettings(DEFAULT_DIALING_SETTINGS)}
              className="text-[12px] text-muted-foreground hover:text-foreground"
            >
              Restaurar padrão
            </button>
            <span className="ml-auto inline-flex items-center gap-1.5 text-[11px] text-muted-foreground">
              <PhoneCall className="h-3 w-3" />
              Aplica-se a campanhas e ligações manuais
            </span>
          </div>
        </div>
      </Card>
    </div>
  );
}

function HourInput({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(Number(e.target.value))}
      className="rounded-md border border-white/[0.06] bg-white/[0.02] px-2 py-1 text-[12px] focus:outline-none focus:ring-1 focus:ring-primary/40"
    >
      {Array.from({ length: 25 }, (_, i) => i).map((h) => (
        <option key={h} value={h}>
          {String(h).padStart(2, "0")}:00
        </option>
      ))}
    </select>
  );
}

const REQUIRED_KEYS = [
  {
    key: "ELEVENLABS_API_KEY",
    name: "ElevenLabs",
    desc: "Voz neural para o agente de cobrança (TTS + agentes conversacionais).",
    required: true,
    autoProvisioned: false,
  },
  {
    key: "TWILIO_ACCOUNT_SID",
    name: "Twilio",
    desc: "Telefonia (chamadas para devedores).",
    required: true,
    autoProvisioned: false,
  },
  {
    key: "EVOLUTION_API_URL",
    name: "Evolution (WhatsApp)",
    desc: "Enviar proposta de pagamento por WhatsApp após acordo.",
    required: false,
    autoProvisioned: false,
  },
  {
    key: "RESEND_API_KEY",
    name: "Resend",
    desc: "Enviar proposta de pagamento por e-mail após acordo.",
    required: false,
    autoProvisioned: false,
  },
  {
    key: "ASAAS_API_KEY",
    name: "Asaas",
    desc: "Gerar cobranças PIX/boleto na negociação.",
    required: false,
    autoProvisioned: false,
  },
];

function ApiKeysTab() {
  return (
    <div className="space-y-4">
      <Card
        title="Integrações"
        desc="Status das chaves configuradas. Gerencie via Supabase Secrets."
      >
        <div className="space-y-2">
          {REQUIRED_KEYS.map((k) => (
            <div
              key={k.key}
              className="flex items-start justify-between gap-4 rounded-lg border border-white/[0.06] bg-white/[0.02] p-3"
            >
              <div className="flex items-start gap-3">
                <KeyRound className="mt-0.5 h-4 w-4 text-muted-foreground" />
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-[12px] font-semibold">{k.name}</span>
                    {k.required && (
                      <span className="rounded-full bg-rose-500/20 px-1.5 py-0.5 text-[9px] font-semibold text-rose-300">
                        Obrigatória
                      </span>
                    )}
                  </div>
                  <p className="mt-0.5 text-[11px] text-muted-foreground">{k.desc}</p>
                  <code className="mt-1 inline-block rounded bg-white/[0.04] px-1.5 py-0.5 text-[10px] text-slate-400">
                    {k.key}
                  </code>
                </div>
              </div>
              <span
                className={cn(
                  "shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium",
                  k.autoProvisioned
                    ? "bg-emerald-500/20 text-emerald-300"
                    : "bg-slate-500/20 text-slate-400",
                )}
              >
                {k.autoProvisioned ? "Auto-provisionado" : "Configure no Supabase"}
              </span>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}

function WebhooksTab() {
  const { accountId } = useAccount();
  const [secret, setSecret] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState<string | null>(null);

  useEffect(() => {
    if (!accountId) {
      setLoading(false);
      return;
    }
    ensureWebhookSecret(accountId)
      .then(setSecret)
      .catch(() => toast.error("Não foi possível gerar o secret"))
      .finally(() => setLoading(false));
  }, [accountId]);

  const copy = (text: string, key: string) => {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(key);
      toast.success("Copiado");
      setTimeout(() => setCopied(null), 1500);
    });
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-5 w-5 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <Card title="Webhook secret" desc="HMAC SHA-256 para assinar payloads enviados ao cobrAI.">
        {secret && (
          <UrlField
            label="Webhook secret"
            value={secret}
            onCopy={() => copy(secret, "secret")}
            copied={copied === "secret"}
            mono
          />
        )}
      </Card>
      <Card title="Recebimentos recentes" desc="Histórico das últimas chamadas recebidas.">
        <WebhookDeliveriesPanel />
      </Card>
    </div>
  );
}

function UrlField({
  label,
  value,
  onCopy,
  copied,
  mono,
}: {
  label: string;
  value: string;
  onCopy: () => void;
  copied: boolean;
  mono?: boolean;
}) {
  return (
    <div>
      <label className="mb-1.5 block text-[11px] font-medium text-muted-foreground">{label}</label>
      <div className="flex gap-1">
        <input
          readOnly
          value={value}
          className={cn(
            "flex-1 rounded-md border border-white/[0.06] bg-white/[0.02] px-3 py-2 text-[12px] focus:outline-none",
            mono && "font-mono",
          )}
        />
        <button
          onClick={onCopy}
          className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-white/[0.06] bg-white/[0.02] text-muted-foreground hover:text-foreground"
          aria-label="Copiar"
        >
          {copied ? <Check className="h-3.5 w-3.5 text-emerald-400" /> : <Copy className="h-3.5 w-3.5" />}
        </button>
      </div>
    </div>
  );
}
