/**
 * Unified Webhook Workflow Execution
 *
 * Single entry point for all webhook-triggered workflow execution.
 * All provider webhook routes should use this instead of implementing
 * their own execution logic.
 *
 * Includes built-in deduplication to prevent duplicate workflow runs
 * when providers retry webhook deliveries.
 *
 * Phase 3 (PR-V2-WEBHOOKS): when the workflow owner has
 * `user_profiles.opt_in_v2_execution = true` AND
 * `FEATURE_FLAGS.V2_LIVE_EXECUTION` is on, this dispatcher routes the run
 * through `WorkflowExecutionService` (v2). Otherwise it falls through to
 * the legacy `AdvancedExecutionEngine` (v1) path.
 *
 * Critical rollout guardrail: once v2 has been elected for a run, the
 * dispatcher does NOT silently fall back to v1 if v2 fails. Failures
 * surface to the caller as `{ success: false, error }`. This prevents
 * accidental masking of v2 bugs during staged rollout.
 */

import { AdvancedExecutionEngine } from '@/lib/execution/advancedExecutionEngine'
import { decideV2LiveDispatch } from '@/lib/execution/v2LiveExecutionDispatch'
import { FEATURE_FLAGS } from '@/lib/featureFlags'
import { createAdminClient } from '@/lib/supabase/admin'
import { logger } from '@/lib/utils/logger'

// `WorkflowExecutionService` is imported lazily inside `executeWebhookWorkflow`
// when the dispatch elects v2. Eager import would pull `server-only` and an
// eager Supabase client into every consumer of this module — the v1 default
// path doesn't need v2's transitive graph.

export interface WebhookExecutionParams {
  workflowId: string
  userId: string
  provider: string
  triggerType: string
  triggerData: any
  /** Optional metadata about the webhook event (subscriptionId, requestId, etc.) */
  metadata?: Record<string, any>
  /**
   * Unique key for deduplication. If not provided, one is derived from triggerData.
   * Same dedupeKey + workflowId within the TTL window = skipped execution.
   */
  dedupeKey?: string
  /** Set to true to skip dedup check (e.g. for test mode) */
  skipDedup?: boolean
}

export interface WebhookExecutionResult {
  success: boolean
  sessionId?: string
  error?: string
  /** True if this event was a duplicate and was skipped */
  duplicate?: boolean
}

// ─── In-Memory Dedup Cache ──────────────────────────────────────────────────
// Fast, zero-latency dedup for the common case of rapid retries.
// TTL ensures memory doesn't grow unbounded.

const DEDUP_TTL_MS = 5 * 60 * 1000 // 5 minutes
const DEDUP_MAX_ENTRIES = 10_000

const dedupCache = new Map<string, number>() // key → timestamp

function buildDedupeKey(params: WebhookExecutionParams): string | null {
  if (params.dedupeKey) return `${params.workflowId}:${params.dedupeKey}`

  // Try to extract a unique event ID from trigger data
  const data = params.triggerData
  const eventId =
    data?.id ||
    data?.messageId ||
    data?.message?.id ||
    data?.orderId ||
    data?.objectId ||
    data?.eventId ||
    data?.action?.id ||
    data?.client_msg_id ||
    params.metadata?.requestId ||
    params.metadata?.eventId

  if (!eventId) return null

  return `${params.workflowId}:${params.provider}:${eventId}`
}

function isDuplicate(key: string): boolean {
  const cachedAt = dedupCache.get(key)
  if (!cachedAt) return false

  if (Date.now() - cachedAt > DEDUP_TTL_MS) {
    dedupCache.delete(key)
    return false
  }

  return true
}

function markProcessed(key: string): void {
  dedupCache.set(key, Date.now())

  // Evict oldest entries if cache grows too large
  if (dedupCache.size > DEDUP_MAX_ENTRIES) {
    const now = Date.now()
    for (const [k, ts] of dedupCache) {
      if (now - ts > DEDUP_TTL_MS) {
        dedupCache.delete(k)
      }
    }
    // If still too large after TTL cleanup, drop oldest entries
    if (dedupCache.size > DEDUP_MAX_ENTRIES) {
      const entries = Array.from(dedupCache.entries())
      entries.sort((a, b) => a[1] - b[1])
      const toRemove = entries.slice(0, entries.length - DEDUP_MAX_ENTRIES)
      for (const [k] of toRemove) {
        dedupCache.delete(k)
      }
    }
  }
}

/** Exposed for testing only */
export function _clearDedupCache(): void {
  dedupCache.clear()
}

/** Exposed for testing only */
export function _getDedupCacheSize(): number {
  return dedupCache.size
}

// ─── Main Execution Function ────────────────────────────────────────────────

/**
 * Execute a workflow triggered by a webhook event.
 *
 * This is the unified execution path — all webhook routes should call this
 * instead of WorkflowExecutionService, HTTP calls, or queue inserts.
 *
 * Built-in deduplication prevents duplicate workflow runs when providers
 * retry webhook deliveries.
 */
export async function executeWebhookWorkflow(
  params: WebhookExecutionParams
): Promise<WebhookExecutionResult> {
  const { workflowId, userId, provider, triggerType, triggerData, metadata } = params

  // ── Dedup Check ──
  if (!params.skipDedup) {
    const dedupeKey = buildDedupeKey(params)
    if (dedupeKey) {
      if (isDuplicate(dedupeKey)) {
        logger.info(`[Webhook Execute] Duplicate event skipped`, {
          provider,
          triggerType,
          workflowId,
          dedupeKey,
        })
        return { success: true, duplicate: true }
      }
      // Mark as processed BEFORE execution so concurrent retries are caught
      markProcessed(dedupeKey)
    }
  }

  // ── Phase 3 (PR-V2-WEBHOOKS) — dispatch decision ──
  //
  // Look up the workflow row + opt-in once per webhook fire. Failures
  // here fall through to v1 (conservative — opt-in is a positive
  // signal, not a default). One DB query per webhook is acceptable;
  // webhook latency is already async.
  const adminSupabase = createAdminClient()
  let workflowRow: any = null
  let userOptedIntoV2Execution = false
  try {
    const { data: wfRow } = await adminSupabase
      .from('workflows')
      .select('id, name, user_id, status, workspace_id, workspace_type, billing_scope_type, billing_scope_id')
      .eq('id', workflowId)
      .maybeSingle()
    workflowRow = wfRow
    if (workflowRow?.user_id) {
      const { data: profile } = await adminSupabase
        .from('user_profiles')
        .select('opt_in_v2_execution')
        .eq('id', workflowRow.user_id)
        .maybeSingle()
      userOptedIntoV2Execution = !!(profile as any)?.opt_in_v2_execution
    }
  } catch (lookupError: any) {
    logger.warn('[Webhook Execute] workflow/opt-in lookup failed; defaulting to v1 dispatch', {
      workflowId,
      provider,
      error: lookupError?.message,
    })
  }

  const v2Dispatch = decideV2LiveDispatch({
    executionMode: 'webhook',
    flagEnabled: FEATURE_FLAGS.V2_LIVE_EXECUTION,
    userOptedIn: userOptedIntoV2Execution,
  })
  logger.info('[Webhook Execute] Engine dispatch', {
    workflowId,
    provider,
    triggerType,
    ownerUserId: workflowRow?.user_id,
    ...v2Dispatch.log,
  })

  // ── v2 path ──
  //
  // No fallback to v1 from here. If v2 throws or returns billingFailed,
  // we surface that as the result and STOP. Falling back would mask v2
  // bugs and double-execute the workflow on a partial v2 success.
  if (v2Dispatch.useV2 && workflowRow) {
    try {
      // Lazy import — v2 service pulls in `server-only` + an eager
      // Supabase client at module load, which the default v1 path
      // shouldn't pay for. Only loaded when v2 is actually elected.
      const { WorkflowExecutionService } = await import('@/lib/services/workflowExecutionService')
      const v2Service = new WorkflowExecutionService()
      const v2Result: any = await v2Service.executeWorkflow(
        workflowRow,
        triggerData,
        userId,
        false, // testMode — webhooks are always live
        undefined, // workflowData — let v2 load from normalized tables
        false, // skipTriggers — webhooks include trigger data
        undefined, // testModeConfig
        adminSupabase,
        { billingEventType: 'workflow_execution_webhook', source: 'webhook' },
      )

      if (v2Result?.billingFailed === true) {
        const errorMsg = v2Result.billingOutcome?.error ?? 'Billing rejected webhook execution.'
        logger.warn(`[Webhook Execute] v2 billing rejected workflow ${workflowId}`, {
          provider,
          triggerType,
          billingKind: v2Result.billingOutcome?.kind,
        })
        return { success: false, error: errorMsg }
      }

      logger.info(`[Webhook Execute] Workflow ${workflowId} executed successfully via v2`, {
        provider,
        triggerType,
        sessionId: v2Result?.executionId,
      })
      return {
        success: !!v2Result?.success,
        sessionId: v2Result?.executionId,
      }
    } catch (v2Error: any) {
      // No v1 fallback — surface the v2 error directly. Phase 5 stage
      // rollout depends on this signal being visible.
      logger.error(`[Webhook Execute] v2 execution failed for ${workflowId} (NO v1 fallback)`, {
        provider,
        triggerType,
        error: v2Error?.message,
      })
      return { success: false, error: v2Error?.message ?? 'v2 execution failed' }
    }
  }

  // ── v1 path (default) ──
  try {
    const executionEngine = new AdvancedExecutionEngine()

    const executionSession = await executionEngine.createExecutionSession(
      workflowId,
      userId,
      'webhook',
      {
        webhookEvent: {
          provider,
          triggerType,
          metadata: metadata || {},
        },
        inputData: triggerData,
        triggerData,
        timestamp: new Date(),
      }
    )

    await executionEngine.executeWorkflowAdvanced(
      executionSession.id,
      triggerData,
      {
        enableParallel: true,
        maxConcurrency: 5,
      }
    )

    logger.info(`[Webhook Execute] Workflow ${workflowId} executed successfully`, {
      provider,
      triggerType,
      sessionId: executionSession.id,
    })

    return {
      success: true,
      sessionId: executionSession.id,
    }
  } catch (error: any) {
    logger.error(`[Webhook Execute] Failed to execute workflow ${workflowId}:`, {
      provider,
      triggerType,
      error: error.message,
    })

    return {
      success: false,
      error: error.message,
    }
  }
}
