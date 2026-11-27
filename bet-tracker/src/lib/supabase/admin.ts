import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { SUPABASE_URL } from "./env";

export type Admin = SupabaseClient;

/**
 * Service-role client: bypasses row-level security. Server only — used to write
 * the games table (the poller and save-time linking). Null when the key isn't set.
 */
export function createAdminClient(): Admin | null {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!SUPABASE_URL || !key) return null;
  return createClient(SUPABASE_URL, key, { auth: { persistSession: false, autoRefreshToken: false } });
}
