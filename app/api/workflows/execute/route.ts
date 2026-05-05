import { createSupabaseRouteHandlerClient, createSupabaseServiceClient } from "@/utils/supabase/server"
import { NextRequest, NextResponse } from "next/server"
import { jsonResponse, errorResponse, successResponse } from '@/lib/utils/api-response'
import { WorkflowExecutionService } from "@/lib/services/workflowExecutionService"
import { trackBetaTesterActivity } from "@/lib/utils/beta-tester-tracking"
import { sendWorkflowErrorNotifications, extractErrorMessage } from '@/lib/notifications/errorHandler'
import { checkRateLimit, RateLimitPresets } from '@/lib/utils/rate-limit'
import { FEATURE_FLAGS } from '@/lib/featureFlags'
import { decideV2LiveDispatch } from '@/lib/execution/v2LiveExecutionDispatch'
import { runBillingGate } from '@/lib/billing/executionBillingGate'

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

    // Execute the workflow using the new service or advanced engine based on mode
    logger.info("Starting workflow execution with effectiveTestMode:", effectiveTestMode, "executionMode:", executionMode)

    // Phase 3 (PR-V2-FLAG) — staged-rollout dispatch decision.
    // Look up the workflow owner's opt-in once, compute the dispatch via the
    // pure helper, and log the decision exactly once per request. Sandbox
    // runs hit this too so the rollout dashboard sees every workflow with
    // engine attribution. On any opt-in lookup error, fall through to v1
    // (kill-switch semantics — opt-in is a positive signal, not a default).
    let userOptedIntoV2Execution = false
    if (workflow.user_id) {
      try {
        const { data: ownerProfile } = await supabase
          .from('user_profiles')
          .select('opt_in_v2_execution')
          .eq('id', workflow.user_id)
          .maybeSingle()
        userOptedIntoV2Execution = !!(ownerProfile as any)?.opt_in_v2_execution
      } catch (optInLookupError: any) {
        logger.warn('[Execute Route] opt_in_v2_execution lookup failed; defaulting to v1 dispatch', {
          workflowId,
          error: optInLookupError?.message,
        })
      }
    }

    const v2Dispatch = decideV2LiveDispatch({
      executionMode: executionMode ?? (effectiveTestMode ? 'sandbox' : 'live'),
      flagEnabled: FEATURE_FLAGS.V2_LIVE_EXECUTION,
      userOptedIn: userOptedIntoV2Execution,
    })
    logger.info('[Execute Route] Engine dispatch', {
      workflowId,
      ownerUserId: workflow.user_id,
      ...v2Dispatch.log,
    })

    // Phase 3 (PR-V2-BILLING) — billing gate.
    //
    // Route runs the gate ONLY when the run is going to v1
    // (`!v2Dispatch.useV2`). v2 self-bills inside `WorkflowExecutionService`
    // using the session UUID as the idempotency key. Sandbox / test runs
    // skip billing entirely (effectiveTestMode is true).
    //
    // The previous synthetic key `exec_${workflowId}_${Date.now()}` is
    // preserved on the v1 path to keep ledger reconciliation against
    // existing data; v2 uses real session ids.
    if (!effectiveTestMode && !v2Dispatch.useV2) {
      const actionNodes = nodes.filter((n: any) => !n.data?.isTrigger)
      const v1BillingKey = `exec_${workflowId}_${Date.now()}`
      const billingOutcome = await runBillingGate({
        workflow,
        actionNodes,
        edges,
        executionSessionId: v1BillingKey,
        retryOf,
        isTestMode: false,
        eventType: 'workflow_execution',
      })

      if (billingOutcome.kind === 'insufficient_balance') {
        return errorResponse(billingOutcome.error, 402, {
          tasksNeeded: billingOutcome.tasksNeeded,
          remaining: billingOutcome.remaining,
          ...(billingOutcome.autoBuyTriggered ? { autoBuy: { triggered: true } } : {}),
        })
      }
      if (billingOutcome.kind === 'subscription_inactive') {
        return errorResponse(billingOutcome.error, 402)
      }
      if (billingOutcome.kind === 'billing_unavailable') {
        return errorResponse(billingOutcome.error, 503)
      }
      // 'ok' or 'skipped' — proceed.
    }

    // v1 path — runs when v2 dispatch did NOT elect v2 AND this is a
    // live-eligible mode (sandbox always uses v2). PR-V2-CRON expanded
    // the predicate to include 'scheduled' (cron-driven) and 'webhook'
    // (forward-looking for direct-caller webhook ports) so non-opted-in
    // users on those modes don't fall to v2 and double-charge — the
    // route bills first, then v2 would bill again with a different key.
    const isV1EligibleMode =
      executionMode === 'live' ||
      executionMode === 'sequential' ||
      executionMode === 'scheduled' ||
      executionMode === 'webhook'
    if (isV1EligibleMode && !v2Dispatch.useV2) {
      const { AdvancedExecutionEngine } = require("@/lib/execution/advancedExecutionEngine")
      const executionEngine = new AdvancedExecutionEngine()

      // Resolve canonical billing scope for the v1 session-creation stamp.
      // PR-V2-BILLING removed the route-level scope resolution from the
      // gate (the helper now resolves internally). v1's
      // `createExecutionSession` still needs the scope object to write
      // `billing_scope_*` columns on the session row, so resolve here.
      const { resolveBillingScope } = await import('@/lib/billing/resolveBillingScope')
      const billingScope = resolveBillingScope(workflow)

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

    // v2 path — covers (a) live / sequential when the dispatch elected v2,
    // and (b) sandbox runs (existing v2 path; unaffected by flag/opt-in).
    // PR-V2-FLAG only adds case (a); case (b) is the pre-existing behavior.
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

    // Phase 3 (PR-V2-FLAG) — when the dispatch elects v2 for a live/sequential
    // run AND retryOf is present, pack it into inputData.__retryOf so v2's
    // engine resolves the retry-lineage root (Phase 2 plumbing). v2 strips
    // the field before persistence; sandbox paths see no change.
    if (v2Dispatch.useV2 && retryOf) {
      effectiveInputData = {
        ...(effectiveInputData ?? {}),
        __retryOf: retryOf,
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

    // Phase 3 (PR-V2-BILLING) — v2 self-bills inside executeWorkflow.
    // When the gate inside v2 fails, v2 returns
    //   { success: false, billingFailed: true, billingOutcome: { kind, ... } }
    // and skips all node execution. Map the outcome to the same HTTP
    // shape the route uses for v1 (402 / 503) so callers don't notice
    // which engine ran.
    if (
      executionResult &&
      typeof executionResult === 'object' &&
      (executionResult as any).billingFailed === true
    ) {
      const v2Outcome = (executionResult as any).billingOutcome
      if (v2Outcome?.kind === 'insufficient_balance') {
        return errorResponse(v2Outcome.error, 402, {
          tasksNeeded: v2Outcome.tasksNeeded,
          remaining: v2Outcome.remaining,
          ...(v2Outcome.autoBuyTriggered ? { autoBuy: { triggered: true } } : {}),
        })
      }
      if (v2Outcome?.kind === 'subscription_inactive') {
        return errorResponse(v2Outcome.error, 402)
      }
      if (v2Outcome?.kind === 'billing_unavailable') {
        return errorResponse(v2Outcome.error, 503)
      }
      // Defensive — shouldn't hit but don't 200 a billing-failed run.
      return errorResponse('Billing system temporarily unavailable. Please retry.', 503)
    }

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

    // Phase 3 (PR-V2-FLAG) — when v2 ran a live/sequential workflow, mirror
    // v1's response shape so consumers don't break. v2 returns
    // `executionId`; v1 returned `sessionId`. Spread already happened
    // above, so `sessionId` mapping + `executionMode` are added on top.
    if (v2Dispatch.useV2) {
      const v2ExecutionId = (executionResult as any)?.executionId
      if (v2ExecutionId) responsePayload.sessionId = v2ExecutionId
      responsePayload.executionMode = executionMode
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
