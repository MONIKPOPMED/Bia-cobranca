// Hard-stop active voice calls.
// Accepts { voice_call_id } OR { campaign_id }.
// For each active call (queued/ringing/in_progress):
//   1. Twilio: POST /Calls/{Sid}.json with Status=completed (cancels ring or hangs up)
//   2. ElevenLabs: best-effort DELETE on conversation endpoint
//   3. Mark voice_calls.status='canceled' regardless
//   4. Free voice_campaign_contacts (status -> 'canceled') so dispatcher skips them
//
// Auth: requires JWT (member of account).

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.74.0";
import { loadAccountTwilioCreds, twilioRequest } from "../_shared/twilio/index.ts";
import { resolveCredentialsForAccount } from "../_shared/elevenlabs/client.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return j({ ok: false, error: "method not allowed" }, 405);

  const authHeader = req.headers.get("Authorization") ?? "";
  const userClient = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_ANON_KEY")!,
    { global: { headers: { Authorization: authHeader } } },
  );
  const { data: { user } } = await userClient.auth.getUser();
  if (!user) return j({ ok: false, error: "unauthorized" }, 401);

  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  let body: { voice_call_id?: string; campaign_id?: string };
  try { body = await req.json(); } catch { return j({ ok: false, error: "invalid json" }, 400); }

  // Resolve target calls
  let query = admin
    .from("voice_calls")
    .select("id, account_id, provider, provider_call_sid, source_id, metadata, status")
    .in("status", ["queued", "ringing", "in_progress"]);

  if (body.voice_call_id) {
    query = query.eq("id", body.voice_call_id);
  } else if (body.campaign_id) {
    // voice_calls join via voice_campaign_contacts.campaign_id
    const { data: contacts } = await admin
      .from("voice_campaign_contacts")
      .select("voice_call_id, campaign_id")
      .eq("campaign_id", body.campaign_id)
      .not("voice_call_id", "is", null);
    const ids = (contacts ?? []).map((c: any) => c.voice_call_id).filter(Boolean);
    if (ids.length === 0) {
      // Still mark non-dispatched contacts as canceled
      // Real statuses: queued, placed, ringing, connected, escalated, failed, canceled
      await admin.from("voice_campaign_contacts")
        .update({ status: "canceled" })
        .eq("campaign_id", body.campaign_id)
        .in("status", ["queued", "placed"]);
      return j({ ok: true, canceled: 0 });
    }
    query = query.in("id", ids);
  } else {
    return j({ ok: false, error: "voice_call_id or campaign_id required" }, 400);
  }

  const { data: calls, error: callsErr } = await query;
  if (callsErr) return j({ ok: false, error: callsErr.message }, 500);

  // Verify user is member of all accounts
  const accountIds = Array.from(new Set((calls ?? []).map((c: any) => c.account_id)));
  for (const accId of accountIds) {
    const { data: member } = await admin
      .from("account_users")
      .select("account_id")
      .eq("account_id", accId)
      .eq("user_id", user.id)
      .maybeSingle();
    if (!member) return j({ ok: false, error: "forbidden" }, 403);
  }

  const elKeyByAccount = new Map<string, string | null>();
  const twilioCredsByAccount = new Map<string, Awaited<ReturnType<typeof loadAccountTwilioCreds>>>();

  let canceled = 0;
  const errors: string[] = [];

  for (const call of (calls ?? []) as any[]) {
    // 1. Twilio cancel
    if (call.provider_call_sid) {
      try {
        let creds = twilioCredsByAccount.get(call.account_id);
        if (!creds) {
          creds = await loadAccountTwilioCreds(admin, call.account_id);
          twilioCredsByAccount.set(call.account_id, creds);
        }
        await twilioRequest({
          method: "POST",
          path: `/2010-04-01/Accounts/${creds.accountSid}/Calls/${call.provider_call_sid}.json`,
          credentials: creds,
          form: { Status: "completed" },
        });
      } catch (e: any) {
        errors.push(`twilio ${call.provider_call_sid}: ${e?.message ?? e}`);
      }
    }

    // 2. ElevenLabs cancel (best-effort)
    const elConvId = call.source_id ?? (call.metadata as any)?.elevenlabs_conversation_id;
    if (elConvId) {
      try {
        if (!elKeyByAccount.has(call.account_id)) {
          const key = await resolveCredentialsForAccount(admin, call.account_id)
            .then((c) => c.apiKey)
            .catch(() => null);
          elKeyByAccount.set(call.account_id, key);
        }
        const elKey = elKeyByAccount.get(call.account_id);
        if (elKey) {
          await fetch(`https://api.elevenlabs.io/v1/convai/conversations/${elConvId}`, {
            method: "DELETE",
            headers: { "xi-api-key": elKey },
          });
        }
      } catch {
        // best-effort
      }
    }

    // 3. Mark canceled
    await admin
      .from("voice_calls")
      .update({
        status: "canceled",
        ended_at: new Date().toISOString(),
        metadata: { ...(call.metadata ?? {}), canceled_by: user.id, canceled_at: new Date().toISOString() },
      })
      .eq("id", call.id);
    canceled++;
  }

  // 4. Free pending campaign contacts (queued + placed but not yet ringing)
  if (body.campaign_id) {
    await admin.from("voice_campaign_contacts")
      .update({ status: "canceled" })
      .eq("campaign_id", body.campaign_id)
      .in("status", ["queued", "placed"]);
  }

  return j({ ok: true, canceled, errors });
});

function j(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
