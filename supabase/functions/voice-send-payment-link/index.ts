// Server tool "enviar_link_pagamento" do agente ElevenLabs: durante a
// ligação, a Bia manda pelo WhatsApp (Evolution) o link fixo de pagamento
// da mensalidade, por PIX ou cartão.
//
// Links fixos só valem para UMA mensalidade. Com 2+ mensalidades em atraso
// (ou sem dívida no sistema) não enviamos nada e devolvemos ao agente a
// instrução de dizer que a equipe manda o link.
//
// Body: { metodo: "pix" | "cartao" }
// Headers: x-el-webhook-secret, x-conversation-id (injetado pela EL)
// Auth: x-el-webhook-secret. Deploy with verify_jwt = false (EL sends no JWT).

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.74.0";
import { sendText } from "../_shared/evolution/index.ts";
import { phoneVariants } from "../_shared/phone.ts";
import { PAYMENT_LINKS, type PaymentMethod } from "../_shared/payment-links.ts";
import { notifyTeam } from "../_shared/team-handoff.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "*, x-el-webhook-secret, x-conversation-id",
};

const TEAM_WILL_SEND =
  "Não envie nada agora. Diga ao cliente que alguém da equipe vai mandar o link de pagamento pelo WhatsApp.";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return j({ ok: false, error: "method not allowed" }, 405);

  const expected = Deno.env.get("ELEVENLABS_WEBHOOK_SECRET") ?? "";
  const received = req.headers.get("x-el-webhook-secret") ?? "";
  if (expected && !timingSafeEqual(expected, received)) {
    return new Response("Forbidden", { status: 403, headers: corsHeaders });
  }

  let body: { metodo?: string };
  try {
    body = await req.json();
  } catch {
    return j({ ok: false, error: "invalid json" }, 400);
  }
  const metodo = body.metodo as PaymentMethod;
  if (!(metodo in PAYMENT_LINKS)) {
    return j({ ok: false, message: "Pergunte se o cliente prefere PIX ou cartão e chame de novo." }, 400);
  }

  const conversationId = req.headers.get("x-conversation-id") ?? "";
  if (!conversationId || conversationId.startsWith("{{")) {
    return j({ ok: false, message: TEAM_WILL_SEND, error: "missing conversation id" });
  }

  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  const { data: call } = await admin
    .from("voice_calls")
    .select("id, account_id, direction, from_number, to_number, metadata")
    .eq("source_id", conversationId)
    .maybeSingle();
  if (!call) return j({ ok: false, message: TEAM_WILL_SEND, error: "call not found" });

  const customerPhone = String(call.direction).startsWith("outbound") ? call.to_number : call.from_number;
  const { data: contacts } = await admin
    .from("contacts")
    .select("id, name, phone_number")
    .eq("account_id", call.account_id)
    .in("phone_number", phoneVariants(customerPhone ?? ""))
    .limit(1);
  const contact = contacts?.[0];

  const { count: openCount } = contact
    ? await admin
      .from("debts")
      .select("id", { count: "exact", head: true })
      .eq("account_id", call.account_id)
      .eq("contact_id", contact.id)
      .in("status", ["aberto", "em_negociacao"])
    : { count: 0 };

  const recordOutcome = (payment_link: Record<string, unknown>) =>
    admin
      .from("voice_calls")
      .update({ metadata: { ...(call.metadata ?? {}), payment_link: { ...payment_link, metodo, at: new Date().toISOString() } } })
      .eq("id", call.id);

  // The agent tells the customer the team will send the link — make sure the
  // team actually hears about it.
  const askTeam = (why: string) =>
    notifyTeam(admin, {
      accountId: call.account_id,
      origin: "Ligação",
      customerPhone: customerPhone ?? "",
      contactId: contact?.id ?? null,
      reason: `Cliente quer pagar por ${metodo === "pix" ? "PIX" : "cartão"} — enviar o link de pagamento (${why}).`,
    }).catch((err) => {
      console.error("[voice-send-payment-link] notifyTeam failed", err);
      return false;
    });

  if (openCount !== 1) {
    // No fixed link for 0 or 2+ installments — the team follows up.
    const why = openCount ? `${openCount} mensalidades em aberto, sem link automático` : "sem dívida em aberto no sistema";
    const teamNotified = await askTeam(why);
    await recordOutcome({ sent: false, reason: openCount ? "mais_de_uma_parcela" : "sem_divida", open_count: openCount ?? 0, team_notified: teamNotified });
    return j({ ok: false, message: TEAM_WILL_SEND });
  }

  const { data: channel } = await admin
    .from("channels")
    .select("config")
    .eq("account_id", call.account_id)
    .eq("channel_type", "whatsapp")
    .eq("enabled", true)
    .maybeSingle();
  const cfg = (channel?.config ?? {}) as Record<string, string>;
  if (cfg.evolution_instance_status !== "connected" || !cfg.evolution_url || !cfg.evolution_api_key || !cfg.evolution_instance_name) {
    await recordOutcome({ sent: false, reason: "whatsapp_desconectado" });
    return j({ ok: false, message: TEAM_WILL_SEND });
  }

  const { data: settings } = await admin
    .from("company_settings")
    .select("company_name")
    .eq("account_id", call.account_id)
    .maybeSingle();
  const firstName = (contact?.name as string | null)?.trim().split(/\s+/)[0];
  const hello = firstName
    ? `Oi, ${firstName.charAt(0).toUpperCase()}${firstName.slice(1).toLowerCase()}!`
    : "Oi!";
  const how = metodo === "pix" ? "por PIX" : "no cartão de crédito";
  const text =
    `${hello} Aqui é a Bia, da ${settings?.company_name ?? "POPMED"}. ` +
    `Como combinamos na ligação, segue o link para pagar sua mensalidade ${how}:\n${PAYMENT_LINKS[metodo]}`;

  try {
    const sent = await sendText({
      url: cfg.evolution_url,
      apiKey: cfg.evolution_api_key,
      instanceName: cfg.evolution_instance_name,
      number: contact!.phone_number ?? customerPhone,
      text,
    });
    await recordOutcome({ sent: true, message_id: sent.messageId ?? null });
    return j({ ok: true, message: "Link enviado pelo WhatsApp. Diga ao cliente que o link já chegou no WhatsApp dele." });
  } catch (err) {
    console.error("[voice-send-payment-link] Evolution send failed", err);
    const teamNotified = await askTeam("falha ao enviar o link automático");
    await recordOutcome({ sent: false, reason: "falha_envio", team_notified: teamNotified });
    return j({ ok: false, message: TEAM_WILL_SEND });
  }
});

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function j(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
