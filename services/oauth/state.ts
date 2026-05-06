import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * Signed OAuth state tokens.
 *
 * Per docs/rules/oauth-dispatcher.md (Resolved Decisions):
 *   - HMAC-SHA256 signed compact token carrying userId, provider, nonce,
 *     expiresAt, requestedScopes.
 *   - 15-minute TTL.
 *   - Format: `<base64url(JSON(payload))>.<base64url(hmac)>`
 *
 * For PKCE-requiring providers we will pair this with a server-side row keyed
 * by `nonce` in a future migration. For Slack default v2 (no PKCE), the signed
 * token alone is sufficient.
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

export function createState(input: {
  userId: string;
  provider: string;
  requestedScopes: readonly string[];
}): { token: string; payload: OAuthStatePayload } {
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
  return { token: `${data}.${sig}`, payload };
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
