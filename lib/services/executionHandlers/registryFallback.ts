/**
 * Registry fallback for v2 integration handlers (PR-V2C).
 *
 * v2 dispatch (`integrationHandlers.ts`, plus the per-service services
 * `GmailIntegrationService`, `SlackIntegrationService`,
 * `GoogleIntegrationService`) historically threw `Unknown ... action`
 * on any node type not listed in their explicit `switch` cases.
 *
 * v1's registry-based dispatcher (`lib/workflows/executeNode.ts`'s
 * `executeAction`) handles ~330 node types via a registry. Most of the
 * gap between v1 and v2 — Stripe, Shopify, GitHub, Twitter, Mailchimp,
 * ManyChat, Gumroad, Monday.com, plus partial coverage in HubSpot,
 * OneDrive, Trello, Teams — is unhandled by v2 today.
 *
 * This helper routes those node types through `executeAction` so v2 can
 * survive cutover without a multi-week porting marathon.
 *
 * --- Test-mode safety ---
 *
 * v2's INTERCEPT_WRITES is post-hoc wrapping. `nodeExecutionService.ts`
 * (line ~87) calls the integration handler first and then decorates
 * the result with `intercepted: {...}`. The underlying provider call
 * still happens; safety in test mode relies on per-handler
 * `meta?.testMode` self-abort discipline (Q8d). Only ~12 handlers in
 * the codebase implement Q8d today.
 *
 * For explicit v2 cases, codebase authors have presumably verified each
 * handler's testMode behavior. For fallback-reached handlers — which
 * include the entire long tail — that assumption does not hold.
 *
 * To honor the test-mode safety contract without auditing every
 * registry handler, this fallback short-circuits when
 * `context.testMode` is true. It returns a deterministic mock so zero
 * real provider calls happen via the fallback in sandbox or test
 * executions. Trade-off: test-mode runs of fallback-reached node types
 * see a `__testModeFallback: true` shape instead of the handler's
 * native testMode behavior.
 *
 * Once v1 is deleted (Phase 5 stage 5 of the v2 canonical engine
 * consolidation), the explicit/fallback distinction collapses and this
 * short-circuit can be revisited.
 */

import { ExecutionContext } from "../workflowExecutionService"
import { logger } from '@/lib/utils/logger'

export interface RegistryFallbackOptions {
  /**
   * Source label used in log lines and error messages —
   * e.g., 'IntegrationNodeHandlers', 'GmailIntegrationService'.
   */
  source: string
}

export async function fallbackToRegistry(
  node: any,
  context: ExecutionContext,
  options: RegistryFallbackOptions,
): Promise<any> {
  const nodeType = node?.data?.type ?? 'unknown'

  if (context.testMode) {
    logger.info(
      `🛡️ ${options.source} test-mode fallback short-circuit: ${nodeType}`,
    )
    return {
      __testModeFallback: true,
      nodeType,
      message: `Test mode: '${nodeType}' would have executed via ${options.source} registry fallback`,
      mockData: true,
    }
  }

  const { executeAction } = await import('@/lib/workflows/executeNode')
  logger.info(
    `🪃 ${options.source} live fallback: ${nodeType} → executeAction`,
  )

  const result = await executeAction({
    node,
    input: {
      ...(context.data || {}),
      executionId: context.executionId,
      // PR-R1a + PR-V2C — thread retry-lineage root through the
      // fallback so Q4 dedup keys + Stripe Idempotency-Key headers
      // align across retries. v2's `ExecutionContext` does not yet
      // carry `rootExecutionId` (separate Phase-2 commit). Until then,
      // the cast falls back to executionId, matching the
      // session=root semantics PR-R1a established for fresh runs.
      rootExecutionId:
        (context as any).rootExecutionId ?? context.executionId,
      workflowId: context.workflowId,
      nodeId: node?.id,
      testMode: false,
    },
    userId: context.userId,
    workflowId: context.workflowId,
    testMode: false,
    executionMode: 'live',
  })

  if (!result.success) {
    throw new Error(
      result.message || (result as any).error || `Action ${nodeType} failed`,
    )
  }
  return result.output
}
