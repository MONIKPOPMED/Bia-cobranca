// Server tool "passar_para_equipe" do agente ElevenLabs (regra da POPMED,
// 07/10): quando a Bia não consegue resolver na ligação, a equipe recebe o
// resumo no WhatsApp da equipe (company_settings.support_phone) e chama o
// cliente. A ligação NÃO é transferida — a Bia se despede e encerra.
//
// (O nome da função ficou voice-transfer-tool porque já estava publicada
// com verify_jwt = false.)
//
// Body: { motivo?: string, conversation_id (preenchido pela EL) }
// Headers: x-el-webhook-secret, x-conversation-id (injetado pela EL)
// Auth: x-el-webhook-secret. Deploy with verify_jwt = false (EL sends no JWT).

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.74.0";
import { spokenAreaAndEnding, SUPPORT_HOURS_TEXT } from "../_shared/handoff.ts";
import { loadTeamWhatsApp, notifyTeam } from "../_shared/team-handoff.ts";
import { findToolCall } from "../_shared/voice/tool-call.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "*, x-el-webhook-secret, x-conversation-id",
};

const SAY_GOODBYE =
  `Diga que alguém da nossa equipe vai continuar o atendimento pelo WhatsApp, no horário de atendimento (${SUPPORT_HOURS_TEXT}), despeça-se e chame end_call.`;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return j({ ok: false, error: "method not allowed" }, 405);

  const expected = Deno.env.get("ELEVENLABS_WEBHOOK_SECRET") ?? "";
  const received = req.headers.get("x-el-webhook-secret") ?? "";
  if (expected && !timingSafeEqual(expected, received)) {
    return new Response("Forbidden", { status: 403, headers: corsHeaders });
  }

  const body = await req.json().catch(() => ({})) as { motivo?: string; conversation_id?: string };
  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const call = await findToolCall(admin, req, body, "voice-transfer-tool");
  if (!call) return j({ ok: false, message: SAY_GOODBYE, error: "call not found" });

  const customerPhone = String(call.direction).startsWith("outbound") ? call.to_number : call.from_number;
  let notified = false;
  try {
    notified = await notifyTeam(admin, {
      accountId: call.account_id,
      origin: "Ligação",
      customerPhone: customerPhone ?? "",
      contactId: call.metadata?.contact_id ?? null,
      reason: body.motivo ?? null,
    });
  } catch (err) {
    console.error("[voice-transfer-tool] notifyTeam failed", err);
  }

  await admin
    .from("voice_calls")
    .update({
      metadata: {
        ...(call.metadata ?? {}),
        handoff: { reason: body.motivo ?? null, team_notified: notified, at: new Date().toISOString() },
      },
    })
    .eq("id", call.id);

  console.log(`[voice-transfer-tool] call=${call.id} team_notified=${notified}`);
  const team = await loadTeamWhatsApp(admin, call.account_id);
  const fromWhere = team ? ` Avise que a mensagem vai chegar de um número com ${spokenAreaAndEnding(team)}.` : "";
  return j({ ok: notified, message: SAY_GOODBYE + fromWhere });
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
