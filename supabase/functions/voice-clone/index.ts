// Instant Voice Clone via ElevenLabs — gated por feature flag voice_clone_enabled
// Body: { personaId, audioBase64, filename, mimeType }
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.74.0";
import { resolveCredentialsForAccount } from "../_shared/elevenlabs/client.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface Body {
  personaId: string;
  audioBase64: string;
  filename: string;
  mimeType: string;
}

function decodeBase64(b64: string): Uint8Array {
  const bin = atob(b64);
  const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  return arr;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "unauthorized" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const userClient = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: authHeader } } });
    const { data: { user }, error: userErr } = await userClient.auth.getUser();
    if (userErr || !user) {
      return new Response(JSON.stringify({ error: "unauthorized" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const body = (await req.json()) as Body;
    if (!body.personaId || !body.audioBase64) {
      return new Response(JSON.stringify({ error: "personaId and audioBase64 required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Persona + account check
    const { data: persona, error: personaErr } = await userClient
      .from("agent_personas")
      .select("id, name, account_id")
      .eq("id", body.personaId)
      .maybeSingle();
    if (personaErr || !persona) {
      return new Response(JSON.stringify({ error: "persona not found" }), { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // Admin check
    const supabase = createClient(supabaseUrl, serviceKey);
    const { data: isAdmin } = await supabase.rpc("has_role", {
      _user_id: user.id,
      _account_id: persona.account_id,
      _role: "admin",
    });
    if (!isAdmin) {
      return new Response(JSON.stringify({ error: "admin role required" }), { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // Feature flag check
    const { data: account } = await supabase
      .from("accounts")
      .select("feature_flags")
      .eq("id", persona.account_id)
      .single();
    const flags = (account?.feature_flags ?? {}) as Record<string, unknown>;
    if (flags.voice_clone_enabled !== true) {
      return new Response(JSON.stringify({
        error: "voice_clone_disabled",
        message: "Voice clone está desativado nesta conta. Ative a flag voice_clone_enabled.",
      }), { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const elevenKey = await resolveCredentialsForAccount(supabase, persona.account_id)
      .then((c) => c.apiKey)
      .catch(() => null);
    if (!elevenKey) {
      return new Response(JSON.stringify({
        error: "elevenlabs_not_configured",
        message: "Configure a chave da ElevenLabs da conta (Integrações) para clonar vozes.",
      }), { status: 503, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // Upload to ElevenLabs
    const audioBytes = decodeBase64(body.audioBase64);
    const blob = new Blob([new Uint8Array(audioBytes)], { type: body.mimeType || "audio/mpeg" });

    const formData = new FormData();
    formData.append("name", `${persona.name} (Nexus persona ${persona.id.slice(0, 8)})`);
    formData.append("description", `Voice clone for Nexus persona ${persona.id}`);
    formData.append("files", blob, body.filename || "sample.mp3");

    const elev = await fetch("https://api.elevenlabs.io/v1/voices/add", {
      method: "POST",
      headers: { "xi-api-key": elevenKey },
      body: formData,
    });
    const elevData = await elev.json();

    if (!elev.ok || !elevData.voice_id) {
      console.error("[voice-clone] elevenlabs error", elevData);
      return new Response(JSON.stringify({ error: "elevenlabs_error", details: elevData }), {
        status: 502,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Update persona
    await supabase
      .from("agent_personas")
      .update({
        voice_provider: "elevenlabs",
        voice_clone_id: elevData.voice_id,
      })
      .eq("id", persona.id);

    return new Response(JSON.stringify({
      voiceId: elevData.voice_id,
      personaId: persona.id,
      provider: "elevenlabs",
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("[voice-clone] error", e);
    return new Response(JSON.stringify({ error: String(e) }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
