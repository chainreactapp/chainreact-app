/**
 * Narrow auth barrel — exposes the cached-token helpers ONLY.
 *
 * Do not turn this into a dumping ground. SessionManager,
 * authBootMachine, and the auth store stay imported directly from
 * their own modules.
 *
 * Either of these import paths works:
 *
 *   import { getAuthHeader } from "@/lib/auth"            // via this barrel
 *   import { getAuthHeader } from "@/lib/auth/getAuthHeader" // direct
 *
 * Existing call sites use the direct form (the barrel was previously
 * shadowed by a legacy `lib/auth.ts` file that PR-AUTH-6 deleted).
 * New call sites can use either; prefer the direct form for explicitness.
 */

export {
  getAuthHeader,
  getCachedAccessToken,
  type CachedAccessToken,
  type GetAuthHeaderOptions,
} from "./getAuthHeader"
