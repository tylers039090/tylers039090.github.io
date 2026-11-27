import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { runPoll } from "@/lib/live";

export const maxDuration = 30;

/**
 * Score poller, called every 30 s by Supabase pg_cron (supabase/setup/poller-cron.sql).
 * Authorization: Bearer $CRON_SECRET. Add ?force=1 to skip the idle wait.
 */
async function handle(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const admin = createAdminClient();
  if (!admin) return NextResponse.json({ error: "SUPABASE_SERVICE_ROLE_KEY not set" }, { status: 500 });

  try {
    const result = await runPoll(admin, { force: req.nextUrl.searchParams.get("force") === "1" });
    return NextResponse.json(result);
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "poll failed" }, { status: 500 });
  }
}

export const GET = handle;
export const POST = handle;
