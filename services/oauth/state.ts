import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import * as oauthStatesRepo from "@/repositories/oauthStates";

/**
 * Signed OAuth state tokens + DB-backed nonce table.
 *
 * Per docs/rules/oauth-dispatcher.md (Resolved Decisions):
 *   - HMAC-SHA256 signed compact token carrying userId, provider, nonce,
 *     expiresAt, requestedScopes.
 *   - 15-minute TTL.
 *   - Format: `<base64url(JSON(payload))>.<base64url(hmac)>`
 *   - "Signed short-lived state token + DB row keyed by nonce for PKCE/temp
 *     metadata. 15-min expiry. Row deleted after callback."
 *
 * Two layers, two purposes:
 *
 * 1. The signed JWT proves a state value originated server-side, carries the
 *    userId/provider/scopes that the dispatcher reads at callback time, and
 *    is what the OAuth provider sees + bounces back. `verifyState` is the
 *    pure (sync, no I/O) check for signature + expiry — useful in tests and
 *    anywhere that needs to inspect a token without consuming it.
 *
 * 2. The `oauth_states` row is what makes state one-time-use. Without it,
 *    an attacker who intercepts a state token (browser history leak, log
 *    slurp, malicious extension) within the 15-min window could replay it
 *    with their own provider OAuth code and have an integration row inserted
 *    against the victim's user_id. `consumeState` does the JWT check AND the
 *    atomic DB consume; the dispatcher uses this in the callback path.
 *
 * Provider-agnostic: `createState` accepts optional PKCE metadata that goes
 * into the DB row only (never into the JWT — the verifier is the secret half).
 * Slack default v2 doesn't pass any; Gmail / Google / Notion will.
 */

const STATE_TTL_SECONDS = 15 * 60;

export interface OAuthStatePayload {
  userId: string;
  provider: string;
  nonce: string;
  expiresAt: number;
  requestedScopes: readonly string[];
}

export class InvalidStateError extends Error {
  constructor(reason: string) {
    super(`OAuth state validation failed: ${reason}`);
    this.name = "InvalidStateError";
  }
}

function getKey(): Buffer {
  const raw = process.env.OAUTH_STATE_SIGNING_KEY;
  if (!raw) throw new Error("OAUTH_STATE_SIGNING_KEY env var is not set.");
  const buf = Buffer.from(raw, "base64");
  if (buf.length < 16) {
    throw new Error("OAUTH_STATE_SIGNING_KEY must decode to at least 16 bytes.");
  }
  return buf;
}

function nowSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

export interface CreateStateInput {
  userId: string;
  provider: string;
  requestedScopes: readonly string[];
  /**
   * Optional PKCE metadata. Stored on the DB row only; NEVER serialized into
   * the signed JWT (the verifier is the secret half — putting it in the JWT
   * would be sent to the provider and defeat PKCE). Slack default v2 omits
   * this.
   */
  pkce?: {
    codeVerifier: string;
    codeChallengeMethod: string;
  };
}

export async function createState(
  input: CreateStateInput,
): Promise<{ token: string; payload: OAuthStatePayload }> {
  if (!input.userId) throw new Error("createState: userId is required.");
  if (!input.provider) throw new Error("createState: provider is required.");

  const payload: OAuthStatePayload = {
    userId: input.userId,
    provider: input.provider,
    nonce: randomBytes(16).toString("base64url"),
    expiresAt: nowSeconds() + STATE_TTL_SECONDS,
    requestedScopes: [...input.requestedScopes],
  };

  const data = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const sig = createHmac("sha256", getKey()).update(data).digest("base64url");
  const token = `${data}.${sig}`;

  await oauthStatesRepo.create({
    nonce: payload.nonce,
    userId: payload.userId,
    provider: payload.provider,
    expiresAt: new Date(payload.expiresAt * 1000).toISOString(),
    ...(input.pkce !== undefined
      ? {
          pkceCodeVerifier: input.pkce.codeVerifier,
          pkceCodeChallengeMethod: input.pkce.codeChallengeMethod,
        }
      : {}),
  });

  return { token, payload };
}

export function verifyState(token: string): OAuthStatePayload {
  if (typeof token !== "string" || !token.includes(".")) {
    throw new InvalidStateError("malformed token");
  }
  const dotIdx = token.indexOf(".");
  const data = token.slice(0, dotIdx);
  const sig = token.slice(dotIdx + 1);
  if (!data || !sig) throw new InvalidStateError("malformed token");

  const expectedSig = createHmac("sha256", getKey()).update(data).digest();
  let actualSig: Buffer;
  try {
    actualSig = Buffer.from(sig, "base64url");
  } catch {
    throw new InvalidStateError("malformed signature");
  }
  if (
    expectedSig.length !== actualSig.length ||
    !timingSafeEqual(expectedSig, actualSig)
  ) {
    throw new InvalidStateError("signature mismatch");
  }

  let payload: OAuthStatePayload;
  try {
    payload = JSON.parse(Buffer.from(data, "base64url").toString("utf8")) as OAuthStatePayload;
  } catch {
    throw new InvalidStateError("malformed payload");
  }

  if (typeof payload.expiresAt !== "number" || payload.expiresAt < nowSeconds()) {
    throw new InvalidStateError("expired");
  }
  if (!payload.userId || !payload.provider || !payload.nonce) {
    throw new InvalidStateError("missing required fields");
  }
  return payload;
}

/**
 * The dispatcher's callback path uses this. It does verifyState (signature +
 * expiry) AND atomically consumes the DB row in one step. A second call with
 * the same token throws InvalidStateError("already consumed or expired") —
 * that's the replay protection that the JWT alone cannot provide.
 *
 * Order matters: signature verification first (cheap, rejects forged tokens
 * without touching the DB); DB consume second. The atomic delete-if-fresh
 * makes concurrent consumes race-safe — only one wins, the other rejects.
 */
export async function consumeState(token: string): Promise<OAuthStatePayload> {
  const payload = verifyState(token);
  const row = await oauthStatesRepo.consumeByNonce(payload.nonce);
  if (!row) {
    throw new InvalidStateError("already consumed or expired");
  }
  if (row.userId !== payload.userId || row.provider !== payload.provider) {
    // The JWT and DB row disagree on who/what this state was for. Something
    // upstream is broken (key rotation mid-flow, DB tampering, …). Fail safe.
    throw new InvalidStateError("state row mismatch");
  }
  return payload;
}
