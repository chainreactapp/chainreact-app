import { NextRequest } from 'next/server'
import { createSupabaseServerClient } from '@/utils/supabase/server'
import { jsonResponse, errorResponse } from '@/lib/utils/api-response'
import { logger } from '@/lib/utils/logger'
import { ALL_NODE_COMPONENTS } from '@/lib/workflows/nodes'
import { isConnectedStatus } from "@/lib/integrations/connectionStatus"

export const dynamic = 'force-dynamic'

/**
 * AI Workflow Builder Testing API
 * Validates workflow configurations before activation
 */
export async function POST(request: NextRequest) {
  try {
    const supabase = await createSupabaseServerClient()

    // Auth check
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) {
      return errorResponse('Unauthorized', 401)
    }

    // Check feature entitlement (Pro plan or higher)
    const { requireFeature } = await import('@/lib/utils/require-entitlement')
    const entitlement = await requireFeature(user.id, 'aiAgents')
    if (!entitlement.allowed) return entitlement.response

    const body = await request.json()
    const { workflowId, nodes, edges } = body

    if (!nodes || !Array.isArray(nodes)) {
      return errorResponse('Nodes array is required', 400)
    }

    // Run all validation checks
    const results = {
      valid: true,
      errors: [] as string[],
      warnings: [] as string[],
      checks: {
        nodeValidation: { passed: 0, failed: 0, errors: [] as string[] },
        integrationValidation: { passed: 0, failed: 0, errors: [] as string[] },
        variableValidation: { passed: 0, failed: 0, errors: [] as string[] },
        configValidation: { passed: 0, failed: 0, errors: [] as string[] }
      }
    }

    // 1. Validate all nodes exist and have proper configuration
    const nodeValidation = await validateNodes(nodes, user.id, supabase)
    results.checks.nodeValidation = nodeValidation
    if (!nodeValidation.valid) {
      results.valid = false
      results.errors.push(...nodeValidation.errors)
    }

    // 2. Validate integrations are connected
    const integrationValidation = await validateIntegrations(nodes, user.id, supabase)
    results.checks.integrationValidation = integrationValidation
    if (!integrationValidation.valid) {
      results.valid = false
      results.errors.push(...integrationValidation.errors)
    }

    // 3. Validate variable references
    const variableValidation = validateVariableReferences(nodes, edges)
    results.checks.variableValidation = variableValidation
    if (!variableValidation.valid) {
      results.valid = false
      results.errors.push(...variableValidation.errors)
    }
    results.warnings.push(...variableValidation.warnings)

    // 4. Validate required fields are configured
    const configValidation = validateRequiredFields(nodes)
    results.checks.configValidation = configValidation
    if (!configValidation.valid) {
      results.valid = false
      results.errors.push(...configValidation.errors)
    }
    results.warnings.push(...configValidation.warnings)

    return jsonResponse({
      valid: results.valid,
      errors: results.errors,
      warnings: results.warnings,
      checks: results.checks,
      summary: {
        totalNodes: nodes.length,
        totalChecks: Object.values(results.checks).reduce((sum, check) => sum + check.passed + check.failed, 0),
        passedChecks: Object.values(results.checks).reduce((sum, check) => sum + check.passed, 0),
        failedChecks: Object.values(results.checks).reduce((sum, check) => sum + check.failed, 0)
      }
    })

  } catch (error) {
    logger.error('Workflow test validation error:', error)
    return errorResponse('Failed to validate workflow', 500)
  }
}

/**
 * Validate all nodes exist in the system and have valid types
 */
async function validateNodes(nodes: any[], userId: string, supabase: any) {
  const errors: string[] = []
  let passed = 0
  let failed = 0

  for (const node of nodes) {
    const nodeType = node.data?.type || node.type

    // Find node definition
    const nodeDefinition = ALL_NODE_COMPONENTS.find(n => n.type === nodeType)

    if (!nodeDefinition) {
      errors.push(`Node "${node.data?.title || node.id}" has invalid type: ${nodeType}`)
      failed++
      continue
    }

    passed++
  }

  return {
    valid: errors.length === 0,
    passed,
    failed,
    errors
  }
}

/**
 * Validate required integrations are connected
 */
async function validateIntegrations(nodes: any[], userId: string, supabase: any) {
  const errors: string[] = []
  const warnings: string[] = []
  let passed = 0
  let failed = 0

  // Get user's connected integrations
  const { data: integrations, error: intError } = await supabase
    .from('integrations')
    .select('provider, status')
    .eq('user_id', userId)

  if (intError) {
    logger.error('Failed to fetch integrations:', intError)
    errors.push('Failed to verify integration status')
    return { valid: false, passed: 0, failed: 1, errors, warnings }
  }

  const connectedProviders = integrations
    ?.filter((i: any) => isConnectedStatus(i.status))
    .map((i: any) => i.provider) || []

  for (const node of nodes) {
    const nodeType = node.data?.type || node.type
    const nodeDefinition = ALL_NODE_COMPONENTS.find(n => n.type === nodeType)

    if (!nodeDefinition) continue

    const providerId = nodeDefinition.providerId

    // Skip nodes that don't require integrations (like AI, logic nodes)
    if (!providerId || providerId === 'system' || providerId === 'logic') {
      passed++
      continue
    }

    if (!connectedProviders.includes(providerId)) {
      errors.push(`Node "${node.data?.title || node.id}" requires ${providerId} integration to be connected`)
      failed++
    } else {
      passed++
    }
  }

  return {
    valid: errors.length === 0,
    passed,
    failed,
    errors,
    warnings
  }
}

/**
 * Validate variable references resolve to actual nodes
 */
function validateVariableReferences(nodes: any[], edges: any[]) {
  const errors: string[] = []
  const warnings: string[] = []
  let passed = 0
  let failed = 0

  // Build map of node IDs to their output schemas
  const nodeOutputs = new Map<string, any>()

  for (const node of nodes) {
    const nodeType = node.data?.type || node.type
    const nodeDefinition = ALL_NODE_COMPONENTS.find(n => n.type === nodeType)

    if (nodeDefinition?.outputSchema) {
      nodeOutputs.set(node.id, {
        outputs: nodeDefinition.outputSchema,
        title: node.data?.title || node.id
      })
    }
  }

  // Check each node's config for variable references
  for (const node of nodes) {
    const config = node.data?.config || {}

    for (const [fieldName, value] of Object.entries(config)) {
      if (typeof value !== 'string') continue

      // Find all variable references in the value
      const variableMatches = value.matchAll(/\{\{([^}]+)\}\}/g)

      for (const match of variableMatches) {
        const variableRef = match[1].trim()

        // Skip AI_FIELD references (they're valid)
        if (variableRef.startsWith('AI_FIELD:')) {
          passed++
          continue
        }

        // Parse variable reference (e.g., "trigger.email" or "nodeName.fieldName")
        const parts = variableRef.split('.')
        if (parts.length < 2) {
          warnings.push(`Malformed variable reference in ${node.data?.title || node.id}.${fieldName}: {{${variableRef}}}`)
          continue
        }

        const [sourceNodeRef, ...fieldParts] = parts
        const fieldPath = fieldParts.join('.')

        // Find the source node (could be "trigger" or a node ID)
        let sourceNode = null
        if (sourceNodeRef === 'trigger') {
          sourceNode = nodes.find(n => {
            const nodeType = n.data?.type || n.type
            const nodeDefinition = ALL_NODE_COMPONENTS.find(nd => nd.type === nodeType)
            return nodeDefinition?.isTrigger
          })
        } else {
          sourceNode = nodes.find(n => n.id === sourceNodeRef || n.data?.title === sourceNodeRef)
        }

        if (!sourceNode) {
          errors.push(`Variable reference in ${node.data?.title || node.id}.${fieldName} references non-existent node: {{${variableRef}}}`)
          failed++
          continue
        }

        // Check if the source node has outputs
        const sourceOutputs = nodeOutputs.get(sourceNode.id)
        if (!sourceOutputs) {
          warnings.push(`Variable reference in ${node.data?.title || node.id}.${fieldName} references node "${sourceOutputs?.title || sourceNodeRef}" which has no outputs`)
          continue
        }

        // Check if the field exists in outputs (simplified - doesn't check nested paths)
        const outputExists = sourceOutputs.outputs.some((output: any) =>
          fieldPath.startsWith(output.name)
        )

        if (!outputExists) {
          warnings.push(`Variable reference in ${node.data?.title || node.id}.${fieldName} references field "${fieldPath}" which may not exist in ${sourceOutputs.title} outputs`)
        }

        passed++
      }
    }
  }

  return {
    valid: errors.length === 0,
    passed,
    failed,
    errors,
    warnings
  }
}

/**
 * Validate required fields are configured
 */
function validateRequiredFields(nodes: any[]) {
  const errors: string[] = []
  const warnings: string[] = []
  let passed = 0
  let failed = 0

  for (const node of nodes) {
    const nodeType = node.data?.type || node.type
    const nodeDefinition = ALL_NODE_COMPONENTS.find(n => n.type === nodeType)

    if (!nodeDefinition?.configSchema) {
      passed++
      continue
    }

    const config = node.data?.config || {}

    for (const field of nodeDefinition.configSchema) {
      if (!field.required) continue

      const value = config[field.name]

      // Check if field has a value
      if (!value || value === '') {
        errors.push(`Required field "${field.label || field.name}" is missing in node "${node.data?.title || node.id}"`)
        failed++
        continue
      }

      // Check if it's an AI field or variable reference (both are valid)
      if (typeof value === 'string') {
        if (value.startsWith('{{AI_FIELD:') || value.startsWith('{{')) {
          passed++
          continue
        }
      }

      // Check if dynamic field is left empty (warning, not error)
      if (field.dynamic && (!value || value === '')) {
        warnings.push(`Dynamic field "${field.label || field.name}" in node "${node.data?.title || node.id}" should be selected by user`)
        continue
      }

      passed++
    }
  }

  return {
    valid: errors.length === 0,
    passed,
    failed,
    errors,
    warnings
  }
}
