/**
 * Workflow definition fingerprint for resume eligibility (PR-R1a, commit 2).
 *
 * `hashWorkflowDefinition({nodes, edges})` returns a SHA-256 hex digest
 * that is stable across array-insertion order, ignores volatile UI/editor
 * metadata, and changes whenever execution-relevant fields (node config,
 * edge routing) change.
 *
 * Persisted on `workflow_execution_sessions.workflow_definition_hash` at
 * session creation. The resume API (PR-R4) refuses to resume a failed
 * run when the current workflow's hash differs from the persisted one —
 * the user must full-retry instead.
 *
 * Hash is config-inclusive: a one-character change inside any node's
 * `config` flips the digest. Volatile UI fields (position, selected,
 * dragging, etc.) and `__`-prefixed UI cache keys (e.g.
 * `config.__dynamicOptions`, which holds dropdown option lists for the
 * builder UI) are stripped before hashing — re-opening a workflow does
 * not change the hash.
 *
 * Plan: learning/docs/safe-resume-from-failed-node-implementation-plan.md
 * Project: learning/docs/safe-resume-from-failed-node-project.md
 */

import { createHash } from 'crypto'
import { canonicalize } from '@/lib/workflows/actions/core/hashPayload'

/**
 * Top-level node keys that carry no execution semantics. Removed before
 * hashing. Most originate from React Flow's runtime state (selected,
 * dragging, measured) or from canvas layout (position, width, height).
 */
const VOLATILE_NODE_KEYS = new Set([
  'position',
  'positionAbsolute',
  'selected',
  'dragging',
  'width',
  'height',
  'measured',
  'sourcePosition',
  'targetPosition',
  'hidden',
  'parentNode',
  'extent',
  'zIndex',
  'ariaLabel',
  'focusable',
  'resizing',
  'expandParent',
])

/**
 * Top-level edge keys that carry no routing semantics. Source/target
 * (and their handles, if present) DO matter and are NOT in this list.
 */
const VOLATILE_EDGE_KEYS = new Set([
  'selected',
  'animated',
  'style',
  'className',
  'markerEnd',
  'markerStart',
  'hidden',
  'zIndex',
  'label',
  'labelStyle',
  'labelBgStyle',
  'labelBgPadding',
  'labelBgBorderRadius',
  'labelShowBg',
  'focusable',
  'pathOptions',
  'interactionWidth',
])

/**
 * Recursively drop any object key that begins with `__`. Used to strip
 * UI-cache fields like `config.__dynamicOptions` (cached dropdown
 * options shown in the builder, refreshed from upstream provider data
 * each time the modal opens).
 */
function stripDoubleUnderscoreKeys(value: unknown): unknown {
  if (value === null || typeof value !== 'object') return value
  if (Array.isArray(value)) return value.map(stripDoubleUnderscoreKeys)
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (k.startsWith('__')) continue
    out[k] = stripDoubleUnderscoreKeys(v)
  }
  return out
}

function stripNode(node: unknown): unknown {
  if (node === null || typeof node !== 'object' || Array.isArray(node)) {
    return stripDoubleUnderscoreKeys(node)
  }
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
    if (VOLATILE_NODE_KEYS.has(k)) continue
    out[k] = stripDoubleUnderscoreKeys(v)
  }
  return out
}

function stripEdge(edge: unknown): unknown {
  if (edge === null || typeof edge !== 'object' || Array.isArray(edge)) {
    return stripDoubleUnderscoreKeys(edge)
  }
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(edge as Record<string, unknown>)) {
    if (VOLATILE_EDGE_KEYS.has(k)) continue
    out[k] = stripDoubleUnderscoreKeys(v)
  }
  return out
}

function nodeSortKey(n: unknown): string {
  if (n && typeof n === 'object' && 'id' in n) {
    return String((n as { id?: unknown }).id ?? '')
  }
  return ''
}

/**
 * Edge sort key. Handles both shapes seen in the codebase:
 *   * v2 (`workflows_revisions.graph`): `{from: {nodeId, portId}, to: {nodeId, portId}}`
 *   * v1 (legacy `WorkflowConnection`): `{source, sourceHandle, target, targetHandle}`
 *
 * Source/target handles are included in the sort key — they affect
 * routing (a switch node's `source-true` and `source-false` ports
 * fan out to different downstream branches).
 */
function edgeSortKey(e: unknown): string {
  if (!e || typeof e !== 'object') return ''
  const edge = e as Record<string, any>
  if (edge.from && edge.to) {
    // v2
    return [
      edge.from?.nodeId ?? '',
      edge.from?.portId ?? '',
      edge.to?.nodeId ?? '',
      edge.to?.portId ?? '',
    ].map(String).join('|')
  }
  // v1
  return [
    edge.source ?? '',
    edge.sourceHandle ?? '',
    edge.target ?? '',
    edge.targetHandle ?? '',
  ].map(String).join('|')
}

export interface HashableWorkflow {
  /** Node array in either v1 or v2 shape. */
  nodes?: unknown[]
  /** Edge array (v2 / React Flow naming). Falls back to `connections` (v1). */
  edges?: unknown[]
  /** Legacy alias for `edges`. */
  connections?: unknown[]
}

/**
 * SHA-256 hex digest of a workflow's execution-relevant definition.
 *
 * Stable across:
 *   * Node / edge array order (sorted internally before hashing)
 *   * Object key insertion order inside any node or edge
 *   * Volatile UI fields (position, selected, dragging, ...) and
 *     `__`-prefixed UI cache fields anywhere in the structure
 *
 * Changes when:
 *   * A node's id, type, label, ports, policy, mappings, or any non-
 *     `__` config field changes
 *   * An edge's source / target / handles change, or an edge is added,
 *     removed, or recreated
 */
export function hashWorkflowDefinition(workflow: HashableWorkflow): string {
  const rawNodes = Array.isArray(workflow?.nodes) ? workflow.nodes : []
  const rawEdges = Array.isArray(workflow?.edges)
    ? workflow.edges
    : Array.isArray(workflow?.connections)
      ? workflow.connections
      : []

  const nodes = rawNodes
    .map(stripNode)
    .sort((a, b) => nodeSortKey(a).localeCompare(nodeSortKey(b)))

  const edges = rawEdges
    .map(stripEdge)
    .sort((a, b) => edgeSortKey(a).localeCompare(edgeSortKey(b)))

  const canonical = canonicalize({ nodes, edges })
  return createHash('sha256').update(canonical).digest('hex')
}
