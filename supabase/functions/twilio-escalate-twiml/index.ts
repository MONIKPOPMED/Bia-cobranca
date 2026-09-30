// TwiML served to Twilio after voice-escalate redirects the call.
// TwiML App POST: To=+15551234567 → <Dial> that number
// ?mode=transfer&to=+15551234567&caller_id=+15557654321 remains supported
// ?mode=voicemail                → <Say><Record>

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "*",
};

function xml(body: string) {
  return new Response(body, {
    status: 200,
    headers: { ...corsHeaders, "Content-Type": "text/xml; charset=utf-8" },
  });
}

function escapeXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const url = new URL(req.url);
  let postedTo = "";
  let postedCallerId = "";

  if (req.method === "POST") {
    const contentType = req.headers.get("content-type") ?? "";
    if (contentType.includes("application/x-www-form-urlencoded")) {
      const form = await req.formData();
      postedTo = String(form.get("To") ?? form.get("to") ?? "").trim();
      postedCallerId = String(form.get("caller_id") ?? "").trim();
    } else if (contentType.includes("application/json")) {
      const body = await req.json().catch(() => ({})) as Record<string, unknown>;
      postedTo = String(body.To ?? body.to ?? "").trim();
      postedCallerId = String(body.caller_id ?? "").trim();
    }
  }

  // The query string wins: when voice-escalate redirects a live call, Twilio
  // POSTs the call's own parameters, and its `To` is the CUSTOMER — using it
  // would "transfer" the customer to themselves.
  const queryTo = url.searchParams.get("to") ?? "";
  const to = queryTo || postedTo;
  const mode = url.searchParams.get("mode") ?? (to ? "transfer" : "voicemail");

  if (mode === "transfer") {
    // voice-escalate always sends caller_id; the fallback only serves the
    // TwiML App (browser dialer) path, as before.
    const callerId = url.searchParams.get("caller_id") || postedCallerId || "+5548996975445";
    if (!/^\+[1-9]\d{7,14}$/.test(to)) {
      return xml(`<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say language="pt-BR">Não foi possível completar a ligação porque o número de destino não foi informado.</Say>
  <Hangup/>
</Response>`);
    }
    return xml(`<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Dial${callerId ? ` callerId="${escapeXml(callerId)}"` : ""}>
    <Number>${escapeXml(to)}</Number>
  </Dial>
</Response>`);
  }

  // voicemail
  return xml(`<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say language="pt-BR">Deixe seu recado apos o sinal. Retornamos o contato em breve.</Say>
  <Record maxLength="120" playBeep="true"/>
  <Hangup/>
</Response>`);
});
