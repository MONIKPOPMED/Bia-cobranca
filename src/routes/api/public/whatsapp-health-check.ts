import { createFileRoute } from "@tanstack/react-router";
import { authenticateCronRequest } from "@/integrations/supabase/cron-auth";

/**
 * Cron entry point for the WhatsApp monitor (edge function whatsapp-health-check,
 * PR #45). Lovable's scheduler can only call routes of the site, so this route
 * forwards the run to the edge function with the same LOVABLE_CRON_SECRET,
 * which the function accepts in x-cron-secret.
 */
export const Route = createFileRoute("/api/public/whatsapp-health-check")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const authError = await authenticateCronRequest(request);
        if (authError) return authError;

        const url = process.env["SUPABASE_URL"];
        const secret = process.env["LOVABLE_CRON_SECRET"];
        if (!url || !secret) return Response.json({ error: "SUPABASE_URL / LOVABLE_CRON_SECRET ausentes" }, { status: 500 });
        try {
          const res = await fetch(`${url.replace(/\/$/, "")}/functions/v1/whatsapp-health-check`, {
            method: "POST",
            headers: { "Content-Type": "application/json", "x-cron-secret": secret },
            body: "{}",
          });
          const body = await res.text();
          return new Response(body, { status: res.status, headers: { "Content-Type": "application/json" } });
        } catch (error) {
          console.error("[whatsapp-health-check route]", error);
          return Response.json({ error: error instanceof Error ? error.message : "Falha ao chamar o monitor" }, { status: 502 });
        }
      },
    },
  },
});
