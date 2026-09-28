// Streams a call recording from ElevenLabs to the browser. EL serves audio
// behind xi-api-key auth, so we proxy through here instead of exposing
// the key. One-shot fetch, no range support (fine for 2-10min calls).
//
// Input: { voice_call_id } — we look up source_id (EL conversation_id)
// from voice_calls and fetch /v1/convai/conversations/{id}/audio.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.74.0";
import { resolveCredentialsForAccount } from "../_shared/elevenlabs/client.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return j({ error: "method not allowed" }, 405);

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return j({ error: "unauthorized" }, 401);

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const admin = createClient(supabaseUrl, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const userClient = createClient(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: u } = await userClient.auth.getUser();
  if (!u?.user?.id) return j({ error: "unauthorized" }, 401);

  let body: { voice_call_id: string };
  try { body = await req.json(); } catch { return j({ error: "bad JSON" }, 400); }
  if (!body.voice_call_id) return j({ error: "voice_call_id required" }, 400);

  const { data: call } = await admin
    .from("voice_calls")
    .select("id, account_id, source_id, recording_url")
    .eq("id", body.voice_call_id)
    .maybeSingle();
  if (!call) return j({ error: "call not found" }, 404);

  // Authz: caller must belong to the account.
  const { data: membership } = await admin
    .from("account_users").select("account_id")
    .eq("user_id", u.user.id).eq("account_id", call.account_id)
    .maybeSingle();
  if (!membership) return j({ error: "forbidden" }, 403);

  // If legacy Twilio recording, bounce client back to the Twilio URL directly.
  if (call.recording_url) {
    return j({ ok: true, audio_url: call.recording_url, source: "twilio" });
  }

  const convId = call.source_id as string | null;
  if (!convId) return j({ error: "no recording available (ElevenLabs conversation_id missing)" }, 404);

  let elKey: string;
  try {
    elKey = (await resolveCredentialsForAccount(admin, call.account_id)).apiKey;
  } catch (e) {
    return j({ error: e instanceof Error ? e.message : String(e) }, 503);
  }

  const upstream = await fetch(
    `https://api.elevenlabs.io/v1/convai/conversations/${encodeURIComponent(convId)}/audio`,
    { headers: { "xi-api-key": elKey } },
  );
  if (!upstream.ok || !upstream.body) {
    const text = await upstream.text().catch(() => "");
    return j({ error: `EL audio fetch failed: ${upstream.status}: ${text.slice(0, 200)}` }, 502);
  }

  // Stream the MP3 directly back.
  return new Response(upstream.body, {
    status: 200,
    headers: {
      ...corsHeaders,
      "Content-Type": upstream.headers.get("content-type") ?? "audio/mpeg",
      "Cache-Control": "private, max-age=300",
    },
  });
});

function j(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
