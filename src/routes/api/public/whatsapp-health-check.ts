import { createFileRoute } from "@tanstack/react-router";
import { authenticateCronRequest } from "@/integrations/supabase/cron-auth";

// Managed cron (every 5 min) → this route → edge function whatsapp-health-check,
// which authenticates via x-cron-secret.
export const Route = createFileRoute("/api/public/whatsapp-health-check")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const authError = await authenticateCronRequest(request);
        if (authError) return authError;

        const secret = process.env["LOVABLE_CRON_SECRET"];
        const base = process.env["SUPABASE_URL"] ?? process.env["VITE_SUPABASE_URL"];
        if (!secret || !base) return Response.json({ error: "configuração ausente" }, { status: 500 });

        try {
          const res = await fetch(`${base}/functions/v1/whatsapp-health-check`, {
            method: "POST",
            headers: { "Content-Type": "application/json", "x-cron-secret": secret },
            body: "{}",
          });
          const text = await res.text();
          return new Response(text, { status: res.status, headers: { "Content-Type": "application/json" } });
        } catch (error) {
          console.error("[whatsapp-health-check]", error);
          return Response.json({ error: "falha ao chamar o monitor" }, { status: 502 });
        }
      },
    },
  },
});
