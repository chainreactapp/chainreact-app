/**
 * Webhook receipt + dispatch errors.
 *
 * Per docs/rules/webhook-receipt-routes.md §"Edge cases":
 *   - Signature verification failure → receive.ts throws
 *     InvalidSignatureError → route returns 401.
 *   - Replay-window violation → SignatureExpiredError (subclass) → 401.
 *
 * Keeping these in core/ rather than the route layer means future providers
 * (Microsoft Graph, GitHub, Stripe) reuse the same error types and the
 * route shell doesn't need provider-specific catch blocks.
 */

export class InvalidSignatureError extends Error {
  constructor(message: string = "Webhook signature verification failed.") {
    super(message);
    this.name = "InvalidSignatureError";
  }
}

export class SignatureExpiredError extends InvalidSignatureError {
  constructor(message: string = "Webhook signature timestamp is outside the allowed replay window.") {
    super(message);
    this.name = "SignatureExpiredError";
  }
}
