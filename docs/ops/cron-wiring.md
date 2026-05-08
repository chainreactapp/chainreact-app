# Cron wiring for `/api/cron/poll-triggers`

**Status:** deferred. `vercel.json` is intentionally **not** committed yet.

This note exists so the wiring is one config-file copy away from being
applied, the moment the prerequisites (below) are confirmed.

---

## Why deferred

Vercel's cron-job cadence support is plan-gated: as of this writing,
Hobby supports daily-only cron jobs while Pro and Enterprise support
minute-level cron jobs. Shipping `* * * * *` on Hobby would fail at deploy
time. Slice 2-OPS could not verify the plan from inside the repo (no
`.vercel/` linkage; no plan info derivable from `package.json`), so the
file is staged here as documentation rather than committed as runtime
config that might break the deploy.

When you confirm the plan supports the chosen cadence, the wiring is a
two-step manual change:

1. Set `CRON_SECRET` in Vercel (Project → Settings → Environment
   Variables, scoped to Production at minimum, ideally Production +
   Preview + Development with the same value used in `.env.local`).
2. Commit `vercel.json` with the entry below in a follow-up PR.

---

## Prerequisites checklist

- [ ] **Vercel plan supports the chosen cadence.** Pro/Enterprise: every
      minute is fine. Hobby: every minute is **not** supported — only
      daily granularity. Confirm the project's plan in the Vercel
      dashboard.
- [ ] **`CRON_SECRET` is set in the Vercel project's environment.**
      `services/cron/auth.ts:requireCronAuth` validates the bearer token
      against `process.env.CRON_SECRET`; without it set, the route
      returns 500 ("Server misconfiguration") on every cron tick. Vercel
      cron sends the project's `CRON_SECRET` automatically as
      `Authorization: Bearer <CRON_SECRET>` when the variable exists at
      project scope.
- [ ] **The value in Vercel matches `.env.local`** so manual `curl`
      verification against the deploy uses the same secret as Vercel
      cron does. (Cross-env consistency makes runbook commands portable.)

---

## Recommended cadence

**`* * * * *` (every minute) — for Pro / Enterprise plans.**

Reasoning: the per-trigger interval gate inside
`services/cron/runPollingTriggers.ts` (`now - lastPolledAt < interval`,
default 5 minutes from `services/cron/pollingIntervals.ts`) does the
actual rate-limiting per Gmail trigger. A 1-minute cron tick with the
5-minute per-trigger interval means each trigger fires once every 5
minutes (V1 parity). Ticks that find no eligible triggers cost one
indexed JSONB query plus a per-row state lookup — negligible.

**Fall back to `*/5 * * * *` if the plan supports it.** Same average
behavior; just no margin for clock skew between the cron and the
per-trigger interval.

**Do not ship daily-only cron** for the polling route — a 24-hour
delivery delay defeats the purpose of polling. If Hobby is the only
available plan and Hobby is locked to daily granularity, the right
answer is to upgrade the Vercel plan, not to weaken the cadence.

---

## `vercel.json` to commit (after prerequisites are checked)

```json
{
  "crons": [
    {
      "path": "/api/cron/poll-triggers",
      "schedule": "* * * * *"
    }
  ]
}
```

**Production-only scoping (recommended):** Vercel cron jobs run on the
Production deployment only by default in current Vercel cron behavior
(preview deploys do not get scheduled cron). Confirm in the Vercel docs
at the time of activation; if preview deploys would also get scheduled
ticks and that is not desired, the cron entry can be conditionally
guarded by deployment context inside the route handler.

---

## Manual verification

### Locally

With `CRON_SECRET` set in `.env.local` and the dev server running on
`http://localhost:3000`:

```sh
curl -X POST -H "Authorization: Bearer $CRON_SECRET" \
  http://localhost:3000/api/cron/poll-triggers
```

Expected: HTTP 200 with `{ "ok": true, "examined": <n>, "processed":
<n>, "skipped": <n>, "errors": <n>, "startedAt": "<ISO>" }`.

### On the production deploy

After committing `vercel.json` and confirming the deploy succeeded:

```sh
curl -X POST -H "Authorization: Bearer $CRON_SECRET" \
  https://<your-vercel-domain>/api/cron/poll-triggers
```

Expected: same shape as above. Then check Vercel Functions logs for the
`cron.poll_triggers.fatal` event-tag — it should never appear on a
healthy deploy. Per-tick logs (`processed`, `skipped`, `errors`) flow
through Next's default `console.info` output.

---

## Risks and operational notes

**Cost / quota.** Each tick that finds eligible triggers calls Gmail's
`history.list`, `messages.get`, and (when filters pass) the engine's
action chain (which for `send_email` calls `messages.send`). With the
5-minute per-trigger interval, each Gmail trigger uses ≤288 Gmail API
calls per day — well below the project's per-user quota.

**Concurrency.** The scheduler caps fan-out at 5 parallel triggers and
25-second per-trigger timeouts (`services/cron/runPollingTriggers.ts`).
For a small user base this is comfortable. When the count of pollable
triggers crosses ~50–100, batching by user or sharding by trigger-id
range is the next move — out of scope for now, flagged here so the cost
isn't surprising at scale.

**Failure isolation.** A handler throwing or timing out is caught by
`Promise.allSettled` and recorded as an `errors` count without aborting
the batch. The route returns 200 even with non-zero `errors` (Vercel
should not retry cron failures). The next tick is the retry.

**Dedup.** Re-delivery of the same Gmail message id (e.g., from a brief
DB clock-skew that causes overlapping polls) is blocked at the
`webhook_event_dedup` table by the unique `(provider, event_id)` index.
No duplicate runs.

---

## When to revisit

- After the first production deploy with cron active: monitor Vercel
  Functions logs for the cron route over a 24-hour window. Typical
  steady-state: most ticks `processed: 0, skipped: <n>, errors: 0` (idle
  triggers awaiting the next interval); periodic ticks with
  `processed: 1+` when a Gmail message arrives. Sustained `errors > 0`
  is the signal to investigate.
- When polling-trigger row count crosses ~50 per user, revisit the
  concurrency cap and the query plan for `listForPolling`.
- When per-tier polling intervals ship (Slice 2 follow-up #2), the
  scheduler will read `user_profiles.role` to compute the gate; the
  `vercel.json` cadence does not change.
