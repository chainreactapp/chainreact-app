import { createSupabaseRouteHandlerClient, createSupabaseServiceClient } from "@/utils/supabase/server"
import { NextRequest, NextResponse } from "next/server"
import { jsonResponse, errorResponse, successResponse } from '@/lib/utils/api-response'
import { WorkflowExecutionService } from "@/lib/services/workflowExecutionService"
import { trackBetaTesterActivity } from "@/lib/utils/beta-tester-tracking"
import { sendWorkflowErrorNotifications, extractErrorMessage } from '@/lib/notifications/errorHandler'
import { checkRateLimit, RateLimitPresets } from '@/lib/utils/rate-limit'

import { logger } from '@/lib/utils/logger'

/**
 * Generate mock trigger data for sandbox mode testing
 */
function generateMockTriggerData(triggerType: string, userId: string): any {
  const timestamp = new Date().toISOString()

  switch (triggerType) {
    case 'gmail_trigger_new_email':
      return {
        email: {
          id: `mock_email_${Date.now()}`,
          subject: 'Test Email Subject',
          from: 'test@example.com',
          to: `user-${userId}@example.com`,
          body: 'This is a test email body for workflow execution.',
          timestamp,
          labels: ['INBOX'],
          unread: true
        }
      }

    case 'gmail_trigger_new_attachment':
      return {
        email: {
          id: `mock_email_${Date.now()}`,
          subject: 'Email with Attachment',
          from: 'test@example.com',
          attachments: [
            {
              filename: 'test-document.pdf',
              mimeType: 'application/pdf',
              size: 12345
            }
          ]
        }
      }

    case 'google_calendar_trigger_new_event':
      return {
        event: {
          id: `mock_event_${Date.now()}`,
          summary: 'Test Event',
          start: timestamp,
          end: new Date(Date.now() + 3600000).toISOString(),
          attendees: ['test@example.com']
        }
      }

    case 'discord_trigger_new_message':
      return {
        message: {
          id: `mock_message_${Date.now()}`,
          content: 'Test Discord message',
          author: 'TestUser',
          channelId: 'test-channel',
          timestamp
        }
      }

    default:
      // Generic mock data for unknown trigger types
      return {
        triggered: true,
        timestamp,
        testData: true,
        message: `Mock data for ${triggerType}`
      }
  }
}

export async function POST(request: NextRequest) {
  // Rate limiting: 30 workflow executions per minute per IP
  const rateLimitResult = await checkRateLimit(request, {
    limit: 30,
    windowSeconds: 60
  })
  if (!rateLimitResult.success && rateLimitResult.response) {
    return rateLimitResult.response
  }

  try {
    logger.info("=== Workflow Execution Started (Refactored) ===")

    // Check if request has a body
    const contentLength = request.headers.get('content-length')
    logger.info(`📊 [Execute Route] Request content-length: ${contentLength}`)

    // Try to parse the JSON body with better error handling
    let body
    try {
      const text = await request.text()
      logger.info(`📊 [Execute Route] Request body text length: ${text.length}`)

      if (!text || text.length === 0) {
        throw new Error("Empty request body received")
      }

      body = JSON.parse(text)
    } catch (parseError: any) {
      logger.error("❌ [Execute Route] Failed to parse request body:", parseError)
      return errorResponse("Invalid request body", 400, {
        details: parseError.message,
        received: typeof text !== 'undefined' ? text.substring(0, 100) : 'undefined'
      })
    }

    const {
      workflowId,
      testMode = false,
      executionMode,
      inputData = {},
      workflowData,
      skipTriggers = false,
      testModeConfig, // Enhanced test mode configuration
      retryOf,        // Original execution ID when this is a retry
    } = body

    // Log the workflow data to see what nodes we're getting
    logger.info("📊 [Execute Route] Workflow data received:", {
      workflowId,
      hasWorkflowData: !!workflowData,
      nodesCount: workflowData?.nodes?.length || 0,
      nodeTypes: workflowData?.nodes?.map((n: any) => ({ id: n.id, type: n.data?.type })) || [],
      hasTestModeConfig: !!testModeConfig,
      testModeConfig
    })

    // Determine execution mode
    // - 'sandbox': Test mode with no external calls (testMode = true)
    // - 'live': Execute with real external calls (testMode = false)
    // - undefined/legacy: Use testMode as-is for backward compatibility
    const effectiveTestMode = executionMode === 'sandbox' ? true :
                             executionMode === 'live' ? false :
                             testMode

    logger.info("Execution parameters:", {
      workflowId,
      testMode,
      executionMode,
      effectiveTestMode,
      skipTriggers,
      hasInputData: !!inputData,
      hasWorkflowData: !!workflowData
    })

    if (!workflowId) {
      logger.error("No workflowId provided")
      return errorResponse("workflowId is required" , 400)
    }

    // Determine if this is a webhook request (has x-user-id header)
    const isWebhookRequest = !!request.headers.get('x-user-id')

    // Get the workflow from the database - use service client for webhooks to bypass RLS
    const supabase = isWebhookRequest
      ? await createSupabaseServiceClient()
      : await createSupabaseRouteHandlerClient()
    const { data: workflow, error: workflowError } = await supabase
      .from("workflows")
      .select("id, name, user_id, status, workspace_id, workspace_type, billing_scope_type, billing_scope_id")
      .eq("id", workflowId)
      .single()

    if (workflowError || !workflow) {
      logger.error("Error fetching workflow:", workflowError)
      return errorResponse("Workflow not found" , 404)
    }

    // Check workflow status - reject execution for inactive workflows
    if (!effectiveTestMode && workflow.status !== 'active') {
      logger.warn('[Execute Route] Workflow execution rejected - workflow not active', {
        workflowId,
        status: workflow.status,
        isWebhookRequest
      })
      return errorResponse(
        `Workflow is not active (status: ${workflow.status})`,
        400,
        { workflowId, status: workflow.status }
      )
    }

    // Load nodes and edges from normalized tables
    const [nodesResult, edgesResult] = await Promise.all([
      supabase
        .from('workflow_nodes')
        .select('*')
        .eq('workflow_id', workflowId)
        .order('display_order'),
      supabase
        .from('workflow_edges')
        .select('*')
        .eq('workflow_id', workflowId)
    ])

    const dbNodes = (nodesResult.data || []).map((n: any) => ({
      id: n.id,
      type: n.node_type,
      position: { x: n.position_x, y: n.position_y },
      data: {
        type: n.node_type,
        label: n.label,
        config: n.config || {},
        isTrigger: n.is_trigger,
        providerId: n.provider_id
      }
    }))

    const dbEdges = (edgesResult.data || []).map((e: any) => ({
      id: e.id,
      source: e.source_node_id,
      target: e.target_node_id,
      sourceHandle: e.source_port_id || 'source',
      targetHandle: e.target_port_id || 'target'
    }))

    logger.info("Workflow found:", {
      id: workflow.id,
      name: workflow.name,
      nodesCount: dbNodes.length
    })

    // ============================================================================
    // CHECK: Team suspension status
    // ============================================================================
    if (workflow.workspace_type === 'team' && workflow.workspace_id) {
      const { data: team, error: teamError } = await supabase
        .from("teams")
        .select("id, name, suspended_at, suspension_reason, grace_period_ends_at")
        .eq("id", workflow.workspace_id)
        .single()

      if (teamError) {
        logger.error("Error fetching team:", teamError)
        // Continue execution if team lookup fails - don't block workflow
      } else if (team) {
        // Check if team is suspended
        if (team.suspended_at) {
          logger.warn(`Workflow execution blocked: Team "${team.name}" is suspended (reason: ${team.suspension_reason})`)
          return errorResponse(
            `This workflow belongs to team "${team.name}" which has been suspended due to: ${team.suspension_reason}`,
            403,
            {
              suspendedAt: team.suspended_at,
              suspensionReason: team.suspension_reason,
              teamId: team.id,
              teamName: team.name
            }
          )
        }

        // Check if team is in grace period
        if (team.grace_period_ends_at && !team.suspended_at) {
          const gracePeriodEnd = new Date(team.grace_period_ends_at)
          const daysRemaining = Math.ceil((gracePeriodEnd.getTime() - Date.now()) / (1000 * 60 * 60 * 24))

          logger.warn(`Workflow executing in grace period: Team "${team.name}" has ${daysRemaining} days until suspension`)

          // Allow execution but log warning
          // In the future, we could add a warning to the execution result
        }
      }
    }

    // Get the current user - either from auth session or x-user-id header (for webhooks)
    const userIdFromHeader = request.headers.get('x-user-id')
    let userId: string

    if (userIdFromHeader) {
      // Webhook-triggered execution - use user ID from header
      logger.info("Using user ID from x-user-id header:", userIdFromHeader)
      userId = userIdFromHeader

      // Verify the user exists and owns the workflow
      if (workflow.user_id !== userId) {
        logger.error("User ID mismatch:", { headerUserId: userId, workflowUserId: workflow.user_id })
        return errorResponse("Unauthorized" , 403)
      }
    } else {
      // Normal authenticated execution
      const { data: { user }, error: userError } = await supabase.auth.getUser()
      if (userError || !user) {
        logger.error("User authentication error:", userError)
        return errorResponse("Not authenticated" , 401)
      }
      userId = user.id
    }

    logger.info("User authenticated:", userId)

    // Parse workflow data - use provided data or fall back to normalized tables
    const allNodes = workflowData?.nodes || dbNodes
    const allEdges = workflowData?.edges || dbEdges
    
    // Log Google Calendar node config if present
    const calendarNode = allNodes.find((n: any) => n.data?.type === 'google_calendar_action_create_event')
    if (calendarNode) {
      logger.info('📅 [Execute Route] Google Calendar node config received:', {
        nodeId: calendarNode.id,
        hasConfig: !!calendarNode.data?.config,
        configKeys: Object.keys(calendarNode.data?.config || {}),
        title: calendarNode.data?.config?.title,
        startDate: calendarNode.data?.config?.startDate,
        allDay: calendarNode.data?.config?.allDay
      })
    }
    
    // Log Google Sheets node config if present
    const sheetsNode = allNodes.find((n: any) => n.data?.type === 'google_sheets_unified_action')
    if (sheetsNode) {
      logger.info('📊 [Execute Route] Google Sheets node config received:', {
        nodeId: sheetsNode.id,
        hasConfig: !!sheetsNode.data?.config,
        configKeys: Object.keys(sheetsNode.data?.config || {}),
        action: sheetsNode.data?.config?.action,
        updateMapping: sheetsNode.data?.config?.updateMapping,
        rowNumber: sheetsNode.data?.config?.rowNumber,
        findRowBy: sheetsNode.data?.config?.findRowBy,
        spreadsheetId: sheetsNode.data?.config?.spreadsheetId,
        sheetName: sheetsNode.data?.config?.sheetName,
        // Delete-specific fields
        deleteRowBy: sheetsNode.data?.config?.deleteRowBy,
        deleteColumn: sheetsNode.data?.config?.deleteColumn,
        deleteValue: sheetsNode.data?.config?.deleteValue,
        deleteRowNumber: sheetsNode.data?.config?.deleteRowNumber,
        deleteAll: sheetsNode.data?.config?.deleteAll,
        confirmDelete: sheetsNode.data?.config?.confirmDelete
      })
    }
    
    // Filter out UI-only nodes (AddActionNodes, InsertActionNodes) and optionally triggers
    const nodes = allNodes.filter((node: any) => {
      // Skip UI placeholder nodes
      if (node.type === 'addAction' || node.type === 'insertAction' || node.id?.startsWith('add-action-')) {
        return false
      }
      // Skip trigger nodes if requested (for Run Once Live mode)
      if (skipTriggers && node.data?.isTrigger) {
        logger.info(`Skipping trigger node: ${node.id} (${node.data?.type})`)
        return false
      }
      return true
    })
    
    // Filter edges to only include valid nodes
    const edges = allEdges.filter((edge: any) => {
      const sourceNode = nodes.find((n: any) => n.id === edge.source)
      const targetNode = nodes.find((n: any) => n.id === edge.target)
      return sourceNode && targetNode
    })
    
    logger.info("Workflow structure:", {
      originalNodesCount: allNodes.length,
      filteredNodesCount: nodes.length,
      skippedUINodes: allNodes.length - nodes.length,
      edgesCount: edges.length,
      nodeTypes: nodes.map((n: any) => n.data?.type).filter(Boolean)
    })

    if (nodes.length === 0) {
      logger.error("No nodes found in workflow")
      return errorResponse("No nodes found in workflow" , 400)
    }

    // Find trigger nodes (unless we're skipping them)
    if (!skipTriggers) {
      const triggerNodes = nodes.filter((node: any) => node.data?.isTrigger)
      logger.info("Trigger nodes found:", triggerNodes.length)

      if (triggerNodes.length === 0) {
        logger.error("No trigger nodes found")
        return errorResponse("No trigger nodes found" , 400)
      }
    } else {
      // When skipping triggers, ensure we have at least one action node
      const actionNodes = nodes.filter((node: any) => !node.data?.isTrigger)
      logger.info("Action nodes found (triggers skipped):", actionNodes.length)

      if (actionNodes.length === 0) {
        logger.error("No action nodes found")
        return errorResponse("No action nodes found" , 400)
      }
    }

    // Billing target: resolved from canonical billing scope.
    // The authenticated userId is used for access control and audit trail only.
    const { resolveBillingScope } = await import('@/lib/billing/resolveBillingScope')
    const { scopeToBillingUser } = await import('@/lib/billing/scopeToBillingUser')
    const billingScope = resolveBillingScope(workflow)
    const billingUserId = await scopeToBillingUser(billingScope)
    logger.info('[Execute Route] Billing scope resolved', {
      workflowId,
      scopeType: billingScope.scopeType,
      scopeId: billingScope.scopeId,
      billingUserId,
    })

    // Atomic task deduction: check balance + reserve tasks in one transaction (only for live/non-test mode)
    // This replaces the old pre-check + post-deduct pattern. Tasks are reserved upfront (conservative estimation).
    let taskDeductionResult: any = null
    if (!effectiveTestMode) {
      try {
        const { deductTasksAtomic } = require('@/lib/workflows/taskDeduction')
        const actionNodes = nodes.filter((n: any) => !n.data?.isTrigger)

        if (actionNodes.length > 0) {
          const deductionSource = retryOf ? 'retry' : 'execution'
          const deductionMetadata: Record<string, unknown> = retryOf
            ? { is_retry: true, original_execution_id: retryOf }
            : {}

          taskDeductionResult = await deductTasksAtomic(
            billingUserId,
            actionNodes,
            edges,
            `exec_${workflowId}_${Date.now()}`,
            false,
            { workflowId, source: deductionSource, metadata: deductionMetadata }
          )

          if (taskDeductionResult.resultType === 'insufficient_balance' || taskDeductionResult.resultType === 'subscription_inactive') {
            logger.warn('[Execute Route] Task deduction rejected', {
              userId,
              workflowId,
              resultType: taskDeductionResult.resultType,
              error: taskDeductionResult.error
            })

            // Fire-and-forget auto-buy when feature flag is on AND user opted in.
            // Does NOT unblock the in-flight request — user retries after the webhook credits balance.
            const { FEATURE_FLAGS } = await import('@/lib/featureFlags')
            let autoBuyHint: { triggered: boolean; code?: string } | undefined
            if (FEATURE_FLAGS.TASK_PACKS && taskDeductionResult.resultType === 'insufficient_balance') {
              const { triggerAutoBuyIfEnabled } = await import('@/lib/billing/auto-buy')
              triggerAutoBuyIfEnabled(billingUserId)
                .then((result) => {
                  if (result.ok) {
                    logger.info('[Execute Route] Auto-buy succeeded after 402', {
                      userId: billingUserId,
                      newBalance: result.newBalance,
                    })
                  } else {
                    logger.warn('[Execute Route] Auto-buy did not succeed', {
                      userId: billingUserId,
                      code: result.code,
                    })
                  }
                })
                .catch((err) => {
                  logger.error('[Execute Route] Auto-buy threw unexpectedly', {
                    userId: billingUserId,
                    error: err?.message,
                  })
                })
              autoBuyHint = { triggered: true }
            }

            return errorResponse(
              taskDeductionResult.error,
              402,
              {
                tasksNeeded: taskDeductionResult.tasksDeducted || 0,
                remaining: taskDeductionResult.newBalance,
                ...(autoBuyHint ? { autoBuy: autoBuyHint } : {}),
              }
            )
          }

          if (taskDeductionResult.resultType === 'billing_unavailable') {
            logger.error('[Execute Route] Billing system unavailable', {
              userId,
              workflowId,
              error: taskDeductionResult.error
            })
            return errorResponse(
              taskDeductionResult.error,
              503
            )
          }
        }
      } catch (deductionError) {
        // Fail closed — do not allow execution if billing fails
        logger.error('[Execute Route] Task deduction failed (blocking execution)', {
          userId,
          workflowId,
          error: deductionError instanceof Error ? deductionError.message : String(deductionError)
        })
        return errorResponse('Billing system temporarily unavailable. Please retry.', 503)
      }
    }

    // Execute the workflow using the new service or advanced engine based on mode
    logger.info("Starting workflow execution with effectiveTestMode:", effectiveTestMode, "executionMode:", executionMode)

    // Use advanced execution engine for live mode to enable parallel processing
    if (executionMode === 'live' || executionMode === 'sequential') {
      const { AdvancedExecutionEngine } = require("@/lib/execution/advancedExecutionEngine")
      const executionEngine = new AdvancedExecutionEngine()

      // Create execution session — stamp with canonical billing scope and
      // (PR-R1a) retry-lineage root + workflow definition hash for resume.
      const executionSession = await executionEngine.createExecutionSession(
        workflowId,
        userId,
        "manual",
        {
          inputData,
          executionMode,
          workflowData: workflowData || workflow,
          billingScope,
          retryOf,  // PR-R1a — engine resolves root_execution_id from the original
        }
      )

      // Execute with parallel or sequential based on mode
      const executionResult = await executionEngine.executeWorkflowAdvanced(
        executionSession.id,
        inputData,
        {
          enableParallel: executionMode === 'live', // Parallel for live, sequential for debug
          maxConcurrency: executionMode === 'live' ? 5 : 1, // 5 parallel nodes for live, 1 for sequential
          enableSubWorkflows: true,
          testMode: false // Live mode uses real actions
        }
      )

      const isPaused = typeof executionResult === 'object' && executionResult !== null && 'paused' in executionResult && (executionResult as any).paused

      logger.info("Advanced workflow execution completed", {
        paused: !!isPaused,
        executionMode,
        sessionId: executionSession.id
      })

      const advancedResponsePayload: Record<string, any> = {
        success: true,
        executionTime: new Date().toISOString(),
        sessionId: executionSession.id,
        executionMode
      }

      if (executionResult !== undefined && executionResult !== null) {
        if (typeof executionResult === 'object' && !Array.isArray(executionResult)) {
          Object.assign(advancedResponsePayload, executionResult)
        } else {
          advancedResponsePayload.results = executionResult
        }
      }

      return jsonResponse(advancedResponsePayload)
    }

    // Use standard service for sandbox mode (intercepted actions)
    const workflowExecutionService = new WorkflowExecutionService()

    // Pass filtered workflow data with correct property names
    const filteredWorkflowData = workflowData ? {
      ...workflowData,
      nodes: nodes,
      edges: edges,
      connections: edges // Some parts of the code use 'connections' instead of 'edges'
    } : null

    // Generate mock trigger data when in sandbox mode with skipTriggers
    let effectiveInputData = inputData
    if (effectiveTestMode && skipTriggers && (!inputData || Object.keys(inputData).length === 0)) {
      // Find the trigger node that was skipped to determine what mock data to provide
      const triggerNode = allNodes.find((n: any) => n.data?.isTrigger)
      if (triggerNode) {
        logger.info('📦 Generating mock trigger data for:', triggerNode.data?.type)
        effectiveInputData = generateMockTriggerData(triggerNode.data?.type, userId)
      }
    }

    const executionResult = await workflowExecutionService.executeWorkflow(
      workflow,
      effectiveInputData,
      userId,
      effectiveTestMode,
      filteredWorkflowData,
      skipTriggers,
      testModeConfig // Pass enhanced test mode config
    )

    const isPaused = typeof executionResult === 'object' && executionResult !== null && 'paused' in executionResult && (executionResult as any).paused

    if (isPaused) {
      logger.info("Workflow execution paused for human input", {
        workflowId,
        executionId: (executionResult as any).executionId,
        pausedNodeId: (executionResult as any).pausedNodeId,
        conversationId: (executionResult as any).conversationId
      })
    } else {
      logger.info("Workflow execution completed successfully")
    }

    const responsePayload: Record<string, any> = {
      success: true,
      executionTime: new Date().toISOString()
    }

    if (executionResult !== undefined && executionResult !== null) {
      if (typeof executionResult === 'object' && !Array.isArray(executionResult)) {
        Object.assign(responsePayload, executionResult)
      } else {
        responsePayload.results = executionResult
      }
    }

    // Track beta tester activity
    await trackBetaTesterActivity({
      userId: userId,
      activityType: 'workflow_executed',
      activityData: {
        workflowId: workflow.id,
        workflowName: workflow.name,
        testMode: effectiveTestMode,
        executionMode
      }
    })

    // Check if we have intercepted actions (sandbox mode)
    if (executionResult && typeof executionResult === 'object' && 'interceptedActions' in executionResult) {
      logger.info(`Returning ${executionResult.interceptedActions.length} intercepted actions to frontend`)
      responsePayload.results = executionResult.results
      responsePayload.interceptedActions = executionResult.interceptedActions
      return jsonResponse(responsePayload)
    }

    return jsonResponse(responsePayload)

  } catch (error: any) {
    logger.error("Workflow execution error:", {
      message: error.message,
      stack: error.stack,
      name: error.name
    })

    // Send error notifications if workflow is available
    try {
      // Try to get workflow data from earlier in the function scope
      // Note: This assumes 'workflow' variable is accessible here
      // If not in scope, we'd need to refetch or restructure
      const supabase = await createSupabaseRouteHandlerClient()
      const { data: workflowForNotification } = await supabase
        .from("workflows")
        .select("*")
        .eq("id", (error as any).workflowId || body?.workflowId)
        .single()

      if (workflowForNotification) {
        // Send error notifications asynchronously (don't block the error response)
        sendWorkflowErrorNotifications(
          workflowForNotification,
          {
            message: extractErrorMessage(error),
            stack: error.stack,
            executionId: (error as any).executionId
          }
        ).catch((notifError) => {
          logger.error('Failed to send error notifications:', notifError)
        })
      }
    } catch (notificationError) {
      // Don't let notification failures prevent error response
      logger.error('Error while attempting to send notifications:', notificationError)
    }

    // Return more detailed error information
    return errorResponse(error.message || "Workflow execution failed", 500, {
        details: error.stack,
        message: error.message
      })
  }
}
