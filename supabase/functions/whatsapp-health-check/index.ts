// whatsapp-health-check
// ---------------------
// Watches the Bia's WhatsApp (Evolution) and e-mails the POPMED team when it
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
//   { status: "down" | "up", since, reason, last_email_at }
// "Down" e-mails go out on the transition and every REMIND_HOURS while down.
//
// Recipients: accounts.internal_attributes.alerts.whatsapp_emails, else
// DEFAULT_RECIPIENTS (asked by POPMED on 15/10).
//
// Manual test (admin user JWT): POST { "mode": "test" } e-mails a test alert.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.74.0";
import { checkWhatsAppNumbers, getConnectionState, normalizeStatus } from "../_shared/evolution/index.ts";
import { LojaPopmed, lojaAtiva } from "../_shared/loja-popmed.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret",
};

const DEFAULT_RECIPIENTS = ["monikmendes@popmed.com.br", "qualidade@popmed.com.br"];
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

async function sendEmail(to: string[], subject: string, html: string): Promise<{ ok: boolean; error?: string }> {
  const key = Deno.env.get("RESEND_API_KEY");
  const from = Deno.env.get("RESEND_FROM_EMAIL");
  if (!key || !from) return { ok: false, error: "RESEND_API_KEY / RESEND_FROM_EMAIL não configurados" };
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from, to, subject, html }),
  });
  if (!res.ok) return { ok: false, error: `Resend ${res.status}: ${(await res.text()).slice(0, 300)}` };
  return { ok: true };
}

function emailHtml(title: string, lines: string[], color: string) {
  return `<div style="font-family:Arial,sans-serif;max-width:560px">
<h2 style="color:${color};margin:0 0 12px">${title}</h2>
${lines.map((l) => `<p style="margin:0 0 8px;font-size:14px;color:#222">${l}</p>`).join("\n")}
<p style="margin:16px 0 0;font-size:12px;color:#777">Aviso automático da Bia cobrança (POPMED).</p>
</div>`;
}

// deno-lint-ignore no-explicit-any
async function recipientsFor(admin: any, accountId: string): Promise<string[]> {
  const { data } = await admin.from("accounts").select("internal_attributes").eq("id", accountId).maybeSingle();
  const list = (data?.internal_attributes as any)?.alerts?.whatsapp_emails;
  return Array.isArray(list) && list.length ? list.map(String) : DEFAULT_RECIPIENTS;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const admin = createClient(supabaseUrl, serviceKey);
  const body = await req.json().catch(() => ({})) as { mode?: string };

  // ── Auth: cron/service, or an admin user for the test e-mail ──
  const authHeader = req.headers.get("Authorization") ?? "";
  const cronHeader = req.headers.get("x-cron-secret") ?? "";
  const cronSecrets = [Deno.env.get("LOVABLE_CRON_SECRET"), Deno.env.get("LOVABLE_CRON_SECRET_PREVIOUS")]
    .filter((s): s is string => !!s && s.length >= 16);
  const isService = !!serviceKey && authHeader.includes(serviceKey);
  const isCron = !!cronHeader && cronSecrets.some((s) => safeEqual(s, cronHeader));

  if (body.mode === "test") {
    const userClient = createClient(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: u } = await userClient.auth.getUser();
    if (!u?.user?.id) return j({ error: "unauthorized" }, 401);
    const { data: role } = await admin.from("user_roles").select("account_id, role").eq("user_id", u.user.id).eq("role", "admin").limit(1).maybeSingle();
    if (!role) return j({ error: "admin role required" }, 403);
    const to = await recipientsFor(admin, role.account_id);
    const sent = await sendEmail(
      to,
      "Teste — aviso de queda do WhatsApp da Bia",
      emailHtml("Teste do aviso de WhatsApp", [
        `Este é um e-mail de teste enviado em ${brTime()}.`,
        "Se o WhatsApp da Bia cair, for bloqueado ou parar de enviar mensagens, vocês recebem um aviso como este.",
      ], "#2563eb"),
    );
    return j({ ok: sent.ok, to, error: sent.error });
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
    let email: { subject: string; html: string } | null = null;

    if (problem) {
      const firstTime = prev.status !== "down";
      const remind = !firstTime && (!prev.last_email_at || now.getTime() - new Date(prev.last_email_at).getTime() > REMIND_HOURS * 3600_000);
      if (firstTime || remind) {
        email = {
          subject: firstTime ? "🔴 WhatsApp da Bia caiu" : "🔴 WhatsApp da Bia continua fora do ar",
          html: emailHtml(firstTime ? "WhatsApp da Bia fora do ar" : "WhatsApp da Bia continua fora do ar", [
            `<b>Desde:</b> ${brTime(firstTime ? now : new Date(prev.since ?? now))}`,
            `<b>O que aconteceu:</b> ${problem}`,
            "Enquanto isso, a Bia não consegue mandar nem receber mensagens no WhatsApp (campanhas, respostas, link de pagamento e avisos após ligação).",
            "<b>O que fazer:</b> abra o app em <b>Canais</b> e clique em <b>Reconectar</b>; escaneie o QR Code com o celular do número da Bia. Se o WhatsApp tiver sido bloqueado, verifique o aplicativo no celular.",
          ], "#dc2626"),
        };
      }
      next = { status: "down", since: firstTime ? now.toISOString() : prev.since, reason: problem, last_email_at: email ? now.toISOString() : prev.last_email_at };
    } else if (prev.status === "down") {
      email = {
        subject: "🟢 WhatsApp da Bia voltou",
        html: emailHtml("WhatsApp da Bia voltou a funcionar", [
          `<b>Voltou em:</b> ${brTime(now)} (estava fora desde ${brTime(new Date(prev.since ?? now))}).`,
          "Se havia campanha de WhatsApp pausada por causa da queda, retome em Campanhas → WhatsApp.",
        ], "#16a34a"),
      };
      next = { status: "up", since: now.toISOString(), last_email_at: now.toISOString() };
    }

    let emailResult: { ok: boolean; error?: string } | null = null;
    if (email) {
      const to = await recipientsFor(admin, ch.account_id);
      emailResult = await sendEmail(to, email.subject, email.html);
      if (!emailResult.ok) {
        console.error(`[whatsapp-health-check] e-mail failed: ${emailResult.error}`);
        next = { ...next, last_email_at: prev.last_email_at }; // try again next run
      }
      // Also in the app's notifications, for whoever is logged in.
      const { data: admins } = await admin.from("user_roles").select("user_id").eq("account_id", ch.account_id).eq("role", "admin");
      if (admins?.length) {
        await admin.from("notifications").insert(admins.map((a: { user_id: string }) => ({
          account_id: ch.account_id,
          user_id: a.user_id,
          kind: problem ? "whatsapp_down" : "whatsapp_up",
          title: email!.subject.replace(/^\S+\s/, ""),
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
    console.log(`[whatsapp-health-check] channel=${ch.id} state=${raw} problem=${problem ?? "—"} email=${email ? (emailResult?.ok ? "sent" : "failed") : "—"}`);
    results.push({ channel_id: ch.id, state: raw, problem, emailed: email ? emailResult?.ok ?? false : null });
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

  return j({ ok: true, checked: results.length, results, pedidos_vencidos_cancelados: pedidosCancelados });
});

function j(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}
