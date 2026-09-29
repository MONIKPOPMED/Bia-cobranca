import { createStart } from "@tanstack/react-start";
import { attachSupabaseAuth } from "./integrations/supabase/auth-attacher";

// Global serverFn middleware: attaches the user's Supabase bearer token to
// every serverFn RPC from the browser. Without it, serverFns guarded by
// requireSupabaseAuth (e.g. createWhatsAppCampaign) fail with
// "Unauthorized: No authorization header provided".
export const startInstance = createStart(() => ({
  functionMiddleware: [attachSupabaseAuth],
}));
