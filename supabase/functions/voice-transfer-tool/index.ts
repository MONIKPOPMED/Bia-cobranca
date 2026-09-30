// Server tool "transferir_para_equipe" do agente ElevenLabs: quando o
// cliente pede para falar com alguém (ou a Bia precisa passar o caso),
// redireciona a ligação da Twilio para o número da equipe.
//
// Destino: "Transferir para" da campanha (escalation_rules
// transfer_to_human) ou, fora de campanha, company_settings.support_phone.
// Fora do horário da equipe não transfere: devolve ao agente a instrução de
// informar o horário.
//
// A transferência em si é do voice-escalate (Twilio <Dial>), chamado com a
// service role.
//
// Headers: x-el-webhook-secret, x-conversation-id (injetado pela EL)
// Auth: x-el-webhook-secret. Deploy with verify_jwt = false (EL sends no JWT).

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.74.0";
import { isWithinSupportHours, SUPPORT_HOURS_TEXT } from "../_shared/handoff.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "*, x-el-webhook-secret, x-conversation-id",
};

const E164 = /^\+[1-9]\d{7,14}$/;

const TELL_HOURS =
  `Não transfira. Diga que alguém da equipe vai entrar em contato e informe o horário de atendimento: ${SUPPORT_HOURS_TEXT}.`;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return j({ ok: false, error: "method not allowed" }, 405);

  const expected = Deno.env.get("ELEVENLABS_WEBHOOK_SECRET") ?? "";
  const received = req.headers.get("x-el-webhook-secret") ?? "";
  if (expected && !timingSafeEqual(expected, received)) {
    return new Response("Forbidden", { status: 403, headers: corsHeaders });
  }

  const conversationId = req.headers.get("x-conversation-id") ?? "";
  if (!conversationId || conversationId.startsWith("{{")) {
    return j({ ok: false, message: TELL_HOURS, error: "missing conversation id" });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const admin = createClient(supabaseUrl, serviceKey);

  const { data: call } = await admin
    .from("voice_calls")
    .select("id, account_id, metadata")
    .eq("source_id", conversationId)
    .maybeSingle();
  if (!call) return j({ ok: false, message: TELL_HOURS, error: "call not found" });

  if (!isWithinSupportHours()) {
    return j({ ok: false, message: TELL_HOURS, reason: "fora_do_horario" });
  }

  const target = await resolveTarget(admin, call);
  if (!target) {
    console.warn("[voice-transfer-tool] no transfer number configured", call.account_id);
    return j({ ok: false, message: TELL_HOURS, reason: "sem_numero" });
  }

  const res = await fetch(`${supabaseUrl}/functions/v1/voice-escalate`, {
    method: "POST",
    headers: { Authorization: `Bearer ${serviceKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ voice_call_id: call.id, reason: "cliente_pediu_equipe", target_phone: target }),
  });
  if (!res.ok) {
    console.error("[voice-transfer-tool] voice-escalate failed", res.status, await res.text().catch(() => ""));
    return j({ ok: false, message: TELL_HOURS, reason: "falha_transferencia" });
  }
  return j({ ok: true, message: "A ligação está sendo transferida para a equipe agora." });
});

// deno-lint-ignore no-explicit-any
async function resolveTarget(admin: any, call: { account_id: string; metadata: any }): Promise<string | null> {
  const campaignId = call.metadata?.campaign_id;
  if (campaignId) {
    const { data: campaign } = await admin
      .from("voice_campaigns")
      .select("escalation_rules")
      .eq("id", campaignId)
      .maybeSingle();
    const rules = Array.isArray(campaign?.escalation_rules) ? campaign.escalation_rules : [];
    // deno-lint-ignore no-explicit-any
    const rule = rules.find((r: any) => r?.action === "transfer_to_human" && E164.test(String(r?.target ?? "")));
    if (rule) return String(rule.target);
  }
  const { data: settings } = await admin
    .from("company_settings")
    .select("support_phone")
    .eq("account_id", call.account_id)
    .maybeSingle();
  const phone = String(settings?.support_phone ?? "").replace(/[^\d+]/g, "");
  return E164.test(phone) ? phone : null;
}

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
