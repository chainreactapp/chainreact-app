/**
 * Minimal Slack chat.postMessage client.
 *
 * Per docs/rules/project-structure-and-module-boundaries.md: provider HTTP
 * helpers live next to the handler that uses them
 * (`integrations/<p>/api/`), not in a global `lib/` folder.
 *
 * Slack returns 200 even on logical errors with `{ ok: false, error: "..." }`
 * — we surface that as an exception with the Slack error code, which the
 * engine maps to a HANDLER_FAILED step.
 */

/**
 * Base URL is env-overridable for e2e testing only. Production leaves
 * SLACK_API_BASE unset; defaults to real Slack. Override is opt-in via env
 * and lives at the network boundary — handler logic, schema validation,
 * token decryption all run unchanged regardless.
 */
function endpoint(): string {
  const base = process.env.SLACK_API_BASE ?? "https://slack.com";
  return `${base}/api/chat.postMessage`;
}

export interface ChatPostMessageInput {
  /** Slack bot OAuth token (xoxb-…). */
  botToken: string;
  /** Channel id (`C…`), DM id (`D…`), or `#name`. */
  channel: string;
  /** Message text. Slack supports up to 40k chars; we don't truncate. */
  text: string;
}

export interface ChatPostMessageResult {
  /** Slack message timestamp ("1730000000.000123") — the message id. */
  ts: string;
  /** Resolved channel id Slack picked when caller used a name. */
  channel: string;
  /** Bot's posted message — Slack returns the resolved server-side payload. */
  message: Readonly<Record<string, unknown>>;
}

export class SlackApiError extends Error {
  readonly slackErrorCode: string;
  constructor(slackErrorCode: string) {
    super(`Slack chat.postMessage failed: ${slackErrorCode}`);
    this.name = "SlackApiError";
    this.slackErrorCode = slackErrorCode;
  }
}

interface SlackResponseBody {
  ok: boolean;
  error?: string;
  ts?: string;
  channel?: string;
  message?: Record<string, unknown>;
}

export async function chatPostMessage(
  input: ChatPostMessageInput,
): Promise<ChatPostMessageResult> {
  const response = await fetch(endpoint(), {
    method: "POST",
    headers: {
      authorization: `Bearer ${input.botToken}`,
      "content-type": "application/json; charset=utf-8",
    },
    body: JSON.stringify({ channel: input.channel, text: input.text }),
  });

  // Slack uses 200 for both success and most logical errors. A non-2xx is
  // typically a token or scope problem (or rate limit) — treat as transport
  // failure with the HTTP status as the error code so the engine sees a
  // distinct shape from logical errors.
  if (!response.ok) {
    throw new SlackApiError(`http_${response.status}`);
  }

  const body = (await response.json()) as SlackResponseBody;
  if (!body.ok) {
    throw new SlackApiError(body.error ?? "unknown_error");
  }
  if (!body.ts || !body.channel || !body.message) {
    // Defense-in-depth — Slack contract violation.
    throw new SlackApiError("malformed_response");
  }
  return {
    ts: body.ts,
    channel: body.channel,
    message: body.message,
  };
}
