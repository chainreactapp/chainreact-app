import { timingSafeEqual } from "node:crypto";

/**
 * Cron auth helper.
 *
 * Slice 2e port from V1 `lib/utils/cron-auth.ts` — adapted for V2 boundaries:
 *   - Single env var (`CRON_SECRET`) instead of V1's three-secret combinatorial
 *     (V1 also accepted ADMIN_SECRET / ADMIN_API_KEY for human-driven admin
 *     calls — those are out of scope here).
 *   - Bearer-only. V1 also accepted `x-admin-key` header and `?secret=` query
 *     param; both were V1 admin tooling and not used by Vercel cron.
 *   - `crypto.timingSafeEqual` instead of `===`. V1's string compare is
 *     vulnerable to timing analysis; the fix is cheap so we ship it on port.
 *
 * Vercel cron sends the secret as `Authorization: Bearer <CRON_SECRET>`.
 * Manual invocations (curl, smoke tests) use the same header shape.
 */

export interface CronAuthOk {
  authorized: true;
}

export interface CronAuthError {
  authorized: false;
  status: 401 | 500;
  message: string;
}

export type CronAuthResult = CronAuthOk | CronAuthError;

/**
 * Validate `Authorization: Bearer <CRON_SECRET>` on an incoming Request.
 *
 * Returns a discriminated union so route handlers can map cleanly to a
 * NextResponse without this helper depending on Next types.
 *
 * Misconfiguration (no `CRON_SECRET` env) is a server error, not 401 — the
 * deploy is broken; do not silently allow access.
 */
export function requireCronAuth(request: Request): CronAuthResult {
  const expected = process.env.CRON_SECRET;
  if (!expected) {
    return {
      authorized: false,
      status: 500,
      message: "Server misconfiguration: CRON_SECRET is not set.",
    };
  }

  const header = request.headers.get("authorization");
  if (!header) {
    return { authorized: false, status: 401, message: "Unauthorized" };
  }

  const match = header.match(/^Bearer\s+(.+)$/i);
  const provided = match?.[1];
  if (!provided) {
    return { authorized: false, status: 401, message: "Unauthorized" };
  }

  if (!constantTimeEquals(provided, expected)) {
    return { authorized: false, status: 401, message: "Unauthorized" };
  }

  return { authorized: true };
}

function constantTimeEquals(a: string, b: string): boolean {
  // timingSafeEqual requires equal-length buffers; pad shorter to longer to
  // avoid leaking length via early-return. We still compare the original
  // lengths at the end so length mismatches still fail.
  const aBuf = Buffer.from(a, "utf8");
  const bBuf = Buffer.from(b, "utf8");
  const max = Math.max(aBuf.length, bBuf.length);
  const aPad = Buffer.alloc(max);
  const bPad = Buffer.alloc(max);
  aBuf.copy(aPad);
  bBuf.copy(bPad);
  return timingSafeEqual(aPad, bPad) && aBuf.length === bBuf.length;
}
