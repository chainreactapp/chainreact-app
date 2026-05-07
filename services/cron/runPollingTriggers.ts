import * as triggerResourcesRepo from "@/repositories/triggerResources";
import type { TriggerResourceRecord } from "@/repositories/triggerResources";
import { getStateForDispatch } from "@/repositories/workflows";
import { findPollingHandler } from "@/services/triggers/pollingRegistry";
import { DEFAULT_INTERVAL_MS } from "./pollingIntervals";

/**
 * Polling-trigger scheduler.
 *
 * Slice 2e port from V1 `app/api/cron/poll-triggers/route.ts` — adapted
 * for V2:
 *   - Auth lives at the route layer (services/cron/auth.ts) so this
 *     module is a pure orchestrator and unit-testable without HTTP.
 *   - V1 ran a sequential `for` loop; we use `Promise.allSettled` with a
 *     concurrency cap and a per-trigger timeout so one slow handler
 *     can't stall the batch. (V1 smell: a stuck handler delayed every
 *     subsequent trigger in the same cron tick.)
 *   - Workflow state gate per row before dispatch — V2 lifecycle deletes
 *     the row on disable, but a row can exist briefly during in-flight
 *     transitions; mirror the webhook dispatcher's defense-in-depth.
 *   - V1 cached `user_profiles.role` in-memory per cron tick to compute
 *     per-tier intervals. Slice 2e uses a single 5-minute default
 *     (services/cron/pollingIntervals.ts) so the cache is unnecessary.
 *     The cache + per-tier flip lands together in a follow-up.
 *
 * Errors don't propagate. One handler throwing returns "errors+1" in the
 * summary; the route still returns 200 to Vercel cron (V1 parity — cron
 * delivery shouldn't be retried by the platform; the next tick is the
 * retry).
 */

export interface RunPollingTriggersResult {
  /** Number of trigger_resources rows examined this tick. */
  examined: number;
  /** Number of handlers that ran to completion (success or non-throw). */
  processed: number;
  /** Skipped because no handler / interval not elapsed / workflow inactive. */
  skipped: number;
  /** Handler threw, or per-trigger timeout expired. */
  errors: number;
  /** ISO timestamp of when this tick started. */
  startedAt: string;
}

/** Per-trigger timeout. V1 had no timeout — defending against stuck handlers. */
const PER_TRIGGER_TIMEOUT_MS = 25_000;

/** Concurrency cap for the per-trigger fan-out. */
const CONCURRENCY = 5;

export async function runPollingTriggers(): Promise<RunPollingTriggersResult> {
  const startedAt = new Date().toISOString();
  const now = Date.now();

  const triggers = await triggerResourcesRepo.listForPolling();

  const result: RunPollingTriggersResult = {
    examined: triggers.length,
    processed: 0,
    skipped: 0,
    errors: 0,
    startedAt,
  };

  if (triggers.length === 0) return result;

  // Pre-filter — drop rows whose workflow isn't active, and rows whose
  // interval hasn't elapsed yet. V1 did the interval gate inside the loop;
  // doing it before the fan-out keeps Promise.allSettled tight.
  const eligible: TriggerResourceRecord[] = [];
  for (const trigger of triggers) {
    const handler = findPollingHandler(trigger);
    if (!handler) {
      result.skipped += 1;
      continue;
    }

    const lastPolledAt = readLastPolledAt(trigger);
    const interval = handler.getIntervalMs("default") || DEFAULT_INTERVAL_MS;
    if (now - lastPolledAt < interval) {
      result.skipped += 1;
      continue;
    }

    const state = await getStateForDispatch(trigger.workflowId);
    if (state !== "active") {
      // The lifecycle service deletes trigger_resources on disable; this
      // is the in-flight-window guard mirroring the webhook dispatcher.
      result.skipped += 1;
      continue;
    }

    eligible.push(trigger);
  }

  // Fan out with bounded parallelism.
  for (let i = 0; i < eligible.length; i += CONCURRENCY) {
    const batch = eligible.slice(i, i + CONCURRENCY);
    const settled = await Promise.allSettled(
      batch.map((trigger) => runOne(trigger, now)),
    );
    for (const outcome of settled) {
      if (outcome.status === "fulfilled") {
        result.processed += 1;
      } else {
        result.errors += 1;
      }
    }
  }

  return result;
}

async function runOne(
  trigger: TriggerResourceRecord,
  now: number,
): Promise<void> {
  const handler = findPollingHandler(trigger);
  if (!handler) return; // already filtered above; defensive

  await withTimeout(
    handler.poll({ trigger, userRole: "default", now }),
    PER_TRIGGER_TIMEOUT_MS,
    `polling handler ${handler.id} for trigger ${trigger.id}`,
  );
}

function readLastPolledAt(trigger: TriggerResourceRecord): number {
  const polling = (trigger.config as { polling?: { lastPolledAt?: string } })
    .polling;
  if (!polling?.lastPolledAt) return 0;
  const parsed = Date.parse(polling.lastPolledAt);
  return Number.isFinite(parsed) ? parsed : 0;
}

function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  label: string,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`Timeout (${ms}ms) — ${label}`));
    }, ms);
    promise.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      },
    );
  });
}
