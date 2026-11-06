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
        debt_data: { debtor_name: contato.name || c.nome, total_open: c.valor, nearest_due_date: c.cancelamento, descriptions: [c.situacao], debt_count: 1, planilha: { aba, cd: c.cd, cpf: c.cpf } } as Json,
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

// ───────────────────────────────────────────────────────────────────────────
// Writing back to the sheet (asked 06/11): Contato/Retorno columns.
//
// Through the Apps Script web app installed in the sheet
// (docs/planilha-apps-script.gs; secrets PLANILHA_ESCRITA_URL and
// PLANILHA_ESCRITA_SEGREDO). The script puts the Bia's contact in the first
// empty slot (#1, #2, #3: never over the team's) and only accepts the
// dropdown values.
//
// 1st contact = the campaign WhatsApp: "Contato por Whatsapp" + "Sem retorno";
// then the return follows the conversation: replied → "Negociando"; store
// link → "Link de pagamento - Cartão/Pix"; order paid → "Pagou por …";
// customer asked to cancel → "Cancelou". Never goes back (paid stays paid).
// 2nd contact = a call when there's no reply in 2 business days (month's call
// campaign "Planilha <Mês>/<ano> – ligações (automática)"): "Contato por
// telefone"; answered → "Negociando", else "Sem retorno"; from then on the
// updates go to the call's slot.
//
// What was written is kept in whatsapp_campaign_recipients.debt_data.planilha
// so each tick only sends the changes (at most ESCRITAS_POR_RODADA).
// ───────────────────────────────────────────────────────────────────────────

const ESCRITAS_POR_RODADA = 10;
const RETORNO_ORDEM: Record<string, number> = {
  "Sem retorno": 0, "Negociando": 1, "Link de pagamento - Cartão": 2, "Link de pagamento - Pix": 2,
  "Cancelou": 3, "Pagou por cartão": 4, "Pagou por pix": 4,
};

type Espaco = { espaco?: number; retorno?: string };
type EstadoPlanilha = { aba?: string; cd?: string; cpf?: string; w?: Espaco; t?: Espaco & { call_id?: string } };

function escritaConfigurada() {
  return !!process.env["PLANILHA_ESCRITA_URL"]?.trim() && !!process.env["PLANILHA_ESCRITA_SEGREDO"]?.trim();
}

async function escrever(corpo: Record<string, unknown>): Promise<{ ok: boolean; espaco?: number; erro?: string }> {
  const resp = await fetch(process.env["PLANILHA_ESCRITA_URL"]!.trim(), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...corpo, segredo: process.env["PLANILHA_ESCRITA_SEGREDO"]!.trim() }),
    redirect: "follow",
    signal: AbortSignal.timeout(30_000),
  });
  const texto = await resp.text();
  try { return JSON.parse(texto); } catch { return { ok: false, erro: `HTTP ${resp.status}` }; }
}

async function statusDoPedido(id: number): Promise<string | null> {
  const k = process.env["WOO_CONSUMER_KEY"], s = process.env["WOO_CONSUMER_SECRET"];
  if (!k || !s) return null;
  try {
    const r = await fetch(`https://popmed.com.br/wp-json/wc/v3/orders/${id}`, {
      headers: { Authorization: "Basic " + btoa(`${k}:${s}`), Accept: "application/json" },
      signal: AbortSignal.timeout(20_000),
    });
    if (!r.ok) return null;
    return String(((await r.json()) as { status?: string }).status ?? "");
  } catch { return null; }
}

const pagou = (status: string | null) => status === "processing" || status === "completed";

/** Business days (Mon–Fri) fully passed since `desde`, in São Paulo. */
function diasUteisDesde(desde: Date, agora: Date) {
  let n = 0;
  const d = new Date(desde);
  for (let i = 0; i < 15; i++) {
    d.setTime(d.getTime() + 86_400_000);
    if (d > agora) break;
    if (!["Sat", "Sun"].includes(saoPaulo(d).weekday)) n++;
  }
  return n;
}

/** Sheet updates run on every campaign tick, 8h–20h (payments and replies also come in the evening). */
export function horaDeEscreverPlanilha(d = new Date()) {
  const t = saoPaulo(d);
  return t.hour >= 8 && t.hour < 20;
}

const asObj = (v: unknown) => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});

export async function atualizarPlanilha(admin: AdminClient, agora = new Date()) {
  if (!escritaConfigurada()) return { ok: false, motivo: "PLANILHA_ESCRITA_URL/SEGREDO não configurados" };
  const t = saoPaulo(agora);
  const { data: campanhas } = await admin.from("whatsapp_campaigns").select("id, account_id, name, status")
    .like("name", "Planilha %(automática)").neq("status", "canceled")
    .gte("created_at", new Date(agora.getTime() - 45 * 86_400_000).toISOString());

  let escritas = 0, ligacoesAgendadas = 0;
  const erros: string[] = [];

  for (const camp of campanhas ?? []) {
    const aba = camp.name.match(/^Planilha (\S+)\//)?.[1];
    if (!aba) continue;
    const doMesAtual = camp.name === nomeDaCampanha(t);
    const { data: rows } = await admin.from("whatsapp_campaign_recipients")
      .select("id, contact_id, status, sent_at, conversation_id, debt_data, phone_number")
      .eq("campaign_id", camp.id).in("status", ["sent", "replied"]);
    const callCamp = doMesAtual ? await campanhaDeLigacoes(admin, camp.account_id, aba, t.year) : null;

    for (const r of rows ?? []) {
      if (escritas >= ESCRITAS_POR_RODADA) break;
      const dd = asObj(r.debt_data);
      const est: EstadoPlanilha = { ...(asObj(dd.planilha) as EstadoPlanilha) };
      est.aba ??= aba;
      if (!est.cd && !est.cpf) {
        const { data: p } = await admin.from("debtor_profiles").select("doc_number, external_ref").eq("contact_id", r.contact_id).limit(1).maybeSingle();
        est.cd = p?.external_ref ?? undefined;
        est.cpf = p?.doc_number ?? undefined;
      }
      const salvar = async () => {
        await admin.from("whatsapp_campaign_recipients").update({ debt_data: { ...dd, planilha: est } as Json }).eq("id", r.id);
      };
      const alvo = { aba: est.aba, cd: est.cd ?? "", cpf: est.cpf ?? "" };

      // 1st contact: the WhatsApp message.
      if (!est.w?.espaco) {
        const res = await escrever({ acao: "contato", contato: "Contato por Whatsapp", ...alvo });
        escritas++;
        if (!res.ok) { erros.push(`${r.id}: ${res.erro}`); if (res.erro === "cliente" || res.erro === "sem_espaco") { est.w = { espaco: -1 }; await salvar(); } continue; }
        est.w = { espaco: res.espaco, retorno: "Sem retorno" };
        await salvar();
      }
      if ((est.w?.espaco ?? 0) < 1) continue;

      // Where the conversation is now.
      const { data: conv } = r.conversation_id
        ? await admin.from("conversations").select("additional_attributes").eq("id", r.conversation_id).maybeSingle()
        : { data: null };
      const pedido = asObj(asObj(conv?.additional_attributes).loja_pedido);
      let desejado = r.status === "replied" ? "Negociando" : "Sem retorno";
      if (pedido.id) {
        const st = await statusDoPedido(Number(pedido.id));
        desejado = pagou(st)
          ? (pedido.forma === "cartao" ? "Pagou por cartão" : "Pagou por pix")
          : (pedido.forma === "cartao" ? "Link de pagamento - Cartão" : "Link de pagamento - Pix");
      }
      if (!desejado.startsWith("Pagou") && r.conversation_id && r.sent_at) {
        const { count } = await admin.from("messages").select("id", { count: "exact", head: true })
          .eq("conversation_id", r.conversation_id).eq("sender_type", "Contact").gte("created_at", r.sent_at)
          .or("content.ilike.%cancelar%,content.ilike.%cancelamento%");
        if ((count ?? 0) > 0) desejado = "Cancelou";
      }

      // 2nd contact: the call, if any.
      const ligacao = callCamp ? await resultadoDaLigacao(admin, callCamp, r.contact_id) : null;
      if (ligacao?.terminou && !est.t?.espaco) {
        const res = await escrever({ acao: "contato", contato: "Contato por telefone", ...alvo });
        escritas++;
        if (res.ok) { est.t = { espaco: res.espaco, retorno: "Sem retorno", call_id: ligacao.callId }; await salvar(); }
        else erros.push(`${r.id}: ${res.erro}`);
      }
      const slot = (est.t?.espaco ?? 0) > 0 ? "t" : "w";
      if (slot === "t" && ligacao?.atendeu && RETORNO_ORDEM[desejado] < 1) desejado = "Negociando";
      const atual = est[slot]?.retorno ?? "Sem retorno";
      if (desejado !== atual && RETORNO_ORDEM[desejado] >= RETORNO_ORDEM[atual] && escritas < ESCRITAS_POR_RODADA) {
        const res = await escrever({ acao: "retorno", espaco: est[slot]!.espaco, retorno: desejado, ...alvo });
        escritas++;
        if (res.ok) { est[slot] = { ...est[slot], retorno: desejado }; await salvar(); }
        else erros.push(`${r.id}: ${res.erro}`);
      }

      // Schedule the call: no reply after 2 business days, no link, current month.
      if (callCamp && r.status === "sent" && !pedido.id && !ligacao && r.sent_at && diasUteisDesde(new Date(r.sent_at), agora) >= 2) {
        const { error } = await admin.from("voice_campaign_contacts").upsert({
          campaign_id: callCamp, account_id: camp.account_id, contact_id: r.contact_id,
          phone_number: r.phone_number.startsWith("+") ? r.phone_number : `+${r.phone_number}`,
          to_number: r.phone_number.startsWith("+") ? r.phone_number : `+${r.phone_number}`,
          variables: {} as Json, status: "queued", dispatch_after: agora.toISOString(),
        }, { onConflict: "campaign_id,contact_id", ignoreDuplicates: true });
        if (!error) {
          ligacoesAgendadas++;
          await admin.from("voice_campaigns").update({ status: "running", finished_at: null }).eq("id", callCamp).in("status", ["running", "completed"]);
        }
      }
    }
  }
  if (ligacoesAgendadas) {
    // Keep the Campanhas screen's counters in step.
    const { data: calls } = await admin.from("voice_campaigns").select("id").like("name", "Planilha %ligações (automática)").gte("created_at", new Date(agora.getTime() - 45 * 86_400_000).toISOString());
    for (const c of calls ?? []) {
      const { count } = await admin.from("voice_campaign_contacts").select("id", { count: "exact", head: true }).eq("campaign_id", c.id);
      await admin.from("voice_campaigns").update({ contact_count: count ?? 0, total_contacts: count ?? 0 }).eq("id", c.id);
    }
  }
  return { ok: true, escritas, ligacoesAgendadas, erros: erros.slice(0, 10) };
}

/** Month's call campaign for the 2nd contact; created from the last real collection call campaign. */
async function campanhaDeLigacoes(admin: AdminClient, accountId: string, aba: string, ano: number): Promise<string | null> {
  const nome = `Planilha ${aba}/${ano} – ligações (automática)`;
  const { data: existente } = await admin.from("voice_campaigns").select("id, status").eq("account_id", accountId).eq("name", nome).limit(1).maybeSingle();
  if (existente) return existente.status === "canceled" ? null : existente.id;
  const { data: modelo } = await admin.from("voice_campaigns").select("*").eq("account_id", accountId)
    .eq("campaign_kind", "collection").eq("test_mode", false).eq("script_mode", "conversational")
    .order("created_at", { ascending: false }).limit(1).maybeSingle();
  if (!modelo) return null;
  const { data: nova } = await admin.from("voice_campaigns").insert({
    account_id: accountId, name: nome, description: "2º contato: quem não respondeu o WhatsApp da campanha da planilha em 2 dias úteis.",
    persona_id: modelo.persona_id, voice_id: modelo.voice_id, language_code: modelo.language_code,
    script_mode: modelo.script_mode, mode: modelo.mode, opening_script: modelo.opening_script, system_prompt: modelo.system_prompt,
    phone_number_id: modelo.phone_number_id, from_number: modelo.from_number,
    escalation_rules: modelo.escalation_rules, escalation_keywords: modelo.escalation_keywords,
    max_call_duration_sec: modelo.max_call_duration_sec, voicemail_detection: modelo.voicemail_detection,
    record_call: modelo.record_call, retry_attempts: modelo.retry_attempts, retry_delay_minutes: modelo.retry_delay_minutes,
    collection_config: modelo.collection_config, campaign_kind: "collection", test_mode: false,
    status: "running", started_at: new Date().toISOString(), contact_count: 0, total_contacts: 0,
  }).select("id").single();
  return nova?.id ?? null;
}

/** The 2nd-contact call of a customer: finished? answered? */
async function resultadoDaLigacao(admin: AdminClient, campanhaId: string, contactId: string) {
  const { data: cc } = await admin.from("voice_campaign_contacts").select("status, voice_call_id").eq("campaign_id", campanhaId).eq("contact_id", contactId).limit(1).maybeSingle();
  if (!cc) return null;
  const terminal = ["completed", "failed", "canceled", "skipped", "no_answer", "busy", "voicemail"];
  if (!cc.voice_call_id) return { terminou: terminal.includes(cc.status) && cc.status !== "skipped", atendeu: false, callId: undefined as string | undefined };
  const { data: vc } = await admin.from("voice_calls").select("id, status, duration_seconds").eq("id", cc.voice_call_id).maybeSingle();
  const fim = ["completed", "failed", "no_answer", "busy", "canceled", "voicemail"].includes(String(vc?.status));
  return { terminou: fim, atendeu: vc?.status === "completed" && Number(vc?.duration_seconds ?? 0) >= 20, callId: vc?.id };
}
