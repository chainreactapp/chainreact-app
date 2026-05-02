import { ALL_NODE_COMPONENTS } from '@/lib/workflows/nodes'
import { getMissingRequiredFields } from './fieldVisibility'
import { validateDataFlow, type UnresolvedReference } from './validateDataFlow'

export interface WorkflowValidation {
  isValid: boolean
  issues: string[]
  unresolvedReferences?: UnresolvedReference[]
  dataFlowWarnings?: string[]
}

// Validate workflow configuration
export function validateWorkflow(workflow: any): WorkflowValidation {
  const issues: string[] = []

  // Get nodes from the workflow object
  // Primary path: workflow.nodes (Workflow interface)
  // Fallback: workflow.workflow_json.nodes (templates/legacy)
  let nodes: any[] = []

  if (Array.isArray(workflow?.nodes)) {
    // Primary path: nodes directly on workflow object
    nodes = workflow.nodes
  } else if (workflow?.workflow_json) {
    // Fallback: workflow_json (used in templates and some legacy contexts)
    try {
      const workflowData = typeof workflow.workflow_json === 'string'
        ? JSON.parse(workflow.workflow_json)
        : workflow.workflow_json
      nodes = workflowData?.nodes || []
    } catch (e) {
      issues.push('Invalid workflow configuration')
      return { isValid: false, issues }
    }
  }

  // Helper to check isTrigger from either Flow or ReactFlow format.
  // Falls back to catalog lookup since some providers use colon-separated types
  // (e.g. "google-drive:new_file_in_folder") that don't contain "_trigger_".
  const isNodeTrigger = (node: any) => {
    // Check persisted flags first
    if (node.data?.isTrigger !== undefined) return node.data.isTrigger
    if (node.metadata?.isTrigger !== undefined) return node.metadata.isTrigger
    // Flow shape: top-level node.type IS the actual node type string (v2/system, agent planner output).
    // ReactFlow shape uses node.type === 'custom' and stores the type in node.data.type, so this branch
    // matches only the Flow-shaped path. Tested at __tests__/workflows/v2/system/validate-workflow.test.ts:219.
    if (node.type?.includes('_trigger_')) return true
    // Final fallback: look up the node type in the catalog
    const nodeType = node.data?.type || node.metadata?.type
    if (nodeType) {
      const catalogEntry = ALL_NODE_COMPONENTS.find((c: any) => c.type === nodeType)
      if (catalogEntry?.isTrigger) return true
    }
    return false
  }

  // Helper to check if node is a valid workflow node (not a placeholder)
  const isWorkflowNode = (node: any) =>
    node.type === 'custom' || (node.type && !node.type.startsWith('add-'))

  const triggerNodes = nodes.filter((node: any) => isNodeTrigger(node))
  const hasTrigger = triggerNodes.length > 0
  if (!hasTrigger) {
    issues.push('No trigger node configured')
  }

  const actionNodes = nodes.filter((node: any) => !isNodeTrigger(node) && isWorkflowNode(node))
  const hasAction = actionNodes.length > 0
  if (!hasAction) {
    issues.push('No action nodes configured')
  }

  // Check node configurations using persisted validation state from the builder.
  // When a user configures a node, the builder saves validationState.isValid and
  // needsSetup directly on node.data. We trust that state instead of re-running
  // schema validation, which can diverge (e.g. defaultValue not in saved config).
  const allWorkflowNodes = [...triggerNodes, ...actionNodes]
  for (const node of allWorkflowNodes) {
    const nodeType = node.data?.type || node.metadata?.type
    if (!nodeType || nodeType === 'ai_agent') continue

    // Check for validation state on node.data, node.metadata, or inside config.__validationState
    // (some save paths store it inside config rather than extracting to node.data)
    const config = node.data?.config || node.metadata?.config || {}
    const validationState = node.data?.validationState || node.metadata?.validationState || config.__validationState
    const needsSetup = node.data?.needsSetup ?? node.metadata?.needsSetup

    // If persisted validation state exists, use it directly
    if (validationState !== undefined || needsSetup !== undefined) {
      if (needsSetup === true || validationState?.isValid === false) {
        const title = node.data?.title || node.data?.label || nodeType
        const missing = validationState?.missingRequired || []
        if (missing.length > 0) {
          issues.push(`${title}: missing ${missing.join(', ')}`)
        } else {
          issues.push(`${title}: needs configuration`)
        }
      }
      continue
    }

    // Fallback: no persisted validation state.
    // If the node has config values set (user has interacted with it), trust that
    // the builder already validated it — only flag truly empty/unconfigured nodes.
    const userConfigKeys = Object.keys(config).filter(k =>
      !k.startsWith('__') && !k.startsWith('_label_') && !k.startsWith('_cached') && k !== 'workflowId'
    )
    const hasUserConfig = userConfigKeys.some(k => {
      const v = config[k]
      return v !== undefined && v !== null && v !== ''
    })
    if (hasUserConfig) continue // Node has been configured by user, trust the builder

    // Truly unconfigured node — run schema check
    const component = ALL_NODE_COMPONENTS.find((c: any) => c.type === nodeType)
    if (!component?.configSchema?.length) continue

    const nodeInfo = {
      type: nodeType,
      providerId: node.data?.providerId || component.providerId,
      configSchema: component.configSchema
    }

    const missing = getMissingRequiredFields(nodeInfo, config)
    if (missing.length > 0) {
      const title = node.data?.title || node.data?.label || component.title || nodeType
      issues.push(`${title}: missing ${missing.join(', ')}`)
    }
  }

  // Data-flow validation: check all {{...}} references resolve to real nodes
  let edges: any[] = []
  if (Array.isArray(workflow?.edges)) {
    edges = workflow.edges
  } else if (Array.isArray(workflow?.connections)) {
    edges = workflow.connections.map((c: any) => ({
      source: c.source || c.source_node_id,
      target: c.target || c.target_node_id,
    }))
  } else if (workflow?.workflow_json) {
    try {
      const wfData = typeof workflow.workflow_json === 'string'
        ? JSON.parse(workflow.workflow_json)
        : workflow.workflow_json
      edges = (wfData?.edges || wfData?.connections || []).map((c: any) => ({
        source: c.source || c.source_node_id,
        target: c.target || c.target_node_id,
      }))
    } catch {
      // Edge parsing failed — skip data-flow validation
    }
  }

  const dataFlowResult = validateDataFlow(nodes, edges)

  for (const ref of dataFlowResult.unresolvedReferences) {
    issues.push(`${ref.nodeTitle}: ${ref.reference} — ${ref.reason}`)
  }

  return {
    isValid: issues.length === 0,
    issues,
    unresolvedReferences: dataFlowResult.unresolvedReferences,
    dataFlowWarnings: dataFlowResult.warnings,
  }
}
