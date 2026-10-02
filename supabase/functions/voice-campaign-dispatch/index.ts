// Cron-driven dispatcher for queued voice_campaign_contacts rows.
// Runs every minute:
//   1. Pulls N rows where status=queued and dispatch_after <= now()
//   2. For each, invokes Twilio /Calls.json pointing TwiML URL to
//      twilio-incoming (which already renders <Connect><Stream>).
//      The voice_runtime picks up ctx.campaignId from the stream URL query.
//   3. Flips row to status=placed + stores voice_call_id.
//
// Respects max_concurrent_calls per campaign (default 5) to avoid blasting
// a 10k campaign at once and hitting Twilio / ElevenLabs quotas.

import { createClient, SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.74.0";
import { loggerFor } from "../_shared/logger.ts";
import { toE164 } from "../_shared/twilio/index.ts";
import { resolveCredentialsForAccount } from "../_shared/elevenlabs/client.ts";
import { buildCallDynamicVariables } from "../_shared/voice/call-variables.ts";
import { placeTwilioOutboundCall } from "../_shared/voice/twilio-outbound.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const DISPATCH_BATCH = 20;
const DEFAULT_CONCURRENT_PER_CAMPAIGN = 5;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  const log = loggerFor(req, { function: "voice-campaign-dispatch" });

  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const isService = (req.headers.get("Authorization") ?? "").includes(serviceKey);
  if (!isService) return j({ error: "service role required" }, 403);

  const admin = createClient(Deno.env.get("SUPABASE_URL")!, serviceKey);

  // Pick up ready contacts from RUNNING campaigns only (skip draft/paused/done)
  const { data: pending, error } = await admin
    .from("voice_campaign_contacts")
    .select(
      `id, campaign_id, account_id, contact_id, phone_number, variables, attempts,
       contact:contacts(timezone),
       campaign:voice_campaigns(
         id, status, persona_id, voice_id, phone_number_id, script_mode,
         opening_script, max_call_duration_sec, record_call, max_concurrent,
         retry_attempts, retry_delay_minutes,
         escalation_rules, account_id,
         allowed_hours_local, max_attempts_per_day, min_minutes_between_attempts,
         disclaimer_enabled
       )`,
    )
    .eq("status", "queued")
    .lte("dispatch_after", new Date().toISOString())
    .order("dispatch_after", { ascending: true })
    .limit(DISPATCH_BATCH);
  if (error) {
    log.error("scan failed", error);
    return j({ error: error.message }, 500);
  }

  const ready = (pending ?? []).filter((r: any) => r.campaign?.status === "running");
  if (ready.length === 0) return j({ ok: true, dispatched: 0 });

  // Check per-campaign concurrency cap
  const byCampaign: Record<string, typeof ready> = {};
  for (const r of ready) {
    (byCampaign[r.campaign_id] ??= []).push(r);
  }

  let dispatched = 0;
  let skipped = 0;
  for (const [campaignId, rows] of Object.entries(byCampaign)) {
    // How many are already mid-call for this campaign?
    const { count: inflight } = await admin
      .from("voice_campaign_contacts")
      .select("id", { count: "exact", head: true })
      .eq("campaign_id", campaignId)
      .in("status", ["placed", "ringing", "connected", "escalated"]);

    const cap = ((rows[0]?.campaign as any)?.max_concurrent ?? DEFAULT_CONCURRENT_PER_CAMPAIGN) as number;
    const slots = Math.max(0, cap - (inflight ?? 0));
    const take = rows.slice(0, slots);
    if (take.length === 0) {
      skipped += rows.length;
      continue;
    }

    // Quota check (campaign-level day/week/month cap on calls). If exceeded,
    // we re-queue the whole batch until the next window resets so we never
    // overshoot. Cheaper than per-row check.
    const quota = await checkCampaignQuota(admin, campaignId, "call");
    if (!quota.allowed) {
      const delayMin = quota.reason?.endsWith("_day_cap") ? 60
        : quota.reason?.endsWith("_week_cap") ? 60 * 6
        : 60 * 12;
      const nextTry = new Date(Date.now() + delayMin * 60 * 1000).toISOString();
      for (const row of take) {
        await admin.from("call_attempts_log").insert({
          account_id: row.account_id,
          contact_id: row.contact_id,
          phone_number: row.phone_number,
          campaign_id: row.campaign_id,
          outcome: `blocked_${quota.reason}`,
        });
        await admin
          .from("voice_campaign_contacts")
          .update({ dispatch_after: nextTry })
          .eq("id", row.id);
      }
      skipped += take.length;
      continue;
    }

    for (const row of take) {
      // Compliance pre-flight. If the contact is on DNC, outside allowed
      // hours, or over the per-day cap, we re-queue with a later dispatch_after
      // (unless DNC — that's terminal). Logged in call_attempts_log so the
      // admin can audit blocked attempts.
      const compliance = await checkCompliance(admin, row);
      if (!compliance.allowed) {
        await admin.from("call_attempts_log").insert({
          account_id: row.account_id,
          contact_id: row.contact_id,
          phone_number: row.phone_number,
          campaign_id: row.campaign_id,
          outcome: `blocked_${compliance.reason}`,
        });

        if (compliance.reason === "dnc") {
          await admin
            .from("voice_campaign_contacts")
            .update({
              status: "failed",
              last_error: "blocked by DNC list",
              finished_at: new Date().toISOString(),
            })
            .eq("id", row.id);
          await admin.rpc("bump_voice_campaign_totals", {
            p_campaign_id: row.campaign_id,
            p_failed: 1,
          });
          skipped++;
          continue;
        }

        // Re-queue for later (at least 15 min later so we don't spin).
        const nextTry = compliance.reason === "too_soon"
          ? new Date(Date.now() + 15 * 60 * 1000)
          : new Date(Date.now() + 30 * 60 * 1000);
        await admin
          .from("voice_campaign_contacts")
          .update({ dispatch_after: nextTry.toISOString() })
          .eq("id", row.id);
        skipped++;
        continue;
      }

      try {
        await dispatchOne(admin, row, log);
        dispatched++;
      } catch (err) {
        // Retry com backoff até esgotar retry_attempts (default 1)
        const maxAttempts = ((row.campaign as any).retry_attempts ?? 1) + 1;
        const nextAttempts = (row.attempts ?? 0) + 1;
        const errMsg = err instanceof Error ? err.message : String(err);

        if (nextAttempts < maxAttempts) {
          const delayMin = (row.campaign as any).retry_delay_minutes ?? 30;
          const nextRetry = new Date(Date.now() + delayMin * 60 * 1000);
          await admin
            .from("voice_campaign_contacts")
            .update({
              status: "queued",
              attempts: nextAttempts,
              last_error: errMsg,
              dispatch_after: nextRetry.toISOString(),
              last_attempt_at: new Date().toISOString(),
            })
            .eq("id", row.id);
        } else {
          await admin
            .from("voice_campaign_contacts")
            .update({
              status: "failed",
              attempts: nextAttempts,
              last_error: errMsg,
              finished_at: new Date().toISOString(),
            })
            .eq("id", row.id);
          await admin.rpc("bump_voice_campaign_totals", {
            p_campaign_id: row.campaign_id,
            p_failed: 1,
          });
        }
        log.error("dispatch failed", err, { campaign_id: row.campaign_id, contact_id: row.contact_id });
      }
    }

    // Auto-complete: se nenhuma row da campanha está mais em fluxo, fecha
    await maybeCompleteCampaign(admin, campaignId);
  }

  return j({ ok: true, dispatched, skipped, scanned: ready.length });
});

async function maybeCompleteCampaign(admin: SupabaseClient, campaignId: string) {
  const { count: pending } = await admin
    .from("voice_campaign_contacts")
    .select("id", { count: "exact", head: true })
    .eq("campaign_id", campaignId)
    .in("status", ["queued", "placed", "ringing", "connected", "escalated"]);
  if ((pending ?? 0) > 0) return;

  await admin
    .from("voice_campaigns")
    .update({ status: "completed", finished_at: new Date().toISOString() })
    .eq("id", campaignId)
    .eq("status", "running");
}

/**
 * Runs the compliance checks (DNC, allowed hours, rate limit) before a call
 * is placed. Uses account defaults when campaign doesn't override.
 */
async function checkCompliance(
  admin: SupabaseClient,
  row: any,
): Promise<{ allowed: boolean; reason?: string }> {
  const campaign = row.campaign;
  const timezone = row.contact?.timezone ?? "America/Sao_Paulo";

  // Pull account-level defaults once per dispatch (cached by pg planner).
  const { data: account } = await admin
    .from("accounts")
    .select("internal_attributes")
    .eq("id", row.account_id)
    .maybeSingle();
  const accCompliance = (account?.internal_attributes as any)?.compliance ?? {};

  const allowedHoursLocal =
    campaign.allowed_hours_local ?? accCompliance.allowed_hours_local ?? null;
  const maxAttempts =
    campaign.max_attempts_per_day ?? accCompliance.max_attempts_per_day_per_contact ?? 2;
  const minMinutes =
    campaign.min_minutes_between_attempts ?? accCompliance.min_minutes_between_attempts ?? 120;

  const { data: res, error } = await admin.rpc("is_phone_allowed_to_call", {
    p_account_id: row.account_id,
    p_phone_number: row.phone_number,
    p_timezone: timezone,
    p_allowed_hours_local: allowedHoursLocal,
    p_max_attempts_per_day: maxAttempts,
    p_min_minutes_between_attempts: minMinutes,
  });
  if (error) return { allowed: false, reason: "rpc_error" };
  const out = res as { allowed: boolean; reason?: string };
  return out;
}

async function dispatchOne(admin: SupabaseClient, row: any, log: any) {
  const campaign = row.campaign;
  const fromNumberId = campaign.phone_number_id;
  const toNumber = toE164(row.phone_number);

  // ElevenLabs native Twilio integration — the only path we ship now.
  // Requires: phone_numbers.elevenlabs_phone_number_id + persona.elevenlabs_agent_id.
  // Operator sets those via "Ativar IA" on /phone-numbers and
  // "Sincronizar com EL" on /agents.
  const { data: phoneRow } = await admin
    .from("phone_numbers")
    .select("e164, elevenlabs_phone_number_id")
    .eq("id", fromNumberId)
    .maybeSingle();
  if (!phoneRow?.e164) throw new Error("número emissor da campanha não encontrado");
  campaign.fromE164 = phoneRow.e164;

  // Numbers not imported into ElevenLabs (e.g. Verified Caller IDs, which EL
  // cannot import) go through our own Twilio → twilio-incoming → Bia, the
  // same path as the manual "Ligar" button.
  if (!phoneRow.elevenlabs_phone_number_id) {
    await dispatchViaTwilio(admin, row, campaign, fromNumberId, toNumber, log);
    return;
  }

  const { data: persona } = await admin
    .from("agent_personas")
    .select("elevenlabs_agent_id")
    .eq("id", campaign.persona_id)
    .maybeSingle();
  const elAgentId = persona?.elevenlabs_agent_id as string | null;
  if (!elAgentId) {
    throw new Error(
      "persona da campanha não está sincronizada com EL — abre /agents e clica 'Sincronizar com EL'",
    );
  }

  // Pre-create voice_calls row so the post-call webhook (elevenlabs-events)
  // can upsert transcript/duration on completion.
  const { data: vc } = await admin
    .from("voice_calls")
    .insert({
      account_id: row.account_id,
      phone_number_id: fromNumberId,
      persona_id: campaign.persona_id,
      direction: "outbound",
      status: "queued",
      provider: "twilio",
      from_number: campaign.fromE164,
      to_number: toNumber,
      started_at: new Date().toISOString(),
      metadata: {
        campaign_id: campaign.id,
        campaign_contact_id: row.id,
        voice_id: campaign.voice_id,
        variables: row.variables,
        opening_script: campaign.opening_script,
        engine: "elevenlabs",
      },
    })
    .select("id")
    .single();
  const voiceCallId = vc?.id;

  const elKey = (await resolveCredentialsForAccount(admin, row.account_id)).apiKey;

  // Call variables (template vars) flow as dynamic_variables → agent can
  // reference them via {{var_name}} in system_prompt, first_message, tools.
  // EL rejects the conversation if any {{var}} the agent uses is missing.
  const dynamicVariables = {
    ...(await buildCallDynamicVariables(admin, {
      accountId: row.account_id,
      personaId: campaign.persona_id,
      customerPhone: toNumber,
    })),
    ...(row.variables ?? {}),
    campaign_id: campaign.id,
    campaign_contact_id: row.id,
    voice_call_id: voiceCallId ?? "",
  };

  const res = await fetch(
    "https://api.elevenlabs.io/v1/convai/twilio/outbound-call",
    {
      method: "POST",
      headers: { "xi-api-key": elKey, "Content-Type": "application/json" },
      body: JSON.stringify({
        agent_id: elAgentId,
        agent_phone_number_id: phoneRow.elevenlabs_phone_number_id,
        to_number: toNumber,
        conversation_initiation_client_data: campaign.opening_script
          ? {
              conversation_config_override: {
                agent: { first_message: campaign.opening_script },
              },
              dynamic_variables: dynamicVariables,
            }
          : { dynamic_variables: dynamicVariables },
      }),
    },
  );
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data?.success === false) {
    throw new Error(
      `EL outbound failed: ${res.status}: ${JSON.stringify(data).slice(0, 200)}`,
    );
  }

  await admin
    .from("voice_calls")
    .update({
      provider_call_sid: data.callSid,
      source_id: data.conversation_id,
      status: "ringing",
    })
    .eq("id", voiceCallId);

  await admin
    .from("voice_campaign_contacts")
    .update({
      status: "placed",
      voice_call_id: voiceCallId,
      dispatched_at: new Date().toISOString(),
    })
    .eq("id", row.id);

  await admin.rpc("bump_voice_campaign_totals", {
    p_campaign_id: row.campaign_id,
    p_placed: 1,
  });

  // Compliance audit row — dashboard pode mostrar "tentativas por contato".
  await admin.from("call_attempts_log").insert({
    account_id: row.account_id,
    contact_id: row.contact_id,
    phone_number: toNumber,
    campaign_id: row.campaign_id,
    voice_call_id: voiceCallId,
    outcome: "placed",
  });

  log.info("placed", {
    campaign_id: row.campaign_id,
    contact_id: row.contact_id,
    sid: data.callSid,
  });
}

// deno-lint-ignore no-explicit-any
async function dispatchViaTwilio(admin: SupabaseClient, row: any, campaign: any, fromNumberId: string, toNumber: string, log: any) {
  // twilio-incoming finds this row by CallSid and reads metadata.campaign_*
  // (transfer target, variables).
  const { data: vc, error: vcErr } = await admin
    .from("voice_calls")
    .insert({
      account_id: row.account_id,
      phone_number_id: fromNumberId,
      persona_id: campaign.persona_id,
      direction: "outbound",
      status: "queued",
      provider: "twilio",
      from_number: campaign.fromE164,
      to_number: toNumber,
      started_at: new Date().toISOString(),
      metadata: {
        campaign_id: campaign.id,
        campaign_contact_id: row.id,
        contact_id: row.contact_id ?? null,
        variables: row.variables,
        engine: "twilio-register-call",
      },
    })
    .select("id")
    .single();
  if (vcErr || !vc) throw new Error(`voice_calls insert failed: ${vcErr?.message ?? "no row"}`);

  let callSid: string;
  try {
    ({ callSid } = await placeTwilioOutboundCall(admin, {
      phoneNumberId: fromNumberId,
      from: campaign.fromE164,
      to: toNumber,
    }));
  } catch (err) {
    await admin
      .from("voice_calls")
      .update({ status: "failed", ended_at: new Date().toISOString(), metadata: { campaign_id: campaign.id, campaign_contact_id: row.id, error: String(err).slice(0, 300) } })
      .eq("id", vc.id);
    throw err;
  }

  await admin.from("voice_calls").update({ provider_call_sid: callSid }).eq("id", vc.id);
  await admin
    .from("voice_campaign_contacts")
    .update({ status: "placed", voice_call_id: vc.id, dispatched_at: new Date().toISOString() })
    .eq("id", row.id);
  await admin.rpc("bump_voice_campaign_totals", { p_campaign_id: row.campaign_id, p_placed: 1 });
  await admin.from("call_attempts_log").insert({
    account_id: row.account_id,
    contact_id: row.contact_id,
    phone_number: toNumber,
    campaign_id: row.campaign_id,
    voice_call_id: vc.id,
    outcome: "placed",
  });
  log.info("placed", { campaign_id: row.campaign_id, contact_id: row.contact_id, sid: callSid, via: "twilio" });
}

async function checkCampaignQuota(
  admin: SupabaseClient,
  campaignId: string,
  kind: "call" | "message",
): Promise<{ allowed: boolean; reason?: string }> {
  const { data, error } = await admin.rpc("voice_campaign_quota_check", {
    p_campaign_id: campaignId,
    p_kind: kind,
  });
  if (error) {
    // Fail-open on RPC error so a quota glitch doesn't halt all dispatch.
    return { allowed: true };
  }
  const out = data as { allowed: boolean; reason?: string };
  return out ?? { allowed: true };
}

function j(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
