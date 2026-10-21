// Cron-triggered endpoint: pega chamadas EL que ficaram travadas em
// queued/ringing/in_progress ou completed sem transcript e dispara
// voice-call-finalize pra cada uma.
//
// Suporta 2 janelas:
//   ?window=fresh → calls com 30s ≤ idade ≤ 5min  (cron de 1 min)
//   ?window=stale → calls com 5min < idade ≤ 24h  (cron de 5 min)
//   (sem param)   → comportamento legado: idade ≥ 90s, sem teto
//
// Isso garante que mesmo se o webhook EL não chegar, o transcript +
// áudio + classificação acontecem rapidamente.

import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { authenticateCronRequest } from "@/integrations/supabase/cron-auth";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

type Window = "fresh" | "stale" | "all";

function resolveWindow(url: URL): { mode: Window; minIso: string; maxIso: string | null; limit: number } {
  const w = (url.searchParams.get("window") ?? "").toLowerCase();
  const now = Date.now();
  if (w === "fresh") {
    return {
      mode: "fresh",
      // mais novas que 5min, mais velhas que 30s
      maxIso: new Date(now - 30 * 1000).toISOString(),
      minIso: new Date(now - 5 * 60 * 1000).toISOString(),
      limit: 25,
    };
  }
  if (w === "stale") {
    return {
      mode: "stale",
      maxIso: new Date(now - 5 * 60 * 1000).toISOString(),
      minIso: new Date(now - 24 * 60 * 60 * 1000).toISOString(),
      limit: 50,
    };
  }
  return {
    mode: "all",
    maxIso: new Date(now - 90 * 1000).toISOString(),
    minIso: new Date(now - 24 * 60 * 60 * 1000).toISOString(),
    limit: 50,
  };
}

export const Route = createFileRoute("/api/public/hooks/voice-calls-finalize-pending")({
  server: {
    handlers: {
      OPTIONS: async () =>
        new Response(null, { status: 204, headers: corsHeaders }),

      POST: async ({ request }) => {
        // Only the scheduler (Bearer LOVABLE_CRON_SECRET, like the other
        // crons) may trigger it — it used to be open to anyone (21/10).
        const authError = await authenticateCronRequest(request);
        if (authError) return authError;
        const startedAt = Date.now();
        const url = new URL(request.url);
        const { mode, minIso, maxIso, limit } = resolveWindow(url);

        // 1) Calls travadas em queued/ringing/in_progress (qualquer provedor)
        const stuckQuery = supabaseAdmin
          .from("voice_calls")
          .select("id, account_id, status, source_id, recording_storage_path, transcription_status, started_at")
          .in("status", ["queued", "ringing", "in_progress"])
          .gte("started_at", minIso)
          .order("started_at", { ascending: true })
          .limit(limit);
        if (maxIso) stuckQuery.lt("started_at", maxIso);

        const { data: stuck, error: stuckErr } = await stuckQuery;

        if (stuckErr) {
          console.error("[finalize-pending] stuck query failed", stuckErr);
          return new Response(
            JSON.stringify({ error: stuckErr.message }),
            { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
          );
        }

        // 2) Calls "completed" mas sem transcript ainda (qualquer provedor)
        const incQuery = supabaseAdmin
          .from("voice_calls")
          .select("id, account_id, status, source_id, recording_storage_path, transcription_status, collection_outcome, started_at")
          .eq("status", "completed")
          .or(
            // EL sem transcript OU qualquer call já transcrita mas sem outcome.
            "and(source_id.not.is.null,transcription_status.neq.done)," +
              "and(transcription_status.eq.done,collection_outcome.is.null)",
          )
          .gte("started_at", minIso)
          .order("started_at", { ascending: true })
          .limit(limit);
        if (maxIso) incQuery.lt("started_at", maxIso);

        const { data: incomplete, error: incErr } = await incQuery;

        if (incErr) {
          console.error("[finalize-pending] incomplete query failed", incErr);
        }

        const candidates = [...(stuck ?? []), ...(incomplete ?? [])];
        const seen = new Set<string>();
        const unique = candidates.filter((c) => {
          if (seen.has(c.id)) return false;
          seen.add(c.id);
          return true;
        });

        const results: Array<{ id: string; ok: boolean; route: string; reason?: string }> = [];

        for (const c of unique) {
          // Decide qual pipeline rodar pra este registro
          let fnName: "voice-call-finalize" | "collection-extract-arrangement" | "noop" = "noop";

          if (c.source_id) {
            // ElevenLabs — sempre passa pelo finalize (busca transcript+áudio+extrai)
            fnName = "voice-call-finalize";
          } else if (c.transcription_status === "done" && !(c as any).collection_outcome) {
            // Já transcrito mas extração nunca rodou
            fnName = "collection-extract-arrangement";
          } else {
            results.push({ id: c.id, ok: true, route: "noop", reason: "nothing to do" });
            continue;
          }

          try {
            const { data, error: invErr } = await supabaseAdmin.functions.invoke(
              fnName,
              { body: { voice_call_id: c.id } },
            );
            if (invErr) {
              results.push({ id: c.id, ok: false, route: fnName, reason: invErr.message });
            } else {
              const d = data as { skipped?: boolean; transcript_messages?: number; utterances?: number; extract?: { arrangement_id?: string | null }; arrangement_id?: string | null };
              const reason = d?.skipped
                ? "skipped"
                : fnName === "voice-call-finalize"
                ? `finalized:${d?.transcript_messages ?? 0}msgs${d?.extract?.arrangement_id ? "+arr" : ""}`
                : `extracted${d?.arrangement_id ? ":+arr" : ""}`;
              results.push({ id: c.id, ok: true, route: fnName, reason });
            }
          } catch (err) {
            results.push({ id: c.id, ok: false, route: fnName, reason: String(err) });
          }
        }

        const okCount = results.filter((r) => r.ok).length;
        const failCount = results.length - okCount;
        const elapsedMs = Date.now() - startedAt;

        console.log(
          `[finalize-pending] window=${mode} scanned=${unique.length} ok=${okCount} fail=${failCount} stuck=${stuck?.length ?? 0} incomplete=${incomplete?.length ?? 0} elapsed=${elapsedMs}ms`,
        );

        return new Response(
          JSON.stringify({
            ok: true,
            window: mode,
            scanned: unique.length,
            stuck: stuck?.length ?? 0,
            incomplete: incomplete?.length ?? 0,
            ok_count: okCount,
            fail_count: failCount,
            elapsed_ms: elapsedMs,
            results,
          }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      },
    },
  },
});
