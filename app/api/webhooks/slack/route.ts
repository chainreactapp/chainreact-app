import { NextResponse } from "next/server";
import { InvalidSignatureError } from "@/core/triggers/errors";
import { receiveSlackWebhook } from "@/integrations/slack/webhooks/receive";
import { dispatchTriggerEvent } from "@/services/triggers/dispatch";

/**
 * POST /api/webhooks/slack
 *
 * Per docs/rules/webhook-receipt-routes.md §"V2 intended behavior":
 *   - Thin (~30 lines).
 *   - Verification + parsing live in receive.ts.
 *   - Dispatch happens through services/triggers/dispatch.ts.
 *   - Returns 200 once events are durably enqueued; 5xx if the queue
 *     write fails so Slack retries.
 *   - Logs shape (event count, dedup outcome) at info; never the full body.
 */
export async function POST(request: Request) {
  let result: Awaited<ReturnType<typeof receiveSlackWebhook>>;
  try {
    result = await receiveSlackWebhook(request);
  } catch (err) {
    if (err instanceof InvalidSignatureError) {
      return NextResponse.json(
        { error: "invalid signature" },
        { status: 401 },
      );
    }
    console.error(
      JSON.stringify({
        event: "webhook.slack.receive_error",
        error: (err as Error).message,
      }),
    );
    return NextResponse.json(
      { error: "Webhook receive failed." },
      { status: 500 },
    );
  }

  if (result.kind === "challenge") {
    // Slack URL verification handshake. Echo the challenge string.
    return new NextResponse(result.challenge, {
      status: 200,
      headers: { "content-type": "text/plain" },
    });
  }

  // Event(s) — dispatch each. Failures here return 5xx so Slack retries.
  try {
    for (const event of result.events) {
      await dispatchTriggerEvent(event);
    }
  } catch (err) {
    console.error(
      JSON.stringify({
        event: "webhook.slack.dispatch_error",
        error: (err as Error).message,
        eventCount: result.events.length,
      }),
    );
    return NextResponse.json(
      { error: "Dispatch failed." },
      { status: 500 },
    );
  }

  return NextResponse.json({ ok: true, dispatched: result.events.length });
}
