# Rule: Webhook Receipt Routes

## Purpose

Define how V2 receives, verifies, normalizes, and dispatches incoming webhook events from integration providers. Replace V1's monolithic per-provider routes with a thin route → integration receive → normalize → trigger manager pattern.

## Resolved Decisions

**Locked for Slice 1:**
- Each provider has thin modules at `integrations/<provider>/webhooks/receive.ts` (verify + parse, returns normalized events) and `integrations/<provider>/webhooks/normalize.ts` (pure transformation).
- Thin route at `app/api/webhooks/<provider>/route.ts` (~30 lines) calls receive → for each event → normalize → dispatch.
- **Two normalized event contracts (decided):**
  - **Trigger webhooks** normalize to `contracts/triggerEvent.ts`. These feed `core/triggers/dispatch.ts` and enqueue workflow runs.
  - **Billing / system webhooks (Stripe, etc.)** normalize to `contracts/billingEvent.ts` (or `contracts/providerEvent.ts` for non-billing system events that aren't workflow triggers). These feed billing services or other system orchestrators, NOT the trigger dispatcher.
  - The route → receive → normalize **pattern** is shared. The downstream **contract** and **dispatcher target** differ when the event is not a workflow trigger.
- Trigger dispatcher in `core/triggers/dispatch.ts` is provider-agnostic and reads canonical `triggerEvent.ts` events. Provider-specific quirks end at `normalize.ts`.
- Idempotency dedup via Postgres table `webhook_event_dedup` keyed by `(provider, event_id)`, daily cleanup cron. Defer Redis migration.
- Dedup outage policy: **fail-open** — dispatch and rely on Q4 session-side-effects idempotency further down the chain to prevent duplicate side effects.
- Provider event-id field declared in the manifest. Where no stable id exists, manifest declares a deterministic-hash strategy.
- Async dispatch only: webhook routes enqueue and return; execution runs asynchronously.
- **Disabled / paused workflows:** dispatcher MUST guard and silently drop events even when provider-side registration lags. (Shared invariant with workflow-lifecycle rule.)
- Subscription renewal (Microsoft Graph 4-day expiry, etc.) lives in the trigger lifecycle layer, not in the receipt route.
- Webhook URL format: simplest `/api/webhooks/<provider>`, with disambiguation in `receive.parse` from payload fields.
- `receive` takes the whole `Request`; per-provider verification accesses whatever headers it needs.

**Deferred decisions:**
- Replay-for-debugging admin endpoint. Build later, behind admin step-up auth.
- Streaming JSON parse for very large notification arrays (Microsoft). Default `JSON.parse` for Slice 1.
- Migration from Postgres to Redis dedup if latency becomes a bottleneck.

**Decisions requiring product-owner input:**
- None for Slice 1.

## Current V1 problem being solved

V1's webhook routes are large, mixed-concern monoliths:

- `app/api/webhooks/microsoft/route.ts` — **2,475 lines**.
- `lib/webhooks/google-processor.ts` — **3,101 lines**.
- `lib/webhooks/triggerWebhookManager.ts` — **2,847 lines** for registration / renewal / lifecycle.
- `app/api/webhooks/stripe-billing/route.ts` — 947 lines.
- `app/api/webhooks/discord/hitl/route.ts` — 793 lines.

Each route file mixes: signature verification, payload parsing, event normalization, trigger lookup, idempotency dedup, and execution dispatch. Adding a new provider, or changing one provider's verification scheme, requires reading thousands of lines and risks unrelated providers.

V1 also has webhook receipt fragmented across both `app/api/webhooks/` and `lib/webhooks/`. The split is functional but unclear — the route file usually does its own work plus delegating to a processor in `lib/webhooks/`, with no consistent boundary.

## V2 intended behavior

Each provider has two thin, single-purpose modules under its integration folder:

```
integrations/<provider>/webhooks/
├── receive.ts      # verify signature, parse payload, return normalized events
└── normalize.ts    # pure transformation: provider event → canonical workflow trigger event
```

Plus a thin route at `app/api/webhooks/<provider>/route.ts` (~30 lines):

```
POST /api/webhooks/<provider>
  → integrations/<provider>/webhooks/receive.ts
  → for each normalized event:
      → core/triggers/dispatch.ts  (find matching active workflows, enqueue runs)
```

The dispatcher in `core/triggers/dispatch.ts` is provider-agnostic. It receives a canonical event, queries `trigger_resources` for active workflows whose triggers match the event's provider + type + filters, and enqueues runs through the execution service.

## Single source of truth

- Per-provider receive: `integrations/<provider>/webhooks/receive.ts` — owns signature verification, payload parsing, batch unwrapping.
- Per-provider normalize: `integrations/<provider>/webhooks/normalize.ts` — owns the provider-specific → canonical mapping. **Pure function**, no I/O.
- Canonical event shapes (two contracts, by purpose):
  - `contracts/triggerEvent.ts` — Zod schema for workflow trigger events (`provider`, `eventType`, `eventId`, `occurredAt`, `payload`, `accountId`). Consumed by the trigger dispatcher.
  - `contracts/billingEvent.ts` — Zod schema for billing/system webhooks (Stripe). Consumed by billing services. Distinct from triggerEvent because the routing target differs.
  - Future-room: `contracts/providerEvent.ts` for non-billing system events (e.g. provider connection-changed signals from a webhook). Slice 1 ships only the first two.
- Trigger dispatch: `core/triggers/dispatch.ts` — looks up active workflows, deduplicates, enqueues runs.
- Idempotency dedup: a Postgres table `webhook_event_dedup` keyed by `(provider, eventId)` with TTL (or a Redis equivalent if added). The dedup field per provider is declared in the manifest.

## Allowed flows

- **Standard event POST:** Provider → route → `receive.verify(req)` → `receive.parse(req)` returns one or more raw events → for each: `normalize(rawEvent)` → dispatcher → execution queue. Route returns `200 OK` once all events are dispatched (or queued for dispatch).
- **Verification handshake (URL challenge):** Slack URL verification, Microsoft Graph validation token, Notion verification token. Route handles `GET` or `POST` with `type: 'url_verification'` → `receive.handleChallenge(req)` returns the challenge response. No dispatch.
- **Batch events:** A single POST contains an array (Slack batch, Microsoft Graph notification array). `receive.parse(req)` returns an array; each is normalized + dispatched independently.
- **Idempotency dedup:** Before dispatch, the dispatcher checks `webhook_event_dedup` for `(provider, eventId)`. Hit → drop silently with debug log. Miss → record and continue.
- **Replay (debug):** A debug-only admin endpoint can re-dispatch a stored normalized event by id. Production routes never replay.

## Disallowed behavior

- Verification logic inline in the route file. Always in `receive.ts`.
- Normalization logic mixed with HTTP handling. Always in `normalize.ts`, pure.
- Trigger lookup inside the webhook route or in `receive.ts`. Always in `core/triggers/dispatch.ts`.
- Provider-specific quirks leaking into the dispatcher. The dispatcher reads the canonical event; provider differences end at `normalize.ts`.
- Synchronous execution from inside the webhook handler. Webhook routes enqueue and return; execution runs asynchronously.
- Dropping verification because "the request is signed by Cloudflare" or any other shortcut. Verify the provider's signature against the provider's secret. Always.
- Logging the full request body at info level. Bodies may contain user data. Log shapes (event type, count) at info; full bodies at debug, with PII scrubbing.
- Returning 200 before the event is durably enqueued. If the queue write fails, return 5xx so the provider retries.
- Calling `repositories/...` directly from the route. Always go through dispatcher → execution service.

## Edge cases

- **Slack URL verification:** initial subscription verification responds with the `challenge` token from the request body. `receive.ts` recognizes `type: 'url_verification'` and short-circuits.
- **Microsoft Graph subscription validation:** Microsoft sends a `GET` (or sometimes `POST` with a validation token) when creating a subscription; the route echoes the token back as `text/plain`. `receive.ts` handles this.
- **Signature verification failure:** `receive.ts` throws `InvalidSignatureError`. Route returns `401`. Do not log the signature itself.
- **Batch events with mixed validity:** if one event in a batch fails normalization, the dispatcher logs the failure and continues with the others. The route still returns `200` (the provider considers the delivery successful; bad events are our problem to log and resolve).
- **Out-of-order delivery / retries:** providers retry on 5xx. Idempotency dedup catches retries. Out-of-order events: each event normalizes independently; ordering across events is not guaranteed by webhooks (V1 already accepts this).
- **Webhook for unregistered or deleted workflow:** dispatcher silently drops with a debug log. This is normal — webhooks may take time to deregister after workflow deletion.
- **Webhook for a workflow in `paused` or `disabled` state:** dispatcher drops without execution. The trigger registration may still exist on the provider side; pausing/disabling does not always immediately deregister webhooks (per the lifecycle rule).
- **Provider quotas / queue saturation:** if the internal execution queue is saturated, the route returns `429` so the provider retries with backoff. Engine concerns about queue capacity surface here.
- **Event for an integration with revoked token:** the event arrives but the action call later fails with 401. Q3 handles that — normalization and dispatch are upstream of the handler, so they don't pre-check token validity. Health engine catches the resulting failure.
- **Subscription expiry (Microsoft Graph: 4 days, others vary):** webhook subscriptions need renewal. Renewal lives in the trigger lifecycle's `renew` cron, not in the receipt route. The route does not know subscriptions expire.
- **Replay attack window:** signature verification includes a timestamp tolerance (typically ±5 minutes). Reject events outside the window.
- **Long payloads:** providers like Microsoft can send large notification arrays. `receive.parse` must stream-parse if size warrants it (defer to provider need; default `JSON.parse` is fine for slice 1).

## Required tests

Unit tests in `tests/unit/integrations/<p>/webhooks/`:

1. `receive.verify` accepts valid signatures.
2. `receive.verify` rejects forged signatures with `InvalidSignatureError`.
3. `receive.verify` rejects timestamps outside the tolerance window.
4. `receive.parse` returns a single event for a single-event POST.
5. `receive.parse` returns N events for a batch POST.
6. `receive.parse` handles verification-handshake POSTs cleanly (returns the handshake marker).
7. `normalize` converts provider event to canonical shape (table-driven across event types).
8. `normalize` validates output against the correct event contract for the provider:
   - Trigger webhooks validate against `contracts/triggerEvent.ts`.
   - Stripe / billing webhooks validate against `contracts/billingEvent.ts`.
   - Future non-billing system webhooks validate against `contracts/providerEvent.ts` if introduced.
9. `normalize` is pure: same input → same output, no side effects.

Unit tests in `tests/unit/core/triggers/dispatch.test.ts`:

10. Dispatcher matches event to active workflow with matching trigger config.
11. Dispatcher does not match disabled / paused / draft workflows.
12. Dispatcher dedups by `(provider, eventId)`.
13. Dispatcher handles dedup-table outage with the locked **fail-open** policy: dispatch proceeds, an `event-dedup-outage` log/metric is emitted, and Q4 session-side-effects idempotency is relied on downstream.
14. Dispatcher enqueues run via execution service; does not run synchronously.

Integration tests in `tests/integration/webhooks/<p>.test.ts`:

15. Full POST → receive → normalize → dispatch → run enqueued, with a real Supabase test schema.
16. Batch POST: each event creates a run.
17. Replay POST (same eventId): second is dropped via dedup.
18. Workflow not found: silent drop, route returns 200, no run created.
19. Verification handshake: route returns the challenge token without enqueueing anything.

## V1 behavior to preserve

- Provider-specific signature verification logic (V1 has the right verifications; they're just buried).
- Idempotency-key strategies per provider.
- Normalization shapes that downstream workflow trigger configs depend on. **Don't break workflow expectations.** Audit V1 normalized events before V2 cutover.
- Verification handshakes for every provider that requires them.
- Async dispatch (route returns 200 quickly; execution runs asynchronously).

## V1 behavior to drop

- Monolithic 2,000+ line route files.
- Verification + parsing + normalization + dispatch in a single function.
- Inline trigger lookup in webhook routes.
- Per-provider quirks leaking past the normalize boundary.
- `console.log` in webhook routes (use the structured logger).
- Inconsistent split between `app/api/webhooks/` and `lib/webhooks/` — V2 puts pure logic in `integrations/<p>/webhooks/`, the route is a 30-line shell.

## Open questions

(Dedup store choice, dedup outage policy, provider event-id strategy, receive signature, subscription renewal ownership, webhook URL format, and Stripe routing target are now resolved — see "Resolved Decisions" above.)

1. **Replay-for-debugging admin endpoint.** Admin-only replay of stored normalized events for debugging. Useful but risky. Deferred — build later, behind admin step-up auth, when there is concrete debugging need.
2. **Streaming JSON parse for very large notification arrays.** Default `JSON.parse` is fine for Slice 1 — Microsoft Graph batches we've seen so far fit comfortably. Deferred until a real provider payload size requires it.
3. **Redis migration for the dedup store.** Postgres `webhook_event_dedup` table is the Slice 1 store. Migrate to Redis only if write latency becomes a measured bottleneck.
