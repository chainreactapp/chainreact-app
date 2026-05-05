/**
 * Pure helpers for retry-lineage resolution and workflow-definition
 * fingerprinting on `workflow_execution_sessions` row creation (PR-R1a).
 *
 * Extracted from `AdvancedExecutionEngine.createExecutionSession` so the
 * decision logic (which root id wins on each path, which hash to persist)
 * can be unit-tested without booting the engine's transitive Next.js
 * module graph.
 *
 * Plan: learning/docs/safe-resume-from-failed-node-implementation-plan.md
 */

import { hashWorkflowDefinition } from '@/lib/workflows/workflowDefinitionHash'
import { logger } from '@/lib/utils/logger'

export interface RootLookupResult {
  /** `root_execution_id` from the original row, or null if not yet backfilled. */
  root: string | null
  /** DB error if the lookup failed (treated as fall-through). */
  error: { message: string } | null
}

export interface ResolveRootInput {
  /** UUID generated client-side for the new session. */
  newSessionId: string
  /** Original execution id when this is a retry/resume. */
  retryOf?: string
  /**
   * Async lookup of the original row's `root_execution_id`. Caller
   * provides this so the helper stays pure (no DB import).
   */
  lookupOriginalRoot: (id: string) => Promise<RootLookupResult>
}

/**
 * Resolve the lineage root id for a new execution session.
 *
 *   * Fresh run (no `retryOf`): root = the new session's own id.
 *     This run is its own lineage root.
 *   * Retry / resume of a Phase-0+ original: root = original.root_execution_id.
 *     The retry inherits the original's lineage so Q4 idempotency keys
 *     align across attempts.
 *   * Retry of a pre-Phase-0 original (root NULL): root = retryOf itself.
 *     The original is its own lineage root, just not yet self-tagged.
 *   * Lookup failure (DB error or row not found): root = retryOf.
 *     Conservative fall-through — better to over-isolate than block the run.
 */
export async function resolveRootExecutionId({
  newSessionId,
  retryOf,
  lookupOriginalRoot,
}: ResolveRootInput): Promise<string> {
  if (!retryOf) return newSessionId

  const { root, error } = await lookupOriginalRoot(retryOf)

  if (error) {
    logger.warn(
      '[sessionLineage.resolveRootExecutionId] lookup failed; falling back to retryOf as root',
      { retryOf, error: error.message },
    )
    return retryOf
  }

  return root || retryOf
}

/**
 * Compute the workflow definition fingerprint to persist on the new
 * session row. Returns null when:
 *   * `workflowData` is missing or not an object (legacy / unsaved
 *     workflow path — those runs are simply not resume-eligible).
 *   * Hash computation throws (defensive — should never happen with
 *     well-formed workflows; logged when it does).
 */
export function computeWorkflowDefinitionHash(workflowData: unknown): string | null {
  if (!workflowData || typeof workflowData !== 'object') return null

  try {
    const wd = workflowData as {
      nodes?: unknown[]
      edges?: unknown[]
      connections?: unknown[]
    }
    return hashWorkflowDefinition({
      nodes: wd.nodes,
      edges: wd.edges,
      connections: wd.connections,
    })
  } catch (e: any) {
    logger.warn(
      '[sessionLineage.computeWorkflowDefinitionHash] hash computation threw; persisting null',
      { error: e?.message },
    )
    return null
  }
}
