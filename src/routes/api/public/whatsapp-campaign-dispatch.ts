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
        // Daily read of POPMED's Google Sheet → month's campaign (12h, Mon–Fri).
        let planilha: unknown;
        try {
          const { horaDeLerPlanilha, sincronizarPlanilha } = await import("@/lib/planilha-cobranca.server");
          if (await horaDeLerPlanilha(supabaseAdmin)) {
            planilha = await sincronizarPlanilha(supabaseAdmin);
            console.log("[planilha-cobranca]", JSON.stringify(planilha));
          }
        } catch (error) {
          console.error("[planilha-cobranca]", error);
          planilha = { ok: false, erro: error instanceof Error ? error.message : String(error) };
        }
        // Contato/Retorno columns back to the sheet + 2nd-contact calls (every tick, 8h–20h).
        let planilhaEscrita: unknown;
        try {
          const { atualizarPlanilha, horaDeEscreverPlanilha } = await import("@/lib/planilha-cobranca.server");
          if (horaDeEscreverPlanilha()) planilhaEscrita = await atualizarPlanilha(supabaseAdmin);
        } catch (error) {
          console.error("[planilha-escrita]", error);
          planilhaEscrita = { ok: false, erro: error instanceof Error ? error.message : String(error) };
        }
        try {
          return Response.json({ ok: true, ...(await dispatchCampaignBatch(supabaseAdmin, lovableApiKey)), ...(planilha ? { planilha } : {}), ...(planilhaEscrita ? { planilhaEscrita } : {}) });
        } catch (error) {
          console.error("[whatsapp-campaign-dispatch]", error);
          return Response.json({ error: error instanceof Error ? error.message : "Falha ao processar campanhas" }, { status: 500 });
        }
      },
    },
  },
});