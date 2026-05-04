# Safe Resume-From-Failed-Node Execution

**Status:** In progress behind feature flag `ENABLE_RESUME_FROM_FAILED_NODE`
(default `false`). Implementation plan:
[safe-resume-from-failed-node-implementation-plan.md](./safe-resume-from-failed-node-implementation-plan.md).
This status flips to "shipped" only after rollout completes and PR-R1b
(Q4 read-fallback removal) lands.

**Origin:** Spun out of the v1 error-handling UX work
([error-handling-ux.md](./error-handling-ux.md)). v1 ships full-workflow retry only;
this project adds the safer "resume from broken step" path.

## Problem

Today, retry = full rerun via `POST /api/executions/{id}/retry`. For workflows
that already partially succeeded before failing — e.g. step 1 charged a Stripe
customer, step 2 (Slack notify) failed — a retry re-fires step 1. Session-scoped
Q4 idempotency keys do not protect across sessions, so the second charge can
land.

The product gap users see: "I just want to re-run the broken node, not the
whole thing."

## Minimum scope

A future implementation must cover, at minimum:

1. **Persist node-level outputs / checkpoints** so completed steps' results
   survive past session end and are retrievable by `(workflowId, sessionId, nodeId)`.
2. **Determine the failed node and a valid restart point** — restart point
   may be the failed node itself, or an earlier node if the engine cannot
   safely reconstruct context from the failed node alone.
3. **Rebuild DataFlowContext from completed upstream nodes** without
   re-executing them — replay stored outputs into the data-flow manager.
4. **Skip already-successful side-effecting nodes** — they must not fire
   again on resume.
5. **Extend idempotency beyond session-scoped keys** — either widen the Q4
   key from `(executionSessionId, nodeId, actionType)` to a workflow-scoped
   form, or introduce an explicit retry-lineage key so a resume can claim
   the original session's effects.
6. **Handle payment-impacting nodes safely** — Stripe / Shopify / Square /
   PayPal must not double-charge under any resume path. Provider-native
   idempotency headers must be threaded through coherently with whatever
   key scheme (5) lands on.
7. **UI copy distinguishing** the two retry modes:
   - **"Retry full workflow"** — current v1 behavior, re-runs from trigger.
   - **"Resume from failed step"** — new behavior; only available when
     engine support is in place and the run is resumable.

## Out of scope (for this entry)

This doc records the project; it does not design it. Architecture, key
schema, migration plan, rollout strategy, and provider-by-provider safety
review all happen when the project is picked up.

## References

- v1 retry contract: [error-handling-ux.md](./error-handling-ux.md) §"Retry semantics — v1"
- Session-scoped idempotency contract: CLAUDE.md §6 "Within-Session Idempotency"
  + [handler-contracts.md](./handler-contracts.md) Q4
- DataFlowContext / strict resolution: CLAUDE.md §6 "Variable Resolution"
- Payment-impacting node list (already used by v1 retry warning):
  Stripe / Shopify / Square / PayPal
