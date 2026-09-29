import { createFileRoute } from "@tanstack/react-router";
import { authenticateCronRequest } from "@/integrations/supabase/cron-auth";

export const Route = createFileRoute("/api/public/whatsapp-campaign-dispatch")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const authError = await authenticateCronRequest(request);
        if (authError) return authError;

        const lovableApiKey = process.env["LOVABLE_API_KEY"];
        if (!lovableApiKey) return Response.json({ error: "Lovable AI não está configurada" }, { status: 401 });
        const [{ supabaseAdmin }, { dispatchCampaignBatch }] = await Promise.all([
          import("@/integrations/supabase/client.server"),
          import("@/lib/whatsapp-campaigns.server"),
        ]);
        try {
          return Response.json({ ok: true, ...(await dispatchCampaignBatch(supabaseAdmin, lovableApiKey)) });
        } catch (error) {
          console.error("[whatsapp-campaign-dispatch]", error);
          return Response.json({ error: error instanceof Error ? error.message : "Falha ao processar campanhas" }, { status: 500 });
        }
      },
    },
  },
});