import { ALL_NODE_COMPONENTS } from "@/lib/workflows/nodes"

/**
 * Regex to extract all {{...}} variable references from a string.
 * Handles single-template and embedded-template cases.
 */
const TEMPLATE_REGEX = /\{\{([^}]+)\}\}/g

/**
 * References that are resolved at runtime and should NOT be validated statically.
 */
const RUNTIME_REFERENCES = new Set([
  "*",
  "NOW",
  "now",
])

/**
 * Prefixes for AI-generated field values that are resolved at runtime.
 */
const AI_FIELD_PREFIX = "AI_FIELD:"

export interface UnresolvedReference {
  nodeId: string
  nodeTitle: string
  fieldName: string
  reference: string
  reason: string
}

export interface DataFlowValidation {
  isValid: boolean
  unresolvedReferences: UnresolvedReference[]
  warnings: string[]
}

/**
 * Extracts all {{...}} template references from a value, recursively handling
 * objects, arrays, and strings.
 */
function extractReferences(
  value: any,
  fieldName: string,
  results: Array<{ fieldName: string; reference: string }>
): void {
  if (typeof value === "string") {
    let match: RegExpExecArray | null
    TEMPLATE_REGEX.lastIndex = 0
    while ((match = TEMPLATE_REGEX.exec(value)) !== null) {
      const ref = match[1].trim()
      if (!RUNTIME_REFERENCES.has(ref) && !ref.startsWith(AI_FIELD_PREFIX)) {
        results.push({ fieldName, reference: ref })
      }
    }
  } else if (Array.isArray(value)) {
    for (const item of value) {
      extractReferences(item, fieldName, results)
    }
  } else if (value && typeof value === "object") {
    for (const [key, val] of Object.entries(value)) {
      extractReferences(val, `${fieldName}.${key}`, results)
    }
  }
}

/**
 * Builds a set of node IDs that are upstream of a given node
 * by walking the edge graph backwards from the target.
 */
function getUpstreamNodeIds(
  nodeId: string,
  edges: Array<{ source: string; target: string }>,
): Set<string> {
  const upstream = new Set<string>()
  const queue: string[] = [nodeId]

  while (queue.length > 0) {
    const current = queue.shift()!
    for (const edge of edges) {
      if (edge.target === current && !upstream.has(edge.source)) {
        upstream.add(edge.source)
        queue.push(edge.source)
      }
    }
  }

  return upstream
}

/**
 * Attempts to resolve a reference string to a source node.
 * Handles multiple formats:
 *   - "nodeId.field" (direct node ID)
 *   - "Node Title.field" (human-readable)
 *   - "trigger.field" (trigger shorthand)
 *   - "var.variableName" (workflow variable)
 *   - "global.key" (global data)
 *   - "data.field" (input data shorthand)
 *
 * Returns the source node ID if found, or null if it's a valid non-node reference.
 * Returns undefined if the reference is genuinely unresolvable.
 */
function resolveReferenceToNode(
  reference: string,
  nodeMap: Map<string, any>,
  nodeTitleMap: Map<string, string>,
  nodeTypeMap: Map<string, string>,
): string | null | undefined {
  const parts = reference.split(".")
  const firstPart = parts[0]

  // Workflow variables and global data — valid, skip
  if (firstPart === "var" || firstPart === "global" || firstPart === "data") {
    return null
  }

  // "trigger" shorthand — find the trigger node
  if (firstPart === "trigger") {
    for (const [id, node] of nodeMap) {
      const nodeType = node.data?.type || node.type || ""
      const isTrigger =
        node.data?.isTrigger ||
        nodeType.includes("trigger")
      if (isTrigger) return id
    }
    return undefined
  }

  // Direct node ID match
  if (nodeMap.has(firstPart)) {
    return firstPart
  }

  // Human-readable title match
  const idByTitle = nodeTitleMap.get(firstPart.toLowerCase())
  if (idByTitle) return idByTitle

  // Node type match (e.g., "ai_agent", "gmail_action_send_email")
  const idByType = nodeTypeMap.get(firstPart)
  if (idByType) return idByType

  // Prefix match for node IDs (e.g., "ai_agent" matches "ai_agent-abc123")
  for (const [id] of nodeMap) {
    if (id.startsWith(firstPart + "-") || id.startsWith(firstPart + "_")) {
      return id
    }
  }

  // "Action: Provider: Name.Field" format
  if (reference.includes(": ")) {
    return null // Complex format — skip validation (too dynamic)
  }

  return undefined
}

/**
 * Validates all {{...}} variable references in workflow node configurations.
 *
 * Checks that:
 * 1. Referenced source nodes exist in the workflow
 * 2. Referenced source nodes are upstream (connected via edges)
 *
 * Does NOT check field-level existence in output schemas because runtime outputs
 * are often dynamic (API responses vary). This avoids false positives.
 */
export function validateDataFlow(
  nodes: Array<{
    id: string
    type?: string
    data?: {
      type?: string
      title?: string
      label?: string
      config?: Record<string, any>
      isTrigger?: boolean
    }
  }>,
  edges: Array<{ source: string; target: string }>
): DataFlowValidation {
  const unresolvedReferences: UnresolvedReference[] = []
  const warnings: string[] = []

  // Build lookup maps
  const nodeMap = new Map<string, (typeof nodes)[0]>()
  const nodeTitleMap = new Map<string, string>() // lowercase title → nodeId
  const nodeTypeMap = new Map<string, string>() // nodeType → nodeId

  for (const node of nodes) {
    nodeMap.set(node.id, node)

    const title = node.data?.title || node.data?.label
    if (title) {
      nodeTitleMap.set(title.toLowerCase(), node.id)
    }

    const nodeType = node.data?.type || node.type
    if (nodeType && !nodeTypeMap.has(nodeType)) {
      nodeTypeMap.set(nodeType, node.id)
    }
  }

  // Validate each node's config references
  for (const node of nodes) {
    const config = node.data?.config
    if (!config || typeof config !== "object") continue

    const nodeTitle =
      node.data?.title || node.data?.label || node.data?.type || node.id

    // Extract all {{...}} references from config values
    const refs: Array<{ fieldName: string; reference: string }> = []
    for (const [fieldName, fieldValue] of Object.entries(config)) {
      // Skip internal/metadata fields
      if (fieldName.startsWith("__") || fieldName.startsWith("_label_") || fieldName.startsWith("_cached")) {
        continue
      }
      extractReferences(fieldValue, fieldName, refs)
    }

    if (refs.length === 0) continue

    // Get upstream nodes for this node
    const upstreamIds = getUpstreamNodeIds(node.id, edges)

    for (const { fieldName, reference } of refs) {
      const sourceNodeId = resolveReferenceToNode(
        reference,
        nodeMap,
        nodeTitleMap,
        nodeTypeMap,
      )

      // null means it's a valid non-node reference (var, global, data, complex format)
      if (sourceNodeId === null) continue

      // undefined means the source node wasn't found at all
      if (sourceNodeId === undefined) {
        unresolvedReferences.push({
          nodeId: node.id,
          nodeTitle,
          fieldName,
          reference: `{{${reference}}}`,
          reason: `Referenced node not found in workflow`,
        })
        continue
      }

      // Source node found — check it's upstream
      if (!upstreamIds.has(sourceNodeId) && sourceNodeId !== node.id) {
        const sourceTitle =
          nodeMap.get(sourceNodeId)?.data?.title ||
          nodeMap.get(sourceNodeId)?.data?.type ||
          sourceNodeId

        warnings.push(
          `${nodeTitle}: {{${reference}}} references "${sourceTitle}" which is not upstream — it may not have data available at runtime`
        )
      }
    }
  }

  return {
    isValid: unresolvedReferences.length === 0,
    unresolvedReferences,
    warnings,
  }
}
