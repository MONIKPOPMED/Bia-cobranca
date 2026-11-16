// whatsapp-health-check
// ---------------------
// Watches the Bia's WhatsApp (Evolution) and alerts the POPMED team by
// WhatsApp from the Lia's number (enviarAlertaWhatsApp; no e-mail since 16/11) when it
// drops, gets blocked/restricted or stops sending — and again when it is
// back. Runs from pg_cron every 5 min (x-cron-secret = LOVABLE_CRON_SECRET,
// same as voice-campaign-dispatch).
//
// A session can be a "zombie" (14/10): connectionState says "open" but
// every send fails with "Connection Closed". So besides the state we
//   - probe the session (chat/whatsappNumbers — sends nothing to anyone), and
//   - look at channels.config.evolution_send_error (recorded by the send
//     path, _shared/evolution/health.ts).
//
// State lives on channels.config.evolution_alert:
//   { status: "down" | "up", since, reason, last_email_at (= last alert sent) }
// "Down" alerts go out on the transition and every REMIND_HOURS while down.
//
// Manual test (admin user JWT): POST { "mode": "test" } sends a test alert.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.74.0";
import { checkWhatsAppNumbers, getConnectionState, normalizeStatus, sendText } from "../_shared/evolution/index.ts";
import { LojaPopmed, lojaAtiva } from "../_shared/loja-popmed.ts";
import {
  diaSP,
  enviarPorWhatsApp,
  enviarRelatorioParaEquipe,
  montarRelatorio,
  talvezEnviarRelatorio,
  talvezEnviarRelatorioMensal,
  textoDoRelatorio,
} from "../_shared/relatorio-diario.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret",
};

const REMIND_HOURS = 2;
/** A send failure newer than this still counts as "the WhatsApp is failing". */
const SEND_ERROR_WINDOW_MIN = 30;

function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function brTime(d = new Date()) {
  return d.toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", dateStyle: "short", timeStyle: "short" });
}

// WhatsApp alert (POPMED, 16/11: nobody knew the Bia was down from Thu to Mon;
// e-mail removed at POPMED's request, only WhatsApp). It can't go out through the Bia's own number,
// so it uses another instance on the same Evolution server: the Lia's
// (POPMED, 4057). Overrides: accounts.internal_attributes.alerts.whatsapp_numeros
// / .whatsapp_instancia.
const ALERTA_NUMEROS = ["5548991667070", "5548991917441"]; // Monik, Matheus
const ALERTA_INSTANCIA = "lia";

// deno-lint-ignore no-explicit-any
async function enviarAlertaWhatsApp(admin: any, accountId: string, evo: { url: string; apiKey: string }, texto: string) {
  const { data } = await admin.from("accounts").select("internal_attributes").eq("id", accountId).maybeSingle();
  // deno-lint-ignore no-explicit-any
  const alerts = (data?.internal_attributes as any)?.alerts ?? {};
  const numeros: string[] = Array.isArray(alerts.whatsapp_numeros) && alerts.whatsapp_numeros.length
    ? alerts.whatsapp_numeros.map((n: unknown) => String(n).replace(/\D/g, ""))
    : ALERTA_NUMEROS;
  const instanceName = String(alerts.whatsapp_instancia ?? ALERTA_INSTANCIA);
  let enviados = 0;
  const erros: string[] = [];
  for (const number of numeros) {
    try {
      await sendText({ ...evo, instanceName, number, text: texto });
      enviados++;
    } catch (e) {
      // deno-lint-ignore no-explicit-any
      const corpo = String((e as any)?.body ?? "").slice(0, 200);
      erros.push(`${number.slice(-4)}: ${e instanceof Error ? e.message.slice(0, 160) : String(e)}${corpo ? ` — ${corpo}` : ""}`);
    }
  }
  if (erros.length) console.error(`[whatsapp-health-check] alerta WhatsApp falhou: ${erros.join(" | ")}`);
  return { ok: enviados > 0, enviados, instancia: instanceName, ...(erros.length ? { erros } : {}) };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const admin = createClient(supabaseUrl, serviceKey);
  const body = await req.json().catch(() => ({})) as { mode?: string; dia?: string; de?: string; ate?: string; whatsapp?: string };

  // ── Auth: cron/service, or an admin user for the tests ──
  const authHeader = req.headers.get("Authorization") ?? "";
  const cronHeader = req.headers.get("x-cron-secret") ?? "";
  const cronSecrets = [Deno.env.get("LOVABLE_CRON_SECRET"), Deno.env.get("LOVABLE_CRON_SECRET_PREVIOUS")]
    .filter((s): s is string => !!s && s.length >= 16);
  const isService = !!serviceKey && authHeader.includes(serviceKey);
  const isCron = !!cronHeader && cronSecrets.some((s) => safeEqual(s, cronHeader));

  // Daily report preview (admin): { mode: "relatorio_teste", dia?: "aaaa-mm-dd",
  // whatsapp: number } — only to that number (default day: yesterday).
  if (body.mode === "relatorio_teste") {
    const userClient = createClient(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: u } = await userClient.auth.getUser();
    if (!u?.user?.id) return j({ error: "unauthorized" }, 401);
    const { data: role } = await admin.from("user_roles").select("account_id, role").eq("user_id", u.user.id).eq("role", "admin").limit(1).maybeSingle();
    if (!role) return j({ error: "admin role required" }, 403);
    const dia = /^\d{4}-\d{2}-\d{2}$/.test(String(body.dia ?? "")) ? String(body.dia) : diaSP(new Date(Date.now() - 24 * 3600_000));
    const r = await montarRelatorio(admin, role.account_id, dia);
    // WhatsApp test goes only to the number given (digits), never to the full list.
    const numero = String(body.whatsapp ?? "").replace(/\D/g, "");
    const wa = numero ? await enviarPorWhatsApp(admin, role.account_id, `[TESTE]\n${textoDoRelatorio(r)}`, [numero]) : null;
    return j({ ok: !!wa?.ok, relatorio: r, whatsapp: wa });
  }

  // Period report on demand (admin, 10/11): { mode: "relatorio_periodo",
  // de: "aaaa-mm-dd", ate?: "aaaa-mm-dd" (default today), whatsapp?: number }.
  // With `whatsapp` it goes only to that number (test); without it, to the
  // team list of the daily report.
  if (body.mode === "relatorio_periodo") {
    const userClient = createClient(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: u } = await userClient.auth.getUser();
    if (!u?.user?.id) return j({ error: "unauthorized" }, 401);
    const { data: role } = await admin.from("user_roles").select("account_id, role").eq("user_id", u.user.id).eq("role", "admin").limit(1).maybeSingle();
    if (!role) return j({ error: "admin role required" }, 403);
    const dataOk = (s: unknown) => /^\d{4}-\d{2}-\d{2}$/.test(String(s ?? ""));
    if (!dataOk(body.de)) return j({ error: "de (aaaa-mm-dd) obrigatório" }, 400);
    const ate = dataOk(body.ate) ? String(body.ate) : diaSP(new Date());
    if (ate < String(body.de)) return j({ error: "ate antes de de" }, 400);
    const r = await montarRelatorio(admin, role.account_id, String(body.de), ate);
    const numero = String(body.whatsapp ?? "").replace(/\D/g, "");
    if (numero) {
      const wa = await enviarPorWhatsApp(admin, role.account_id, `[TESTE]\n${textoDoRelatorio(r)}`, [numero]);
      return j({ ok: wa.ok, relatorio: r, whatsapp: wa });
    }
    const env = await enviarRelatorioParaEquipe(admin, role.account_id, r);
    console.log(`[whatsapp-health-check] relatorio_periodo ${body.de}..${ate} whatsapp=${env.whatsapp}`);
    return j({ ok: env.ok, relatorio: r, envio: env });
  }

  if (body.mode === "test") {
    const userClient = createClient(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: u } = await userClient.auth.getUser();
    if (!u?.user?.id) return j({ error: "unauthorized" }, 401);
    const { data: role } = await admin.from("user_roles").select("account_id, role").eq("user_id", u.user.id).eq("role", "admin").limit(1).maybeSingle();
    if (!role) return j({ error: "admin role required" }, 403);
    // Test through the WhatsApp alert (Lia's number → Monik, Matheus).
    const { data: ch } = await admin.from("channels").select("config").eq("account_id", role.account_id).eq("channel_type", "whatsapp").limit(1).maybeSingle();
    // deno-lint-ignore no-explicit-any
    const c = (ch?.config ?? {}) as Record<string, any>;
    const wa = c.evolution_url && c.evolution_api_key
      ? await enviarAlertaWhatsApp(admin, role.account_id, { url: c.evolution_url, apiKey: c.evolution_api_key }, [
        "🔵 *Teste do aviso do WhatsApp da Bia*",
        `Enviado em ${brTime()}.`,
        "Se o WhatsApp da Bia cair, for bloqueado ou parar de enviar, vocês recebem um aviso como este por aqui.",
      ].join("\n"))
      : null;
    return j({ ok: !!wa?.ok, whatsapp: wa });
  }

  if (!isService && !isCron) return j({ error: "service role required" }, 403);

  const { data: channels } = await admin
    .from("channels")
    .select("id, account_id, name, config")
    .eq("channel_type", "whatsapp")
    .eq("enabled", true);

  const results: unknown[] = [];
  for (const ch of channels ?? []) {
    // deno-lint-ignore no-explicit-any
    const cfg = (ch.config ?? {}) as Record<string, any>;
    if (!cfg.evolution_url || !cfg.evolution_api_key || !cfg.evolution_instance_name) continue;
    const evo = { url: cfg.evolution_url, apiKey: cfg.evolution_api_key, instanceName: cfg.evolution_instance_name };

    // 1. State
    let problem: string | null = null;
    let raw = "?";
    try {
      const st = await getConnectionState(evo);
      raw = String(st?.instance?.state ?? "?");
      if (normalizeStatus(raw) !== "connected") problem = `WhatsApp desconectado (estado "${raw}" no servidor).`;
    } catch (e) {
      problem = `Servidor do WhatsApp não respondeu: ${e instanceof Error ? e.message.slice(0, 200) : String(e)}`;
    }

    // 2. Probe the live session (catches the "open but dead" zombie, bans, restrictions).
    if (!problem) {
      const { data: settings } = await admin.from("company_settings").select("support_phone").eq("account_id", ch.account_id).maybeSingle();
      const probeNumber = String(settings?.support_phone ?? "").replace(/\D/g, "");
      if (probeNumber) {
        try {
          await checkWhatsAppNumbers({ ...evo, numbers: [probeNumber] });
        } catch (e) {
          problem = `O WhatsApp aparece conectado, mas não está funcionando: ${e instanceof Error ? e.message.slice(0, 200) : String(e)}`;
        }
      }
    }

    // 3. Recent send failures recorded by the send path.
    const sendErr = cfg.evolution_send_error as { at?: string; message?: string } | undefined;
    if (!problem && sendErr?.at && Date.now() - new Date(sendErr.at).getTime() < SEND_ERROR_WINDOW_MIN * 60_000) {
      problem = `Envio de mensagens falhando: ${String(sendErr.message ?? "").slice(0, 200)}`;
    }

    // ── Alert state machine ──
    const prev = (cfg.evolution_alert ?? {}) as { status?: string; since?: string; reason?: string; last_email_at?: string };
    const now = new Date();
    let next = prev;
    let whats: string | null = null;

    if (problem) {
      const firstTime = prev.status !== "down";
      const remind = !firstTime && (!prev.last_email_at || now.getTime() - new Date(prev.last_email_at).getTime() > REMIND_HOURS * 3600_000);
      if (firstTime || remind) {
        whats = [
          firstTime ? "🔴 *WhatsApp da Bia caiu*" : "🔴 *WhatsApp da Bia continua fora do ar*",
          `Desde: ${brTime(firstTime ? now : new Date(prev.since ?? now))}`,
          `O que aconteceu: ${problem}`,
          "Enquanto isso a Bia não manda nem recebe mensagens (campanha, respostas, links).",
          "O que fazer: no app, Canais → Reconectar e escanear o QR Code com o celular da Bia (6774).",
        ].join("\n");
      }
      next = { status: "down", since: firstTime ? now.toISOString() : prev.since, reason: problem, last_email_at: whats ? now.toISOString() : prev.last_email_at };
    } else if (prev.status === "down") {
      whats = [
        "🟢 *WhatsApp da Bia voltou*",
        `Voltou em: ${brTime(now)} (estava fora desde ${brTime(new Date(prev.since ?? now))}).`,
        "Se a campanha de WhatsApp pausou por causa da queda, retome em Campanhas → WhatsApp.",
      ].join("\n");
      next = { status: "up", since: now.toISOString(), last_email_at: now.toISOString() };
    }

    let waResult: { ok: boolean; enviados: number } | null = null;
    if (whats) {
      waResult = await enviarAlertaWhatsApp(admin, ch.account_id, evo, whats);
      // Reached nobody: a "down" alert is tried again next run (a "back"
      // notice is not — the state moved on).
      if (!waResult.ok) next = { ...next, last_email_at: prev.last_email_at };
      // Also in the app's notifications: on each state change and each alert that went out.
      const { data: admins } = await admin.from("user_roles").select("user_id").eq("account_id", ch.account_id).eq("role", "admin");
      if (admins?.length && (waResult.ok || prev.status !== next.status)) {
        await admin.from("notifications").insert(admins.map((a: { user_id: string }) => ({
          account_id: ch.account_id,
          user_id: a.user_id,
          kind: problem ? "whatsapp_down" : "whatsapp_up",
          title: problem ? "WhatsApp da Bia fora do ar" : "WhatsApp da Bia voltou",
          body: problem ?? "O WhatsApp da Bia voltou a funcionar.",
          link_to: "/channels",
          metadata: { channel_id: ch.id },
        })));
      }
    }

    if (JSON.stringify(next) !== JSON.stringify(prev)) {
      // Re-read so we don't clobber fields other functions wrote meanwhile.
      const { data: fresh } = await admin.from("channels").select("config").eq("id", ch.id).maybeSingle();
      await admin.from("channels").update({ config: { ...(fresh?.config ?? cfg), evolution_alert: next } }).eq("id", ch.id);
    }
    console.log(`[whatsapp-health-check] channel=${ch.id} state=${raw} problem=${problem ?? "—"} alerta_whatsapp=${waResult ? waResult.enviados : "—"}`);
    results.push({ channel_id: ch.id, state: raw, problem, alertou: waResult ? waResult.ok : null });
  }

  // Daily WhatsApp report at 8h on weekdays (POPMED, 09/11 and 16/11), once per account.
  const relatorios: unknown[] = [];
  for (const accountId of new Set((channels ?? []).map((c: { account_id: string }) => c.account_id))) {
    const r = await talvezEnviarRelatorio(admin, accountId);
    if (r) relatorios.push({ account_id: accountId, ...r });
    // Last day of the month at 18h: the month's total (POPMED, 10/11).
    const m = await talvezEnviarRelatorioMensal(admin, accountId);
    if (m) relatorios.push({ account_id: accountId, ...m });
  }

  // Store orders the Bia created (LOJA_POPMED_ATIVA) are never expired by the
  // store (guide item 6): cancel the unpaid ones older than 7 days. Piggybacks
  // on this 5-minute cron, at most once an hour.
  let pedidosCancelados: number | null = null;
  if (lojaAtiva() && new Date().getUTCMinutes() < 5) {
    try {
      pedidosCancelados = await new LojaPopmed().cancelarVencidos(7);
      if (pedidosCancelados) console.log(`[whatsapp-health-check] pedidos vencidos cancelados=${pedidosCancelados}`);
    } catch (e) {
      console.error("[whatsapp-health-check] cancelar pedidos vencidos falhou", e);
    }
  }

  return j({ ok: true, checked: results.length, results, relatorios, pedidos_vencidos_cancelados: pedidosCancelados });
});

function j(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}
