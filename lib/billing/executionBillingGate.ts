/**
 * Phase 3 of v2 canonical engine plan (PR-V2-BILLING) —
 * shared billing gate for workflow execution entry paths.
 *
 * Wraps:
 *   - canonical billing-scope resolution (`resolveBillingScope` →
 *     `scopeToBillingUser`),
 *   - atomic task deduction (`deductTasksAtomic`),
 *   - auto-buy fire-and-forget on insufficient balance,
 *   - structured logging at every decision point.
 *
 * Returns a discriminated union (`BillingGateOutcome`). The helper does
 * NOT throw for billing failures — only for unexpected errors. Callers
 * map the outcome to their own response shape (HTTP for routes, return
 * object for services).
 *
 * Callers (current and planned):
 *
 * | Caller | eventType | Notes |
 * |---|---|---|
 * | `app/api/workflows/execute/route.ts` (v1 dispatch) | `'workflow_execution'` | unchanged behavior |
 * | `app/api/workflows/execute-stream/route.ts` (HITL stream, v1 only) | `'workflow_execution'` | unchanged behavior |
 * | `lib/services/workflowExecutionService.ts` (v2 dispatch) | `'workflow_execution'` | new — v2 self-bills |
 * | future PR-V2-WEBHOOKS | `'workflow_execution_webhook'` | distinct event type |
 * | future PR-V2-CRON | `'workflow_execution_scheduled'` | distinct event type |
 * | future resume Phase 2+ | `'workflow_execution_resume'` | distinct ledger row |
 *
 * Plan: learning/docs/v2-canonical-execution-engine-plan.md
 */

import type {
  BillingEventType,
  TaskDeductionResult,
} from '@/lib/workflows/taskDeduction'
import { logger } from '@/lib/utils/logger'

export interface BillingGateInput {
  /** Workflow row — `user_id` is required for billing-scope resolution. */
  workflow: { id: string; user_id?: string | null; [k: string]: any }
  /** Action nodes ONLY (callers must filter out triggers). Cost preview
   * counts these; trigger nodes are 0-cost. */
  actionNodes: any[]
  /** Used by the cost preview's loop-inner-node detection. */
  edges: Array<{ source: string; target: string }>
  /**
   * Idempotency key for the deduction. UNIQUE
   * `(user_id, execution_id, event_type)` on `task_billing_events`.
   * For v2 callers this should be the session UUID; for v1 callers it
   * remains the synthetic `exec_${workflowId}_${Date.now()}` string.
   */
  executionSessionId: string
  /** Original execution id when this is a retry. Surfaced in metadata. */
  retryOf?: string
  /** When true, the helper short-circuits with `kind: 'skipped'`. */
  isTestMode: boolean
  /**
   * REQUIRED. Distinct event types produce distinct ledger rows; this
   * matters once webhook / scheduled / resume entry paths layer on top
   * of original executions. No default — every caller picks explicitly.
   */
  eventType: BillingEventType
}

export type BillingGateOutcome =
  | { kind: 'ok'; deductionResult: TaskDeductionResult }
  | { kind: 'skipped'; reason: 'test_mode' | 'no_action_nodes' }
  | {
      kind: 'insufficient_balance'
      tasksNeeded: number
      remaining: number | null
      autoBuyTriggered: boolean
      error: string
    }
  | { kind: 'subscription_inactive'; error: string }
  | { kind: 'billing_unavailable'; error: string }

/**
 * Run the billing gate for a workflow execution. Pure-data return; no
 * HTTP, no engine knowledge. Caller maps outcome → response.
 *
 * Decision tree:
 *
 *   isTestMode === true → `skipped` (no DB hit, mirrors deductTasksAtomic)
 *   actionNodes.length === 0 → `skipped` (trigger-only workflows)
 *   deductTasksAtomic returns `deducted` / `idempotent_replay` → `ok`
 *   deductTasksAtomic returns `insufficient_balance` → fire auto-buy if
 *     enabled, return `insufficient_balance` with `autoBuyTriggered`
 *   deductTasksAtomic returns `subscription_inactive` → return that
 *   deductTasksAtomic returns `billing_unavailable` → return that
 *   deductTasksAtomic throws → return `billing_unavailable`
 */
export async function runBillingGate(input: BillingGateInput): Promise<BillingGateOutcome> {
  const {
    workflow,
    actionNodes,
    edges,
    executionSessionId,
    retryOf,
    isTestMode,
    eventType,
  } = input

  if (isTestMode) {
    logger.debug('[BillingGate] Skipped (test mode)', { workflowId: workflow.id, eventType })
    return { kind: 'skipped', reason: 'test_mode' }
  }

  if (!actionNodes || actionNodes.length === 0) {
    logger.debug('[BillingGate] Skipped (no action nodes)', { workflowId: workflow.id, eventType })
    return { kind: 'skipped', reason: 'no_action_nodes' }
  }

  // Resolve billing scope (workspace-level → user-level fallback).
  const { resolveBillingScope } = await import('@/lib/billing/resolveBillingScope')
  const { scopeToBillingUser } = await import('@/lib/billing/scopeToBillingUser')
  const billingScope = resolveBillingScope(workflow as any)
  const billingUserId = await scopeToBillingUser(billingScope)
  logger.info('[BillingGate] Scope resolved', {
    workflowId: workflow.id,
    scopeType: billingScope.scopeType,
    scopeId: billingScope.scopeId,
    billingUserId,
    eventType,
  })

  const deductionSource = retryOf ? 'retry' : 'execution'
  const deductionMetadata: Record<string, unknown> = retryOf
    ? { is_retry: true, original_execution_id: retryOf }
    : {}

  let deductionResult: TaskDeductionResult
  try {
    const { deductTasksAtomic } = await import('@/lib/workflows/taskDeduction')
    deductionResult = await deductTasksAtomic(
      billingUserId,
      actionNodes,
      edges,
      executionSessionId,
      false,
      {
        workflowId: workflow.id,
        source: deductionSource,
        metadata: deductionMetadata,
        eventType,
      },
    )
  } catch (deductError: any) {
    logger.error('[BillingGate] Deduction threw unexpectedly', {
      workflowId: workflow.id,
      executionSessionId,
      eventType,
      error: deductError?.message,
    })
    return {
      kind: 'billing_unavailable',
      error: 'Billing system temporarily unavailable. Please retry.',
    }
  }

  if (deductionResult.resultType === 'insufficient_balance') {
    // Fire-and-forget auto-buy when feature flag is on. Does NOT unblock
    // the in-flight request — user retries after the webhook credits balance.
    let autoBuyTriggered = false
    const { FEATURE_FLAGS } = await import('@/lib/featureFlags')
    if (FEATURE_FLAGS.TASK_PACKS) {
      const { triggerAutoBuyIfEnabled } = await import('@/lib/billing/auto-buy')
      autoBuyTriggered = true
      triggerAutoBuyIfEnabled(billingUserId)
        .then((result) => {
          if (result.ok) {
            logger.info('[BillingGate] Auto-buy succeeded after 402', {
              userId: billingUserId,
              newBalance: result.newBalance,
            })
          } else {
            logger.warn('[BillingGate] Auto-buy did not succeed', {
              userId: billingUserId,
              code: result.code,
            })
          }
        })
        .catch((err) => {
          logger.error('[BillingGate] Auto-buy threw unexpectedly', {
            userId: billingUserId,
            error: err?.message,
          })
        })
    }

    logger.warn('[BillingGate] Insufficient balance', {
      workflowId: workflow.id,
      executionSessionId,
      eventType,
      tasksNeeded: deductionResult.tasksDeducted,
      remaining: deductionResult.newBalance,
      autoBuyTriggered,
    })

    return {
      kind: 'insufficient_balance',
      tasksNeeded: deductionResult.tasksDeducted ?? 0,
      remaining: deductionResult.newBalance,
      autoBuyTriggered,
      error: deductionResult.error ?? 'Task limit reached.',
    }
  }

  if (deductionResult.resultType === 'subscription_inactive') {
    logger.warn('[BillingGate] Subscription inactive', {
      workflowId: workflow.id,
      executionSessionId,
      eventType,
    })
    return {
      kind: 'subscription_inactive',
      error: deductionResult.error ?? 'Your subscription is inactive.',
    }
  }

  if (deductionResult.resultType === 'billing_unavailable') {
    logger.error('[BillingGate] Billing system unavailable', {
      workflowId: workflow.id,
      executionSessionId,
      eventType,
      error: deductionResult.error,
    })
    return {
      kind: 'billing_unavailable',
      error: deductionResult.error ?? 'Billing system temporarily unavailable. Please retry.',
    }
  }

  // 'deducted' or 'idempotent_replay' — both are "authorized to proceed".
  return { kind: 'ok', deductionResult }
}
