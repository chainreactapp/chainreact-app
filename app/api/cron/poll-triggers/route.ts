import { NextResponse } from "next/server";
import { requireCronAuth } from "@/services/cron/auth";
import { runPollingTriggers } from "@/services/cron/runPollingTriggers";
// Side-effect import: forces handler/activation registrations at module
// load. The registry pattern (services/triggers/pollingRegistry.ts) is
// only populated when each provider's polling module is imported once.
import "@/integrations/_registry";

/**
 * Cron entrypoint for polling triggers.
 *
 * Vercel cron sends GET; manual / external invocations use POST. Both
 * delegate to the same handler — V1 supported both shapes and there's no
 * reason to break parity.
 *
 * Slice 2e: no `vercel.json` cron entry yet (V2 has no production cron
 * deploy wiring). To exercise this route in dev:
 *   curl -X POST -H "Authorization: Bearer $CRON_SECRET" \
 *        http://localhost:3000/api/cron/poll-triggers
 *
 * Production schedule wiring (every minute) lands as a separate ops PR
 * once V2's cron deploy convention is set.
 */

async function handle(request: Request): Promise<Response> {
  const auth = requireCronAuth(request);
  if (!auth.authorized) {
    return NextResponse.json(
      { error: auth.message },
      { status: auth.status },
    );
  }

  try {
    const result = await runPollingTriggers();
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    // Don't surface internals — log structured + return generic 500.
    console.error(
      JSON.stringify({
        event: "cron.poll_triggers.fatal",
        message: (err as Error).message,
      }),
    );
    return NextResponse.json(
      { error: "Polling cron failed." },
      { status: 500 },
    );
  }
}

export async function GET(request: Request): Promise<Response> {
  return handle(request);
}

export async function POST(request: Request): Promise<Response> {
  return handle(request);
}
