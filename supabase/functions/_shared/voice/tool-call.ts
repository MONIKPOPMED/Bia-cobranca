// Finds the voice_calls row behind an ElevenLabs server-tool request.
//
// 07/10 test: passar_para_equipe ran but found no call — the
// "{{system__conversation_id}}" string header most likely arrived
// un-substituted. Tools now get the id as a dynamic_variable-filled body
// field and a {variable_name} header (elevenlabs-agent-sync); as a last
// resort, the single call in progress right now.

const ACTIVE_STATUSES = ["queued", "ringing", "in_progress"];

function cleanId(v: unknown): string | null {
  const s = typeof v === "string" ? v.trim() : "";
  return s && !s.startsWith("{{") ? s : null;
}

export type ToolCallRow = {
  id: string;
  account_id: string;
  direction: string;
  from_number: string | null;
  to_number: string | null;
  // deno-lint-ignore no-explicit-any
  metadata: any;
};

export async function findToolCall(
  // deno-lint-ignore no-explicit-any
  admin: any,
  req: Request,
  body: { conversation_id?: unknown },
  tag: string,
): Promise<ToolCallRow | null> {
  const fromBody = cleanId(body?.conversation_id);
  const fromHeader = cleanId(req.headers.get("x-conversation-id"));
  const conversationId = fromBody ?? fromHeader;
  const cols = "id, account_id, direction, from_number, to_number, metadata";
  console.log(
    `[${tag}] conversation id body=${fromBody ?? "-"} header=${fromHeader ?? `raw:${(req.headers.get("x-conversation-id") ?? "").slice(0, 40)}`}`,
  );

  if (conversationId) {
    const { data } = await admin.from("voice_calls").select(cols).eq("source_id", conversationId).maybeSingle();
    if (data) return data;
    console.warn(`[${tag}] no voice_call with source_id=${conversationId}`);
  }

  // Last resort: exactly one call in progress, started in the last 20 min.
  const since = new Date(Date.now() - 20 * 60 * 1000).toISOString();
  const { data: active } = await admin
    .from("voice_calls")
    .select(cols)
    .in("status", ACTIVE_STATUSES)
    .not("source_id", "is", null)
    .gte("started_at", since)
    .limit(2);
  if (active?.length === 1) {
    console.warn(`[${tag}] using the only active call ${active[0].id}`);
    return active[0];
  }
  console.error(`[${tag}] could not identify the call (active=${active?.length ?? 0})`);
  return null;
}
