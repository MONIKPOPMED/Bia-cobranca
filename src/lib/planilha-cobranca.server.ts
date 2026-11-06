/**
 * Automatic WhatsApp campaign from POPMED's Google Sheet ("[POP] Planilha de
 * cobranças - Automatizada", one tab per month: Abril … Novembro). Asked on
 * 06/11: every day new customers show up in the month's tab; the Bia charges
 * the new ones without anyone attaching a file.
 *
 * Runs from the WhatsApp campaign cron (every 5 min) once a day at 12h, Mon–Fri
 * (America/Sao_Paulo, asked 06/11) — and right away, in the sending window,
 * when the month's campaign doesn't exist yet (first day of the month / first
 * publish):
 *  1. reads the current month's tab (public "view" link → CSV export by gid);
 *  2. takes "PAGAMENTO PENDENTE NO PERÍODO" and "CLIENTE CANCELADO -
 *     INADIMPLÊNCIA" (decided 06/11);
 *  3. puts each one in the Carteira (contact + CPF + one debt per month);
 *  4. queues them in the month's campaign "Planilha <Mês>/<ano> (automática)".
 *
 * The sheet has no due dates nor open amounts: what the Bia charges comes
 * from the CPF lookup right before each message (checarAntesDeCobrar), so
 * this only runs with LOJA_POPMED_ATIVA on. A customer the lookup skips
 * (e.g. not overdue yet) is tried again the next day; one message per
 * customer per month. A campaign canceled in the app stays canceled; a
 * paused one keeps receiving customers but is not resumed.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/integrations/supabase/types";
import { lojaAtiva } from "./popmed-consulta.server";
import { phoneLookupVariants } from "./spreadsheet-import";

type AdminClient = SupabaseClient<Database>;

const PLANILHA_PADRAO = "1CFKS8a1P6JHFdQcveZhuuI9skZ3HlPfO4nQVMFTLsFI";
const SITUACOES = ["PAGAMENTO PENDENTE NO PERÍODO", "CLIENTE CANCELADO - INADIMPLÊNCIA"];
const MESES = ["Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho", "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro"];

const norm = (s: string) => s.trim().toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");

function saoPaulo(d = new Date()) {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", { timeZone: "America/Sao_Paulo", weekday: "short", year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "numeric", hourCycle: "h23" })
      .formatToParts(d).map((x) => [x.type, x.value]),
  );
  return { weekday: p.weekday, year: Number(p.year), month: Number(p.month), day: Number(p.day), hour: Number(p.hour), minute: Number(p.minute) };
}

const nomeDaCampanha = (t: ReturnType<typeof saoPaulo>) => `Planilha ${MESES[t.month - 1]}/${t.year} (automática)`;

/** Called by the campaign cron every 5 min: the 12h tick Mon–Fri, or any tick 9h–17h while the month's campaign is missing. */
export async function horaDeLerPlanilha(admin: AdminClient, d = new Date()) {
  const t = saoPaulo(d);
  if (["Sat", "Sun"].includes(t.weekday) || t.hour < 9 || t.hour > 17 || !lojaAtiva()) return false;
  if (t.hour === 12 && t.minute < 5) return true;
  const { count } = await admin.from("whatsapp_campaigns").select("id", { count: "exact", head: true }).eq("name", nomeDaCampanha(t));
  return (count ?? 0) === 0;
}

function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [], f = "", q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"') { if (text[i + 1] === '"') { f += '"'; i++; } else q = false; } else f += c;
    } else if (c === '"') q = true;
    else if (c === ",") { row.push(f); f = ""; }
    else if (c === "\n") { row.push(f); rows.push(row); row = []; f = ""; }
    else if (c !== "\r") f += c;
  }
  if (f || row.length) { row.push(f); rows.push(row); }
  return rows.filter((r) => r.some((x) => x.trim()));
}

function toE164(raw: string): string | null {
  let d = raw.replace(/\D/g, "");
  if (d.startsWith("55") && d.length >= 12) d = d.slice(2);
  return d.length === 10 || d.length === 11 ? `+55${d}` : null;
}

export type ClientePlanilha = { cd: string; cpf: string; telefone: string; nome: string; situacao: string; forma: string; valor: number; cancelamento: string | null };

/** Reads the month's tab. Throws if the tab doesn't exist (Google would silently answer with another tab). */
export async function lerPlanilha(aba: string, planilhaId = process.env["PLANILHA_COBRANCA_ID"]?.trim() || PLANILHA_PADRAO): Promise<ClientePlanilha[]> {
  const html = await (await fetch(`https://docs.google.com/spreadsheets/d/${planilhaId}/htmlview`, { signal: AbortSignal.timeout(20_000) })).text();
  const abas = [...html.matchAll(/name: "([^"]+)", pageUrl: "[^"]*", gid: "(\d+)"/g)].map((m) => ({ nome: m[1], gid: m[2] }));
  if (!abas.length) throw new Error("Planilha de cobranças inacessível (o link precisa estar aberto para leitura)");
  const gid = abas.find((a) => norm(a.nome) === norm(aba))?.gid;
  if (!gid) return [];

  const resp = await fetch(`https://docs.google.com/spreadsheets/d/${planilhaId}/export?format=csv&gid=${gid}`, { signal: AbortSignal.timeout(20_000) });
  if (!resp.ok) throw new Error(`Planilha de cobranças: HTTP ${resp.status} ao ler a aba ${aba}`);
  const [header = [], ...body] = parseCsv(await resp.text());
  const h = header.map(norm);
  const col = (n: string) => h.indexOf(n);
  const C = { cd: col("cd_cliente"), cpf: col("cpf"), tel: col("telefone"), nome: col("nome"), sit: col("situacao"), forma: col("forma de pagamento"), valor: col("valor plano"), canc: col("data para cancelamento") };
  if (C.tel < 0 || C.nome < 0 || C.sit < 0 || C.cpf < 0) throw new Error(`Aba ${aba}: faltam as colunas CPF, Telefone, Nome ou Situação`);

  return body.map((r) => {
    const canc = (r[C.canc] ?? "").match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
    return {
      cd: (r[C.cd] ?? "").trim(),
      cpf: (r[C.cpf] ?? "").replace(/\D/g, "").padStart(11, "0"),
      telefone: (r[C.tel] ?? "").trim(),
      nome: (r[C.nome] ?? "").trim(),
      situacao: (r[C.sit] ?? "").trim(),
      forma: C.forma >= 0 ? (r[C.forma] ?? "").trim() : "",
      valor: Number(String(r[C.valor] ?? "").replace(/[^\d,.]/g, "").replace(",", ".")) || 0,
      cancelamento: canc ? `${canc[3]}-${canc[2].padStart(2, "0")}-${canc[1].padStart(2, "0")}` : null,
    };
  });
}

/** Account, inbox and persona of the Bia on WhatsApp (connected channel + auto deployment). */
async function contaDaBia(admin: AdminClient) {
  const fixa = process.env["PLANILHA_COBRANCA_ACCOUNT_ID"]?.trim();
  let q = admin.from("channels").select("id, account_id, config").eq("channel_type", "whatsapp").eq("enabled", true);
  if (fixa) q = q.eq("account_id", fixa);
  const { data: channels } = await q;
  const achadas: { accountId: string; inboxId: string; personaId: string }[] = [];
  for (const ch of channels ?? []) {
    const { data: inbox } = await admin.from("inboxes").select("id").eq("channel_id", ch.id).maybeSingle();
    if (!inbox) continue;
    const { data: dep } = await admin.from("agent_persona_deployments").select("persona_id").eq("account_id", ch.account_id).eq("inbox_id", inbox.id).eq("enabled", true).eq("autonomy", "auto").maybeSingle();
    if (dep) achadas.push({ accountId: ch.account_id, inboxId: inbox.id, personaId: dep.persona_id });
  }
  if (achadas.length !== 1) throw new Error(achadas.length ? "Mais de uma conta com a Bia no WhatsApp: defina PLANILHA_COBRANCA_ACCOUNT_ID" : "Bia não está ativa no WhatsApp");
  return achadas[0];
}

export async function sincronizarPlanilha(admin: AdminClient, agora = new Date()) {
  if (!lojaAtiva()) return { ok: false, motivo: "LOJA_POPMED_ATIVA desligada (a planilha não traz valores; a consulta pelo CPF é obrigatória)" };
  const t = saoPaulo(agora);
  const aba = MESES[t.month - 1];
  const mesRef = `${t.year}-${String(t.month).padStart(2, "0")}`;
  const nomeCampanha = nomeDaCampanha(t);

  const todos = await lerPlanilha(aba);
  const alvo = todos.filter((c) => SITUACOES.some((s) => norm(s) === norm(c.situacao)));
  if (!alvo.length) return { ok: true, aba, lidos: todos.length, alvo: 0 };

  const { accountId, inboxId, personaId } = await contaDaBia(admin);

  // Month campaign: created once; canceled in the app = leave the month alone.
  const { data: existente } = await admin.from("whatsapp_campaigns").select("id, status").eq("account_id", accountId).eq("name", nomeCampanha).order("created_at", { ascending: false }).limit(1).maybeSingle();
  if (existente?.status === "canceled" || existente?.status === "failed") return { ok: true, aba, alvo: alvo.length, campanha: existente.status };
  let campanhaId = existente?.id;
  if (!campanhaId) {
    const { data: nova, error } = await admin.from("whatsapp_campaigns").insert({
      account_id: accountId, inbox_id: inboxId, persona_id: personaId, name: nomeCampanha,
      audience_mode: "selected", status: "running", daily_limit: 100, started_at: agora.toISOString(),
    }).select("id").single();
    if (error || !nova) throw new Error(error?.message ?? "Não foi possível criar a campanha da planilha");
    campanhaId = nova.id;
  }

  const { data: dncRows } = await admin.from("dnc_list").select("phone_number, phone_e164").eq("account_id", accountId);
  const dnc = new Set((dncRows ?? []).flatMap((r) => [r.phone_number, r.phone_e164]).map((p) => String(p ?? "").replace(/\D/g, "")).filter(Boolean));
  const { data: jaNaCampanha } = await admin.from("whatsapp_campaign_recipients").select("id, contact_id, status, skip_reason, updated_at").eq("campaign_id", campanhaId);
  const porContato = new Map((jaNaCampanha ?? []).map((r) => [r.contact_id, r]));
  const hoje = `${mesRef}-${String(t.day).padStart(2, "0")}`;

  let novos = 0, reenfileirados = 0;
  const problemas: string[] = [];
  for (const c of alvo) {
    const fone = toE164(c.telefone);
    if (!c.nome || !fone) { problemas.push(`${c.cd || c.nome || "linha"}: telefone "${c.telefone}"`); continue; }
    if (dnc.has(fone.replace(/\D/g, ""))) continue;

    // Contact (with or without the 9th digit), CPF and the month's debt.
    const { data: achados } = await admin.from("contacts").select("id, name, phone_number, blocked").eq("account_id", accountId).in("phone_number", phoneLookupVariants(fone)).limit(1);
    let contato = achados?.[0];
    if (!contato) {
      const { data: criado, error } = await admin.from("contacts").insert({ account_id: accountId, name: c.nome, phone_number: fone, custom_attributes: { external_ref: c.cd } as Json }).select("id, name, phone_number, blocked").single();
      if (error || !criado) { problemas.push(`${c.nome}: ${error?.message ?? "falha ao criar contato"}`); continue; }
      contato = criado;
    }
    if (contato.blocked) continue;
    if (c.cpf.length === 11 && c.cpf !== "00000000000") {
      await admin.from("debtor_profiles").upsert({ contact_id: contato.id, account_id: accountId, doc_type: "cpf", doc_number: c.cpf, external_ref: c.cd || null }, { onConflict: "contact_id" });
    }
    const ref = `planilha:${c.cd || c.cpf}:${mesRef}`;
    const { data: divida } = await admin.from("debts").select("id").eq("account_id", accountId).eq("contact_id", contato.id).eq("external_ref", ref).limit(1).maybeSingle();
    let dividaId = divida?.id;
    if (!dividaId && c.valor > 0) {
      const { data: d } = await admin.from("debts").insert({
        account_id: accountId, contact_id: contato.id, external_ref: ref,
        descricao: `Planilha de cobranças ${aba}/${t.year}: ${c.situacao.toLowerCase()}`,
        valor_original: c.valor, valor_atual: c.valor, vencimento: c.cancelamento ?? `${mesRef}-01`,
        origem: c.forma || null, status: "aberto",
      }).select("id").single();
      dividaId = d?.id;
    }

    const r = porContato.get(contato.id);
    if (!r) {
      const { error } = await admin.from("whatsapp_campaign_recipients").insert({
        campaign_id: campanhaId, account_id: accountId, contact_id: contato.id,
        phone_number: String(contato.phone_number ?? fone).replace(/\D/g, ""),
        debt_ids: dividaId ? [dividaId] : [],
        debt_data: { debtor_name: contato.name || c.nome, total_open: c.valor, nearest_due_date: c.cancelamento, descriptions: [c.situacao], debt_count: 1 } as Json,
        dispatch_after: agora.toISOString(),
      });
      if (error) problemas.push(`${c.nome}: ${error.message}`); else novos++;
    } else if (r.status === "skipped" && String(r.skip_reason ?? "").startsWith("consulta:") && saoPauloDia(r.updated_at) < hoje) {
      // The lookup said "not now" (e.g. not overdue yet): try again, once a day.
      await admin.from("whatsapp_campaign_recipients").update({ status: "queued", skip_reason: null, dispatch_after: agora.toISOString() }).eq("id", r.id);
      reenfileirados++;
    }
  }

  const { count } = await admin.from("whatsapp_campaign_recipients").select("id", { count: "exact", head: true }).eq("campaign_id", campanhaId);
  const reabrir = (novos > 0 || reenfileirados > 0) && existente?.status === "completed";
  await admin.from("whatsapp_campaigns").update({
    contact_count: count ?? 0,
    ...(reabrir ? { status: "running", finished_at: null } : {}),
    updated_at: new Date().toISOString(),
  }).eq("id", campanhaId);
  await admin.rpc("refresh_whatsapp_campaign_totals", { p_campaign_id: campanhaId });
  if (reabrir) await admin.from("whatsapp_campaigns").update({ status: "running", finished_at: null }).eq("id", campanhaId).eq("status", "completed");

  return { ok: true, aba, lidos: todos.length, alvo: alvo.length, novos, reenfileirados, problemas: problemas.slice(0, 20), campanhaId };
}

function saoPauloDia(iso: string) {
  const t = saoPaulo(new Date(iso));
  return `${t.year}-${String(t.month).padStart(2, "0")}-${String(t.day).padStart(2, "0")}`;
}
