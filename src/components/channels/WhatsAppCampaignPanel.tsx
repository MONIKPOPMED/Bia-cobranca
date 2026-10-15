import { useCallback, useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { CalendarClock, CheckCircle2, ChevronDown, FileSpreadsheet, Loader2, Megaphone, Pause, Play, Search, TriangleAlert, Users, XCircle } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { supabase } from "@/integrations/supabase/client";
import { fetchDebtors, formatBRL, importDebtorsCsv, type DebtorRow } from "@/lib/debtors";
import { convertSheet, defaultSheet, isUsableSheet, phoneLookupVariants, readSpreadsheet, type ConvertedSheet, type SheetData } from "@/lib/spreadsheet-import";
import { controlWhatsAppCampaign, createWhatsAppCampaign } from "@/lib/whatsapp-campaigns.functions";
import { listWhatsAppCampaigns, type WhatsAppCampaign } from "@/lib/whatsapp-campaigns";

const STATUS: Record<string, { label: string; variant: "default" | "secondary" | "destructive" | "outline" }> = {
  scheduled: { label: "Agendada", variant: "outline" },
  running: { label: "Em andamento", variant: "default" },
  paused: { label: "Pausada", variant: "secondary" },
  completed: { label: "Concluída", variant: "outline" },
  failed: { label: "Com problema", variant: "destructive" },
  canceled: { label: "Cancelada", variant: "secondary" },
};

export function WhatsAppCampaignPanel({ accountId, enabled, isAdmin }: { accountId: string; enabled: boolean; isAdmin: boolean }) {
  const createCampaign = useServerFn(createWhatsAppCampaign);
  const controlCampaign = useServerFn(controlWhatsAppCampaign);
  const [campaigns, setCampaigns] = useState<WhatsAppCampaign[]>([]);
  const [open, setOpen] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [name, setName] = useState("");
  const [audience, setAudience] = useState<"selected" | "all_open" | "spreadsheet">("selected");
  const [fileName, setFileName] = useState("");
  const [sheets, setSheets] = useState<SheetData[]>([]);
  const [sheetName, setSheetName] = useState("");
  const [converted, setConverted] = useState<ConvertedSheet | null>(null);
  const [sheetError, setSheetError] = useState("");
  const [timing, setTiming] = useState<"now" | "scheduled">("now");
  const [scheduledFor, setScheduledFor] = useState("");
  const [query, setQuery] = useState("");
  const [debtors, setDebtors] = useState<DebtorRow[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [searching, setSearching] = useState(false);

  const loadCampaigns = useCallback(async () => {
    setLoading(true);
    try { setCampaigns(await listWhatsAppCampaigns(accountId)); }
    catch (error) { toast.error(error instanceof Error ? error.message : "Não foi possível carregar as campanhas"); }
    finally { setLoading(false); }
  }, [accountId]);

  useEffect(() => { void loadCampaigns(); }, [loadCampaigns]);
  useEffect(() => {
    if (!open || audience !== "selected") return;
    const timer = window.setTimeout(async () => {
      setSearching(true);
      try {
        const result = await fetchDebtors(accountId, { q: query, limit: 50, status: "aberto" });
        setDebtors(result.rows.filter((debtor) => debtor.phone_number && debtor.valor_aberto > 0));
      } catch { setDebtors([]); }
      finally { setSearching(false); }
    }, 250);
    return () => window.clearTimeout(timer);
  }, [accountId, audience, open, query]);

  function pickSheet(name: string, list = sheets) {
    setSheetName(name);
    const sheet = list.find((item) => item.name === name);
    if (!sheet) return;
    try { setConverted(convertSheet(sheet)); setSheetError(""); }
    catch (error) { setConverted(null); setSheetError(error instanceof Error ? error.message : "Não foi possível ler a aba"); }
  }

  async function onFile(file: File | undefined) {
    setConverted(null); setSheetError(""); setSheets([]); setSheetName(""); setFileName(file?.name ?? "");
    if (!file) return;
    try {
      const list = await readSpreadsheet(file);
      setSheets(list);
      const first = defaultSheet(list) ?? list[0]?.name;
      if (first) pickSheet(first, list);
    } catch { setSheetError("Não consegui abrir o arquivo. Envie .xlsx, .xls ou .csv."); }
  }

  /** Imports the spreadsheet into the Carteira and returns its contacts. */
  async function importSpreadsheet(): Promise<string[]> {
    if (!converted) throw new Error("Anexe a planilha");
    const result = await importDebtorsCsv(converted.csv);
    if (result.errors.length) console.warn("[planilha] linhas com erro", result.errors);
    const variants = converted.phones.flatMap(phoneLookupVariants);
    const ids = new Set<string>();
    for (let i = 0; i < variants.length; i += 200) {
      const { data, error } = await supabase.from("contacts").select("id").eq("account_id", accountId).in("phone_number", variants.slice(i, i + 200));
      if (error) throw error;
      (data ?? []).forEach((row) => ids.add(row.id));
    }
    toast.success(`Planilha importada: ${result.imported} mensalidade${result.imported === 1 ? "" : "s"} nova${result.imported === 1 ? "" : "s"}, ${result.skipped_duplicate} já estava${result.skipped_duplicate === 1 ? "" : "m"} na carteira`);
    if (ids.size === 0) throw new Error("Nenhum cliente da planilha foi encontrado na carteira depois da importação");
    return [...ids];
  }

  async function submit() {
    setSaving(true);
    try {
      const contactIds = audience === "spreadsheet" ? await importSpreadsheet() : selected;
      const result = await createCampaign({ data: {
        accountId,
        name,
        audienceMode: audience === "all_open" ? "all_open" : "selected",
        contactIds,
        scheduledFor: timing === "scheduled" && scheduledFor ? new Date(scheduledFor).toISOString() : null,
      } });
      toast.success(`${result.queued} devedor${result.queued === 1 ? "" : "es"} adicionado${result.queued === 1 ? "" : "s"} à campanha`);
      setOpen(false); setName(""); setSelected([]); setScheduledFor(""); setTiming("now");
      setConverted(null); setSheets([]); setSheetName(""); setFileName("");
      await loadCampaigns();
    } catch (error) { toast.error(error instanceof Error ? error.message : "Não foi possível criar a campanha"); }
    finally { setSaving(false); }
  }

  async function control(campaignId: string, action: "pause" | "resume" | "cancel") {
    try {
      await controlCampaign({ data: { campaignId, action } });
      toast.success(action === "pause" ? "Campanha pausada" : action === "resume" ? "Campanha retomada" : "Campanha cancelada");
      await loadCampaigns();
    } catch (error) { toast.error(error instanceof Error ? error.message : "Não foi possível atualizar a campanha"); }
  }

  return <>
    <section className="rounded-lg border border-border bg-card p-5">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-3"><Megaphone className="mt-0.5 h-5 w-5 text-primary" /><div><h2 className="font-semibold">Campanhas automáticas</h2><p className="text-sm text-muted-foreground">A Bia cria uma mensagem individual usando os dados da dívida.</p></div></div>
        <Button onClick={() => setOpen(true)} disabled={!enabled || !isAdmin}><Megaphone />Nova campanha</Button>
      </div>
      {!enabled && <p className="mt-3 text-xs text-muted-foreground">Conecte o WhatsApp e ative a Bia para liberar campanhas.</p>}
      <div className="mt-5 border-t border-border pt-4">
        {loading ? <Loader2 className="h-5 w-5 animate-spin text-primary" /> : campaigns.length === 0 ? <p className="text-sm text-muted-foreground">Nenhuma campanha criada.</p> : <div className="space-y-3">
          {campaigns.slice(0, expanded ? campaigns.length : 5).map((campaign) => {
            const status = STATUS[campaign.status] ?? { label: campaign.status, variant: "outline" as const };
            return <div key={campaign.id} className="rounded-md border border-border p-4">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><p className="truncate font-medium">{campaign.name}</p><Badge variant={status.variant}>{status.label}</Badge></div><p className="mt-1 text-xs text-muted-foreground">{campaign.audience_mode === "all_open" ? "Todos em aberto" : "Seleção da carteira"} · limite {campaign.daily_limit}/dia{campaign.scheduled_for ? ` · ${new Date(campaign.scheduled_for).toLocaleString("pt-BR")}` : ""}</p></div>
                <div className="flex gap-2">{campaign.status === "running" && <Button size="icon" variant="outline" aria-label="Pausar campanha" title="Pausar" onClick={() => void control(campaign.id, "pause")}><Pause /></Button>}{campaign.status === "paused" && <Button size="icon" variant="outline" aria-label="Retomar campanha" title="Retomar" onClick={() => void control(campaign.id, "resume")}><Play /></Button>}{["running", "paused", "scheduled"].includes(campaign.status) && <Button size="icon" variant="ghost" aria-label="Cancelar campanha" title="Cancelar" onClick={() => void control(campaign.id, "cancel")}><XCircle /></Button>}</div>
              </div>
              <div className="mt-3 grid grid-cols-2 gap-2 text-xs text-muted-foreground sm:grid-cols-5"><span><Users className="mr-1 inline h-3.5 w-3.5" />{campaign.contact_count} devedores</span><span>{campaign.sent_count} enviadas</span><span>{campaign.replied_count} respostas</span><span>{campaign.failed_count} falhas</span><span>{campaign.skipped_count} ignorados</span></div>
              {campaign.last_error && <p className="mt-3 rounded-md bg-destructive/10 px-3 py-2 text-xs text-destructive">{campaign.last_error}</p>}
            </div>;
          })}
          {campaigns.length > 5 && <Button variant="ghost" size="sm" onClick={() => setExpanded((value) => !value)}><ChevronDown className={expanded ? "rotate-180" : ""} />{expanded ? "Mostrar menos" : `Ver mais ${campaigns.length - 5}`}</Button>}
        </div>}
      </div>
    </section>

    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader><DialogTitle>Nova campanha no WhatsApp</DialogTitle><DialogDescription>A Bia prepara cada mensagem com nome, valor e vencimento cadastrados.</DialogDescription></DialogHeader>
        <div className="space-y-5">
          <div className="space-y-1.5"><Label htmlFor="campaign-name">Nome da campanha</Label><Input id="campaign-name" value={name} onChange={(event) => setName(event.target.value)} placeholder="Cobrança de setembro" /></div>
          <div className="space-y-2"><Label>Quem receberá</Label><RadioGroup value={audience} onValueChange={(value) => setAudience(value as "selected" | "all_open" | "spreadsheet")} className="grid gap-3 sm:grid-cols-3">
            <label className="flex cursor-pointer gap-3 rounded-md border border-border p-3"><RadioGroupItem value="selected" /><span><span className="block text-sm font-medium">Selecionar da carteira</span><span className="text-xs text-muted-foreground">Marque os devedores antes de iniciar.</span></span></label>
            <label className="flex cursor-pointer gap-3 rounded-md border border-border p-3"><RadioGroupItem value="all_open" /><span><span className="block text-sm font-medium">Todos em aberto</span><span className="text-xs text-muted-foreground">Inclui quem tem dívida aberta e WhatsApp válido.</span></span></label>
            <label className="flex cursor-pointer gap-3 rounded-md border border-border p-3"><RadioGroupItem value="spreadsheet" /><span><span className="block text-sm font-medium">Anexar planilha</span><span className="text-xs text-muted-foreground">Excel ou CSV: entra na carteira e só esses clientes recebem.</span></span></label>
          </RadioGroup></div>
          {audience === "spreadsheet" && <div className="space-y-3">
            <Label htmlFor="campaign-file">Planilha (.xlsx, .xls ou .csv)</Label>
            <Input id="campaign-file" type="file" accept=".xlsx,.xls,.csv" onChange={(event) => void onFile(event.target.files?.[0])} />
            {sheets.length > 1 && <div className="space-y-1.5"><Label htmlFor="campaign-sheet">Aba</Label><select id="campaign-sheet" value={sheetName} onChange={(event) => pickSheet(event.target.value)} className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm">{sheets.map((sheet) => <option key={sheet.name} value={sheet.name} disabled={!isUsableSheet(sheet)}>{sheet.name}{isUsableSheet(sheet) ? "" : " (sem as colunas esperadas)"}</option>)}</select></div>}
            {sheetError && <p className="flex gap-2 rounded-md bg-destructive/10 px-3 py-2 text-xs text-destructive"><TriangleAlert className="h-4 w-4 shrink-0" />{sheetError}</p>}
            {converted && <div className="space-y-2 rounded-md border border-border p-3 text-sm">
              <p className="flex items-center gap-2 font-medium"><FileSpreadsheet className="h-4 w-4 text-primary" />{fileName}{sheetName ? ` · aba ${sheetName}` : ""}</p>
              <p><strong>{converted.clients}</strong> cliente{converted.clients === 1 ? "" : "s"} · <strong>{converted.installments}</strong> mensalidade{converted.installments === 1 ? "" : "s"} vencida{converted.installments === 1 ? "" : "s"} para cobrar</p>
              {converted.format === "popmed" && <p className="text-xs text-muted-foreground">Ficaram de fora: {converted.notPending} cliente{converted.notPending === 1 ? "" : "s"} com outra situação (a Bia só cobra “pagamento pendente no período”) e {converted.notDueYet} mensalidade{converted.notDueYet === 1 ? "" : "s"} que ainda não venceu{converted.notDueYet === 1 ? "" : "ram"}.</p>}
              {converted.problems.length > 0 && <div className="rounded-md bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-400"><p className="font-medium">{converted.problems.length} linha{converted.problems.length === 1 ? "" : "s"} com problema (não entra{converted.problems.length === 1 ? "" : "m"}):</p><ul className="mt-1 list-disc pl-4">{converted.problems.slice(0, 8).map((problem) => <li key={problem}>{problem}</li>)}</ul>{converted.problems.length > 8 && <p>e mais {converted.problems.length - 8}…</p>}</div>}
            </div>}
          </div>}
          {audience === "selected" && <div className="space-y-2"><Label>Devedores ({selected.length} selecionados)</Label><div className="relative"><Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" /><Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Buscar por nome ou telefone" className="pl-9" /></div><div className="max-h-56 overflow-y-auto rounded-md border border-border">{searching ? <div className="flex justify-center py-6"><Loader2 className="h-5 w-5 animate-spin text-primary" /></div> : debtors.map((debtor) => <label key={debtor.contact_id} className="flex cursor-pointer items-center gap-3 border-b border-border px-3 py-2.5 last:border-0"><Checkbox checked={selected.includes(debtor.contact_id)} onCheckedChange={(checked) => setSelected((current) => checked ? [...new Set([...current, debtor.contact_id])] : current.filter((id) => id !== debtor.contact_id))} /><span className="min-w-0 flex-1"><span className="block truncate text-sm font-medium">{debtor.name ?? "Sem nome"}</span><span className="block truncate text-xs text-muted-foreground">{debtor.phone_number} · {formatBRL(debtor.valor_aberto)}</span></span></label>)}</div></div>}
          <div className="space-y-2"><Label>Quando começar</Label><RadioGroup value={timing} onValueChange={(value) => setTiming(value as "now" | "scheduled")} className="grid gap-3 sm:grid-cols-2"><label className="flex cursor-pointer gap-3 rounded-md border border-border p-3"><RadioGroupItem value="now" /><Play className="h-4 w-4" /><span className="text-sm font-medium">Enviar agora</span></label><label className="flex cursor-pointer gap-3 rounded-md border border-border p-3"><RadioGroupItem value="scheduled" /><CalendarClock className="h-4 w-4" /><span className="text-sm font-medium">Agendar data e hora</span></label></RadioGroup>{timing === "scheduled" && <Input aria-label="Data e hora do envio" type="datetime-local" value={scheduledFor} onChange={(event) => setScheduledFor(event.target.value)} />}</div>
          <div className="flex gap-3 rounded-md border border-border bg-muted/30 p-3"><CheckCircle2 className="mt-0.5 h-4 w-4 text-primary" /><p className="text-xs text-muted-foreground">Limite inicial de 100 mensagens por dia. Números bloqueados, inválidos ou sem dívida aberta não recebem.</p></div>
        </div>
        <DialogFooter><Button variant="outline" onClick={() => setOpen(false)} disabled={saving}>Cancelar</Button><Button onClick={() => void submit()} disabled={saving || !name.trim() || (audience === "selected" && selected.length === 0) || (audience === "spreadsheet" && !converted?.installments) || (timing === "scheduled" && !scheduledFor)}>{saving ? <Loader2 className="animate-spin" /> : <Megaphone />}Criar campanha</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  </>;
}