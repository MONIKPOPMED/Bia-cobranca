// Public webhook for inbound Twilio SMS/MMS.
// POST body is application/x-www-form-urlencoded with fields:
//   MessageSid, From, To, Body, NumMedia, MediaUrl0..N, MediaContentType0..N,
//   AccountSid, MessagingServiceSid, SmsStatus, FromCity/State/Country/Zip…
//
// Routes by To number, handles opt-out keywords (STOP/SAIR/CANCELAR) and
// creates/updates conversation+message rows before triggering auto-reply.

import { createClient, SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.74.0";
import {
  getPublicUrl,
  isWebhookVerificationDisabled,
  validateTwilioSignatureAny,
} from "../_shared/webhook-security.ts";
import { findSmsChannelByToNumber } from "../_shared/twilio/index.ts";
import { resolveWebhookAuthTokens } from "../_shared/twilio/config.ts";
import { classifyOptKeyword } from "../_shared/twilio/sms.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "*",
};

const TWIML_EMPTY = `<?xml version="1.0" encoding="UTF-8"?><Response></Response>`;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return xml(405, `<?xml version="1.0"?><Response/>`);

  try {
    const formData = await req.formData();

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const admin = createClient(supabaseUrl, serviceKey);

    if (!isWebhookVerificationDisabled()) {
      const ok = await validateTwilioSignatureAny({
        urls: [getPublicUrl(req), `${supabaseUrl.replace(/\/$/, "")}/functions/v1/twilio-sms-incoming`],
        authTokens: await resolveWebhookAuthTokens(admin, formData),
        form: formData,
        signature: req.headers.get("x-twilio-signature"),
      });
      if (!ok) return xml(403, `<?xml version="1.0"?><Response/>`);
    }

    const messageSid = formData.get("MessageSid")?.toString() ?? "";
    const from = formData.get("From")?.toString() ?? "";
    const to = formData.get("To")?.toString() ?? "";
    const body = formData.get("Body")?.toString() ?? "";
    const numMedia = parseInt(formData.get("NumMedia")?.toString() ?? "0", 10);

    if (!messageSid || !from || !to) return xml(200, TWIML_EMPTY);

    const channel = await findSmsChannelByToNumber(admin, to);
    if (!channel) {
      console.warn("[twilio-sms-incoming] no channel for To", to);
      return xml(200, TWIML_EMPTY);
    }

    // Opt-out handling BEFORE processing the message so we also log the STOP
    // as a normal inbound message but flip the flag immediately.
    const optKind = classifyOptKeyword(body);
    if (optKind === "opt_out") {
      await admin
        .from("sms_opt_outs")
        .upsert(
          {
            account_id: channel.account_id,
            phone_number: from,
            reason: body.slice(0, 140),
            opted_out_at: new Date().toISOString(),
            opted_back_in_at: null,
          },
          { onConflict: "account_id,phone_number" },
        );
    } else if (optKind === "opt_in") {
      await admin
        .from("sms_opt_outs")
        .update({ opted_back_in_at: new Date().toISOString() })
        .eq("account_id", channel.account_id)
        .eq("phone_number", from);
    }

    const mediaUrls: string[] = [];
    for (let i = 0; i < numMedia; i++) {
      const u = formData.get(`MediaUrl${i}`)?.toString();
      if (u) mediaUrls.push(u);
    }

    await handleSms(admin, {
      channel,
      from,
      to,
      body,
      messageSid,
      mediaUrls,
      profileName: formData.get("ProfileName")?.toString() ?? null,
    });

    return xml(200, TWIML_EMPTY);
  } catch (err) {
    console.error("[twilio-sms-incoming] failed", err);
    return xml(200, TWIML_EMPTY);
  }
});

async function handleSms(
  admin: SupabaseClient,
  args: {
    channel: { id: string; account_id: string; config: any };
    from: string;
    to: string;
    body: string;
    messageSid: string;
    mediaUrls: string[];
    profileName: string | null;
  },
) {
  const { channel, from, body, messageSid, mediaUrls, profileName } = args;
  const accountId = channel.account_id;

  // Inbox auto-provision
  let { data: inbox } = await admin
    .from("inboxes")
    .select("id")
    .eq("channel_id", channel.id)
    .maybeSingle();
  if (!inbox) {
    const { data: created } = await admin
      .from("inboxes")
      .insert({
        account_id: accountId,
        channel_id: channel.id,
        channel_type: "sms",
        name: "SMS",
      })
      .select("id")
      .single();
    inbox = created!;
  }

  // Contact by E.164 phone
  let { data: contact } = await admin
    .from("contacts")
    .select("id")
    .eq("account_id", accountId)
    .eq("phone_number", from)
    .maybeSingle();
  if (!contact) {
    const { data: created } = await admin
      .from("contacts")
      .insert({
        account_id: accountId,
        phone_number: from,
        name: profileName ?? from,
        identifier: `sms:${from}`,
      })
      .select("id")
      .single();
    contact = created!;
  }

  await admin.from("contact_inboxes").upsert(
    { contact_id: contact.id, inbox_id: inbox.id, source_id: `sms:${from}` },
    { onConflict: "contact_id,inbox_id", ignoreDuplicates: true },
  );

  // Open conversation
  let { data: conversation } = await admin
    .from("conversations")
    .select("id")
    .eq("account_id", accountId)
    .eq("contact_id", contact.id)
    .eq("inbox_id", inbox.id)
    .eq("status", 0)
    .order("last_activity_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!conversation) {
    const { data: created } = await admin
      .from("conversations")
      .insert({
        account_id: accountId,
        contact_id: contact.id,
        inbox_id: inbox.id,
        status: 0,
      })
      .select("id")
      .single();
    conversation = created!;
  }

  const contentType = mediaUrls.length > 0 ? 1 : 0;
  const contentAttributes: Record<string, any> = {
    kind: mediaUrls.length > 0 ? "image" : "text",
    media_urls: mediaUrls.length ? mediaUrls : undefined,
  };

  const content = body || (mediaUrls.length > 0 ? "[mms]" : "");

  const { data: inserted, error: insErr } = await admin
    .from("messages")
    .upsert(
      {
        account_id: accountId,
        conversation_id: conversation.id,
        inbox_id: inbox.id,
        content,
        content_type: contentType,
        content_attributes: contentAttributes,
        message_type: 0,
        private: false,
        sender_type: "Contact",
        sender_id: contact.id,
        source_id: messageSid,
        external_source_ids: { twilio_message_sid: messageSid },
      },
      { onConflict: "account_id,source_id", ignoreDuplicates: true },
    )
    .select("id")
    .single();
  if (insErr && !/duplicate/i.test(insErr.message)) throw insErr;

  await admin
    .from("conversations")
    .update({ last_activity_at: new Date().toISOString() })
    .eq("id", conversation.id);

  // Optional auto-reply hook. The function may not exist in this project yet
  // (it was originally part of the SAC stack). We attempt the invoke and
  // swallow any error so SMS ingestion is unaffected.
  try {
    await admin.functions.invoke("persona-auto-reply", {
      body: {
        accountId,
        conversationId: conversation.id,
        inboxId: inbox.id,
        triggeringMessageId: inserted?.id,
      },
    });
  } catch (err) {
    console.warn("[twilio-sms-incoming] auto-reply invoke failed (non-fatal)", err);
  }
}

function xml(status: number, body: string) {
  return new Response(body, {
    status,
    headers: { ...corsHeaders, "Content-Type": "text/xml; charset=utf-8" },
  });
}
