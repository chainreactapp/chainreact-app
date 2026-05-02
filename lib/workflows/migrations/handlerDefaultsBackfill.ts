/**
 * PR-G0 — handler-defaults backfill framework.
 *
 * Each `Require` row in learning/docs/handler-defaults-audit.md removes a
 * silent handler-side default and forces the field to be explicitly set in
 * workflow config. Existing workflows in the database may rely on the old
 * default — they would suddenly fail with MISSING_REQUIRED_FIELD after the
 * handler change ships.
 *
 * This framework is the bridge: before each PR-Gn removes a handler default,
 * it appends an entry here describing
 *   - which `node_type` is affected,
 *   - which `config[fieldName]` to set,
 *   - what value to write (the previous handler default).
 *
 * `runHandlerDefaultsBackfill` walks `workflow_nodes`, finds rows whose
 * `node_type` matches a registry entry, and writes `legacyDefault` into
 * `config[fieldName]` ONLY when the field is currently undefined or null.
 * Anything already set (including the legacy default itself, or a different
 * explicit choice) is left alone.
 *
 * Idempotence: re-running is safe. The check is "field is not set." A node
 * that has been backfilled once will have the field set to the legacy
 * default; the next run sees a present value and skips it.
 *
 * Per-PR scoping: each call can filter to a subset of entries via
 * `options.prs` (e.g. `['PR-G2']`) so deployment workflow can run
 * exactly-the-entries-that-just-shipped without re-touching old ones.
 *
 * Contract: learning/docs/handler-contracts.md Q11.
 */

import { createAdminClient } from '@/lib/supabase/admin'
import { logger } from '@/lib/utils/logger'

import { HANDLER_DEFAULTS_BACKFILL_REGISTRY } from './handlerDefaultsBackfillRegistry'

/**
 * One row in the registry — pinned by the audit's `Require` rows.
 */
export interface BackfillEntry {
  /** Which PR introduced this entry (e.g., "PR-G2"). Used for filtering. */
  pr: string
  /** Matches workflow_nodes.node_type exactly (e.g., "google_calendar_action_create_event"). */
  nodeType: string
  /** Field within workflow_nodes.config to backfill. */
  fieldName: string
  /** Value to write when the field is unset. Must equal the previous handler default. */
  legacyDefault: unknown
  /** Audit row reference (e.g., "createEvent.ts:42"). For traceability in logs. */
  auditRef: string
  /**
   * PR-G3 — optional predicate. When provided, the entry only backfills
   * rows whose config satisfies the predicate. Used for conditionally-
   * required fields (e.g. uploadFile's `shareNotification` is only relevant
   * when `config.shareWith` is non-empty). Returns true → consider the row;
   * false → leave the row alone, even if `fieldName` is unset.
   */
  applyWhen?: (config: Record<string, unknown>) => boolean
}

export interface BackfillRunOptions {
  /**
   * Restrict to entries from these PRs. If omitted, all registered entries
   * are applied. Tests pin specific PRs to avoid touching other entries.
   */
  prs?: readonly string[]
  /**
   * If true, computes what would change without writing. Useful for
   * deployment-time confirmation.
   */
  dryRun?: boolean
  /**
   * Page size for the workflow_nodes scan. Default 500. Lower for memory-
   * constrained environments.
   */
  pageSize?: number
  /**
   * Optional supabase client. Defaults to a fresh service-role admin client.
   * Tests inject a mock.
   */
  supabase?: ReturnType<typeof createAdminClient> | null
  /**
   * Override the registry. Defaults to the production registry shipped
   * alongside this file. Tests pass a synthetic registry to avoid coupling
   * to whatever PR-Gn has appended.
   */
  registry?: readonly BackfillEntry[]
}

export interface BackfillRunResult {
  /** Total workflow_nodes rows scanned across the matched node types. */
  scanned: number
  /** Rows that had at least one field updated (and persisted, unless dry run). */
  rowsUpdated: number
  /** Per-entry counts — keyed by `${pr}:${nodeType}.${fieldName}`. */
  byEntry: Record<string, number>
  /** True if `options.dryRun` was set; no UPDATEs were issued. */
  dryRun: boolean
}

/**
 * Filter the registry by `options.prs` (defaults to all entries).
 */
export function selectEntries(
  registry: readonly BackfillEntry[],
  prs?: readonly string[],
): BackfillEntry[] {
  if (!prs || prs.length === 0) return [...registry]
  const set = new Set(prs)
  return registry.filter((e) => set.has(e.pr))
}

/**
 * Group entries by node type so we can scan each affected workflow_nodes
 * `node_type` exactly once.
 */
export function groupEntriesByNodeType(entries: readonly BackfillEntry[]): Map<string, BackfillEntry[]> {
  const map = new Map<string, BackfillEntry[]>()
  for (const e of entries) {
    const list = map.get(e.nodeType) ?? []
    list.push(e)
    map.set(e.nodeType, list)
  }
  return map
}

/**
 * Apply all entries for a single config row in memory. Returns the new
 * config (only if at least one field was written) or null if nothing
 * changed.
 *
 * Pure function — no DB access. Exported so unit tests can pin the
 * decision logic.
 */
export function applyEntriesToConfig(
  config: Record<string, unknown> | null | undefined,
  entries: readonly BackfillEntry[],
): { newConfig: Record<string, unknown>; appliedFields: string[] } | null {
  const base: Record<string, unknown> = config && typeof config === 'object' ? { ...config } : {}
  const appliedFields: string[] = []

  for (const entry of entries) {
    // PR-G3 — applyWhen predicate. Skip the entry when the predicate
    // returns false (the row's config doesn't satisfy the conditional
    // requirement, so backfilling would pollute it).
    if (entry.applyWhen && !entry.applyWhen(base)) {
      continue
    }
    const current = base[entry.fieldName]
    // Q5 contract: 0 / false / '' are valid explicit choices and must be
    // preserved. Only undefined / null / missing-key triggers backfill.
    if (current === undefined || current === null) {
      base[entry.fieldName] = entry.legacyDefault
      appliedFields.push(entry.fieldName)
    }
  }

  if (appliedFields.length === 0) return null
  return { newConfig: base, appliedFields }
}

function entryKey(e: BackfillEntry): string {
  return `${e.pr}:${e.nodeType}.${e.fieldName}`
}

/**
 * Walk workflow_nodes and apply matching entries. Idempotent.
 */
export async function runHandlerDefaultsBackfill(
  options: BackfillRunOptions = {},
): Promise<BackfillRunResult> {
  const supabase = options.supabase ?? createAdminClient()
  const registry = options.registry ?? HANDLER_DEFAULTS_BACKFILL_REGISTRY
  const dryRun = options.dryRun ?? false
  const pageSize = options.pageSize ?? 500

  const entries = selectEntries(registry, options.prs)
  const result: BackfillRunResult = {
    scanned: 0,
    rowsUpdated: 0,
    byEntry: {},
    dryRun,
  }

  if (entries.length === 0) {
    logger.debug('[handlerDefaultsBackfill] no entries selected — nothing to do')
    return result
  }

  for (const e of entries) result.byEntry[entryKey(e)] = 0

  const groups = groupEntriesByNodeType(entries)

  for (const [nodeType, nodeEntries] of groups) {
    let from = 0
    while (true) {
      const to = from + pageSize - 1
      const { data, error } = await supabase
        .from('workflow_nodes')
        .select('id, config')
        .eq('node_type', nodeType)
        .order('id', { ascending: true })
        .range(from, to)

      if (error) {
        logger.error('[handlerDefaultsBackfill] scan failed', { nodeType, error: error.message })
        throw new Error(`workflow_nodes scan failed for ${nodeType}: ${error.message}`)
      }

      const rows = data ?? []
      result.scanned += rows.length

      for (const row of rows) {
        const applied = applyEntriesToConfig(row.config as Record<string, unknown> | null, nodeEntries)
        if (!applied) continue

        if (!dryRun) {
          const { error: updateError } = await supabase
            .from('workflow_nodes')
            .update({
              config: applied.newConfig,
              updated_at: new Date().toISOString(),
            })
            .eq('id', row.id)
          if (updateError) {
            logger.error('[handlerDefaultsBackfill] update failed', {
              nodeId: row.id,
              nodeType,
              error: updateError.message,
            })
            throw new Error(`workflow_nodes update failed for ${row.id}: ${updateError.message}`)
          }
        }

        result.rowsUpdated += 1
        for (const field of applied.appliedFields) {
          for (const entry of nodeEntries) {
            if (entry.fieldName === field) {
              result.byEntry[entryKey(entry)] += 1
            }
          }
        }
      }

      if (rows.length < pageSize) break
      from += pageSize
    }
  }

  logger.info('[handlerDefaultsBackfill] complete', {
    dryRun,
    scanned: result.scanned,
    rowsUpdated: result.rowsUpdated,
    selectedPrs: options.prs ?? '(all)',
  })

  return result
}
