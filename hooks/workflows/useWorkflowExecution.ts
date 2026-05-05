import { useState, useCallback, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { useToast } from '@/hooks/use-toast'
import { useWorkflowStore } from '@/stores/workflowStore'
import { useWorkflowTestStore } from '@/stores/workflowTestStore'
import { useWorkflowErrorStore } from '@/stores/workflowErrorStore'
import { supabase } from '@/utils/supabaseClient'

import { logger } from '@/lib/utils/logger'
import type { Node, Edge } from '@xyflow/react'
import type { WorkflowNode } from '@/stores/workflowStore'

export interface ExecutionResult {
  status: 'pending' | 'running' | 'completed' | 'error'
  timestamp: number
  error?: string
}

export function useWorkflowExecution() {
  const router = useRouter()
  const { toast } = useToast()
  const { currentWorkflow, updateWorkflow } = useWorkflowStore()
  const { setTestResults } = useWorkflowTestStore()
  const { addError, clearErrorsForWorkflow } = useWorkflowErrorStore()

  const [isExecuting, setIsExecuting] = useState(false)
  const [activeExecutionNodeId, setActiveExecutionNodeId] = useState<string | null>(null)
  const [executionResults, setExecutionResults] = useState<Record<string, ExecutionResult>>({})

  // Step execution states
  const [isStepMode, setIsStepMode] = useState(false)
  const [isStepByStep, setIsStepByStep] = useState(false)
  const [isPaused, setIsPaused] = useState(false)
  const [currentNodeId, setCurrentNodeId] = useState<string | null>(null)
  const [nodeStatuses, setNodeStatuses] = useState<Record<string, 'pending' | 'running' | 'completed' | 'error'>>({})
  const [stepContinueCallback, setStepContinueCallback] = useState<(() => void) | null>(null)
  const [skipCallback, setSkipCallback] = useState<(() => void) | null>(null)

  // Webhook listening states
  const [isListeningForWebhook, setIsListeningForWebhook] = useState(false)
  const [webhookTriggerType, setWebhookTriggerType] = useState<string | null>(null)
  const [usingTestData, setUsingTestData] = useState(false)
  const [testDataNodes, setTestDataNodes] = useState<Set<string>>(new Set())
  const [sessionId, setSessionId] = useState<string | null>(null)
  const [sessionUserId, setSessionUserId] = useState<string | null>(null)
  const [pollIntervalId, setPollIntervalId] = useState<NodeJS.Timeout | null>(null)

  // Sandbox mode states
  const [sandboxInterceptedActions, setSandboxInterceptedActions] = useState<any[]>([])
  const [showSandboxPreview, setShowSandboxPreview] = useState(false)
  const [testModeDialogOpen, setTestModeDialogOpen] = useState(false)
  const [isExecutingTest, setIsExecutingTest] = useState(false)

  // Add debug log helper
  const addDebugLog = useCallback((level: 'info' | 'warning' | 'error' | 'success', message: string, details?: any) => {
    if (typeof window !== 'undefined' && (window as any).addTestModeDebugLog) {
      (window as any).addTestModeDebugLog({ level, message, details })
    }
  }, [])

  // Function to execute workflow via API
  const executeWorkflow = useCallback(async (
    workflowId: string,
    options?: {
      onNodeStart?: (nodeId: string) => void
      onNodeComplete?: (nodeId: string) => void
      onNodeError?: (nodeId: string, error: string) => void
      testMode?: boolean
      executionMode?: 'sandbox' | 'live'
    }
  ) => {
    try {
      const response = await fetch('/api/workflows/execute', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          workflowId,
          testMode: options?.testMode ?? false,
          executionMode: options?.executionMode ?? 'live',
          inputData: {},
        }),
      })

      if (!response.ok) {
        const error = await response.json()
        throw new Error(error.error || 'Failed to execute workflow')
      }

      const result = await response.json()

      // Handle callbacks if provided
      if (result.results && Array.isArray(result.results)) {
        result.results.forEach((nodeResult: any) => {
          if (nodeResult.success) {
            options?.onNodeComplete?.(nodeResult.nodeId)
          } else {
            options?.onNodeError?.(nodeResult.nodeId, nodeResult.error || 'Unknown error')
          }
        })
      }

      return result
    } catch (error) {
      logger.error('Error executing workflow:', error)
      throw error
    }
  }, [])

  const handleExecute = useCallback(async (
    nodes: Node[],
    edges: Edge[],
    onNodesUpdate?: (nodeUpdates: Array<{ nodeId: string; resultMessage: string }>) => void
  ) => {
    // Prevent duplicate executions
    if (isExecuting) {
      logger.info('⚠️ [Workflow Execution] Already executing, ignoring duplicate request');
      return
    }

    // Validate workflow is saved
    if (!currentWorkflow?.id) {
      toast({
        title: "Error",
        description: "Please save your workflow first",
        variant: "destructive",
      })
      return
    }

    // Validate nodes are loaded
    if (!nodes || nodes.length === 0) {
      toast({
        title: "Error",
        description: "Workflow nodes not loaded yet, please wait a moment",
        variant: "destructive",
      })
      return
    }

    // Validate trigger exists
    const triggerNode = nodes.find(n => n.data?.isTrigger)
    if (!triggerNode) {
      toast({
        title: "Error",
        description: "Please add a trigger node first",
        variant: "destructive",
      })
      return
    }

    // Validate trigger is configured
    const hasConfiguration = triggerNode.data?.config && Object.keys(triggerNode.data.config).length > 0
    if (!hasConfiguration) {
      toast({
        title: "Error",
        description: "Please configure your trigger node first",
        variant: "destructive",
      })
      return
    }

    let pausedDuringExecution = false

    try {
      setIsExecuting(true)
      logger.info('🚀 [Workflow Execution] Starting execution for workflow:', currentWorkflow.id);
      clearErrorsForWorkflow(currentWorkflow.id)

      const resetResults: Record<string, ExecutionResult> = {}
      nodes.forEach(node => {
        if (node.data?.nodeComponent) {
          resetResults[node.id] = {
            status: 'pending',
            timestamp: Date.now()
          }
        }
      })
      setExecutionResults(resetResults)

      // Note: Workflow is already saved when user clicks Save button
      // No need to save again before execution - just execute with current workflow state
      logger.info('🚀 [Workflow Execution] Starting execution (using saved workflow from database)...');

      const executionResults = await executeWorkflow(currentWorkflow.id, {
        executionMode: 'live',
        onNodeStart: (nodeId: string) => {
          setActiveExecutionNodeId(nodeId)
          setExecutionResults(prev => ({
            ...prev,
            [nodeId]: {
              status: 'running',
              timestamp: Date.now()
            }
          }))
        },
        onNodeComplete: (nodeId: string) => {
          setExecutionResults(prev => ({
            ...prev,
            [nodeId]: {
              status: 'completed',
              timestamp: Date.now()
            }
          }))
        },
        onNodeError: (nodeId: string, error: string) => {
          const node = nodes.find(n => n.id === nodeId)
          addError({
            workflowId: currentWorkflow.id,
            nodeId: nodeId,
            nodeName: node?.data?.title || node?.data?.type || 'Unknown Node',
            errorMessage: error,
            timestamp: new Date().toISOString(),
            executionSessionId: `session-${Date.now()}`
          })
          setExecutionResults(prev => ({
            ...prev,
            [nodeId]: {
              status: 'error',
              error,
              timestamp: Date.now()
            }
          }))
        },
      })

      if (executionResults?.paused) {
        pausedDuringExecution = true

        if (executionResults.pausedNodeId) {
          setActiveExecutionNodeId(executionResults.pausedNodeId)
          setExecutionResults(prev => ({
            ...prev,
            [executionResults.pausedNodeId!]: {
              status: 'running',
              timestamp: Date.now()
            }
          }))
        }

        setIsPaused(true)
        setIsExecuting(false)

        toast({
          title: "⏸️ Workflow Paused",
          description: "Waiting for human approval in your connected channel.",
        })
      } else if (executionResults?.success) {
        toast({
          title: "Success",
          description: "Workflow executed successfully!",
        })

        // Fetch execution steps to get result messages for nodes
        if (executionResults.executionHistoryId && onNodesUpdate) {
          try {
            const stepsResponse = await fetch(`/api/workflows/history/${executionResults.executionHistoryId}/steps`)
            if (stepsResponse.ok) {
              const stepsData = await stepsResponse.json()
              const nodeUpdates = stepsData.steps
                .filter((step: any) => step.output_data?.message)
                .map((step: any) => ({
                  nodeId: step.node_id,
                  resultMessage: step.output_data.message
                }))

              if (nodeUpdates.length > 0) {
                logger.info(`📨 Updating ${nodeUpdates.length} nodes with result messages`)
                onNodesUpdate(nodeUpdates)
              }
            }
          } catch (error) {
            logger.error('Failed to fetch execution steps for result messages:', error)
          }
        }

        if (executionResults.executionId) {
          setTimeout(() => {
            router.push(`/executions/${executionResults.executionId}`)
          }, 1500)
        }
      } else {
        toast({
          title: "Execution Failed",
          description: executionResults?.error || "An error occurred during execution",
          variant: "destructive",
        })
      }
    } catch (error) {
      logger.error('Error executing workflow:', error)
      toast({
        title: "Error",
        description: "Failed to execute workflow",
        variant: "destructive",
      })
    } finally {
      if (pausedDuringExecution) {
        return
      }

      setIsExecuting(false)
      setActiveExecutionNodeId(null)

      setTimeout(() => {
        setExecutionResults({})
      }, 5000)
    }
  }, [currentWorkflow, updateWorkflow, executeWorkflow, clearErrorsForWorkflow, addError, toast, router, isExecuting])

  const handleResetLoadingStates = useCallback(() => {
    setIsExecuting(false)
    setActiveExecutionNodeId(null)
    setExecutionResults({})
    setIsStepMode(false)
    setIsStepByStep(false)
    setIsPaused(false)
    setCurrentNodeId(null)
    setNodeStatuses({})
    setStepContinueCallback(null)
    setSkipCallback(null)
  }, [])

  const handleTestSandbox = useCallback(async (nodes: Node[], edges: Edge[]) => {
    console.log('🧪 [Sandbox Mode] handleTestSandbox called', {
      hasWorkflow: !!currentWorkflow?.id,
      nodeCount: nodes?.length || 0,
      testModeDialogOpen,
      currentWorkflow
    })

    // If already in test mode, reset it
    if (isStepMode || isExecuting) {
      console.log('🧪 [Sandbox Mode] Resetting test mode')
      setIsExecuting(false)
      setIsStepMode(false)
      setActiveExecutionNodeId(null)
      setSandboxInterceptedActions([])
      setShowSandboxPreview(false)
      return
    }

    // Validate workflow is saved
    if (!currentWorkflow?.id) {
      console.warn('⚠️ [Sandbox Mode] No workflow ID')
      toast({
        title: "Error",
        description: "Please save your workflow first",
        variant: "destructive",
      })
      return
    }

    // Validate nodes are loaded
    if (!nodes || nodes.length === 0) {
      console.warn('⚠️ [Sandbox Mode] No nodes in workflow')
      toast({
        title: "Error",
        description: "No nodes found in workflow",
        variant: "destructive",
      })
      return
    }

    // Open the test mode configuration dialog instead of executing immediately
    console.log('🧪 [Sandbox Mode] Opening test mode configuration dialog')
    setTestModeDialogOpen(true)
    console.log('🧪 [Sandbox Mode] Dialog state set to true')
  }, [currentWorkflow, toast, testModeDialogOpen, isStepMode, isExecuting])

  // Monitor execution progress from webhook trigger
  const monitorExecution = useCallback(async (executionId: string, nodes: Node[]) => {
    setIsExecuting(true)
    addDebugLog('info', `Started monitoring execution ${executionId}`)

    let lastLogTimestamp: string | null = null

    const interval = setInterval(async () => {
      try {
        const url = lastLogTimestamp
          ? `/api/workflows/${currentWorkflow?.id}/execution-status/${executionId}?lastLogTimestamp=${lastLogTimestamp}`
          : `/api/workflows/${currentWorkflow?.id}/execution-status/${executionId}`

        const response = await fetch(url)

        if (!response.ok) {
          addDebugLog('error', `Failed to fetch execution status: ${response.status}`)
          return
        }

        const data = await response.json()
        const progress = data.progress

        // Process backend logs if available
        if (data.backendLogs && Array.isArray(data.backendLogs)) {
          data.backendLogs.forEach((log: any) => {
            addDebugLog(log.level, `[Backend] ${log.message}`, log.details)
            // Update last log timestamp for incremental fetching
            lastLogTimestamp = log.timestamp
          })
        }

        addDebugLog('info', `Execution progress update`, {
          status: progress.status,
          currentNodeId: progress.currentNodeId,
          completedNodes: progress.completedNodes,
          failedNodes: progress.failedNodes
        })

        // Update current executing node
        if (progress.currentNodeId) {
          setActiveExecutionNodeId(progress.currentNodeId)
          setNodeStatuses(prev => ({
            ...prev,
            [progress.currentNodeId]: 'running'
          }))

          // Special handling for AI agent nodes - show which chain is active
          const currentNode = nodes.find(n => n.id === progress.currentNodeId)
          if (currentNode?.data?.type === 'ai_agent') {
            addDebugLog('info', `AI Agent node executing: ${currentNode.data.title}`, {
              nodeId: progress.currentNodeId,
              chains: currentNode.data.config?.chains
            })
          }
        }

        // Update completed nodes
        progress.completedNodes.forEach((nodeId: string) => {
          setNodeStatuses(prev => ({
            ...prev,
            [nodeId]: 'completed'
          }))

          const node = nodes.find(n => n.id === nodeId)
          addDebugLog('success', `Node completed: ${node?.data?.title || nodeId}`)
        })

        // Update failed nodes
        progress.failedNodes.forEach((failed: { nodeId: string; error: string }) => {
          setNodeStatuses(prev => ({
            ...prev,
            [failed.nodeId]: 'error'
          }))

          const node = nodes.find(n => n.id === failed.nodeId)
          addDebugLog('error', `Node failed: ${node?.data?.title || failed.nodeId}`, {
            error: failed.error
          })

          addError({
            workflowId: currentWorkflow?.id || '',
            nodeId: failed.nodeId,
            nodeName: node?.data?.title || node?.data?.type || 'Unknown Node',
            errorMessage: failed.error,
            timestamp: new Date().toISOString(),
            executionSessionId: executionId
          })
        })

        // Check if execution completed
        if (progress.status === 'completed' || progress.status === 'failed') {
          clearInterval(interval)
          setIsExecuting(false)
          setActiveExecutionNodeId(null)

          addDebugLog(
            progress.status === 'completed' ? 'success' : 'error',
            `Execution ${progress.status}`,
            { executionId, totalNodes: nodes.length, completedNodes: progress.completedNodes.length }
          )

          // Unregister webhook after execution completes
          if (currentWorkflow?.id) {
            try {
              await fetch(`/api/workflows/${currentWorkflow.id}/test-session`, {
                method: 'DELETE',
              })
              logger.info('✅ Webhook unregistered after execution completed')
            } catch (error) {
              logger.error('Failed to unregister webhook after execution:', error)
              // Don't show error to user - best effort cleanup
            }
          }

          toast({
            title: progress.status === 'completed' ? "Success" : "Execution Failed",
            description: progress.status === 'completed'
              ? "Workflow executed successfully with real webhook data!"
              : progress.errorMessage || "An error occurred during execution",
            variant: progress.status === 'completed' ? "default" : "destructive",
          })

          // Reset after delay
          setTimeout(() => {
            setNodeStatuses({})
          }, 5000)
        }
      } catch (error) {
        logger.error('Error monitoring execution:', error)
      }
    }, 1000)

  }, [currentWorkflow, toast, addError, addDebugLog])

  const handleRunTest = useCallback(async (nodes: Node[], edges: Edge[], testModeConfig: any, mockVariation?: string) => {
    // Prevent duplicate executions
    if (isExecutingTest) {
      logger.info('⚠️ [Sandbox Mode] Already executing, ignoring duplicate request');
      return
    }

    // Close the test mode dialog immediately
    setTestModeDialogOpen(false)

    setIsExecutingTest(true)
    setIsExecuting(true)
    setIsStepMode(true)
    setSandboxInterceptedActions([])
    addDebugLog('info', 'Starting Sandbox Mode execution with test config', testModeConfig)

    let pausedDuringRun = false

    try {
      logger.info('🧪 [Sandbox Mode] Starting execution with test mode config:', testModeConfig)

      // Check if we need to wait for real trigger
      if (testModeConfig.triggerMode === 'wait_for_real') {
        logger.info('🎯 [Sandbox Mode] Using WAIT_FOR_REAL mode - starting test session')
        addDebugLog('info', 'Activating trigger and waiting for real event...', {
          timeout: testModeConfig.triggerTimeout || 300000
        })

        // Start test session - this activates the trigger and creates a "listening" session
        const sessionResponse = await fetch(`/api/workflows/${currentWorkflow.id}/test-session`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            testModeConfig,
            timeout: testModeConfig.triggerTimeout || 300000
          }),
        })

        if (!sessionResponse.ok) {
          const error = await sessionResponse.json()
          throw new Error(error.error || 'Failed to start test session')
        }

        const sessionData = await sessionResponse.json()
        const { sessionId } = sessionData

        addDebugLog('success', 'Trigger activated - waiting for event', {
          sessionId,
          triggerType: sessionData.triggerType
        })

        toast({
          title: "Waiting for Trigger",
          description: `Listening for ${sessionData.triggerType}. Perform the action to trigger your workflow.`,
        })

        // Poll for session status updates
        const pollInterval = 2000 // Poll every 2 seconds
        const maxPolls = Math.floor((testModeConfig.triggerTimeout || 300000) / pollInterval)
        let pollCount = 0

        const checkSession = async (): Promise<boolean> => {
          try {
            const statusResponse = await fetch(`/api/workflows/${currentWorkflow.id}/test-session`)

            if (!statusResponse.ok) {
              throw new Error('Failed to check session status')
            }

            const statusData = await statusResponse.json()

            if (!statusData.active) {
              if (statusData.session?.status === 'expired') {
                throw new Error('Test session timed out waiting for trigger')
              }
              return false
            }

            const { session, execution } = statusData

            // Check if execution started
            if (session.status === 'executing' && session.execution_id) {
              addDebugLog('success', 'Trigger fired! Workflow execution started')

              // Monitor the execution progress
              await monitorExecution(session.execution_id, nodes)
              return true
            }

            // Still listening
            pollCount++
            const remainingTime = Math.floor((maxPolls - pollCount) * pollInterval / 1000)
            if (pollCount % 15 === 0) { // Log every 30 seconds
              addDebugLog('info', `Still waiting for trigger... (${remainingTime}s remaining)`)
            }

            if (pollCount < maxPolls) {
              setTimeout(() => checkSession(), pollInterval)
            } else {
              throw new Error('Test session timed out waiting for trigger')
            }

            return false
          } catch (error: any) {
            logger.error('❌ [Sandbox Mode] Session polling error:', error)
            throw error
          }
        }

        // Start polling
        await checkSession()
        return
      }

      // USE_MOCK_DATA mode - execute immediately with mock data
      logger.info('🧪 [Sandbox Mode] Using mock data mode')

      // Simulate node execution visually by processing nodes in order
      const triggerNode = nodes.find(n => n.data?.isTrigger)
      if (triggerNode) {
        addDebugLog('info', `Starting trigger node: ${triggerNode.data?.title || triggerNode.data?.type}`)
        setActiveExecutionNodeId(triggerNode.id)
        setNodeStatuses(prev => ({ ...prev, [triggerNode.id]: 'running' }))
        await new Promise(resolve => setTimeout(resolve, 500)) // Visual delay
      }

      const response = await fetch('/api/workflows/execute', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          workflowId: currentWorkflow.id,
          testMode: true,  // This ensures actions are intercepted
          testModeConfig,  // Pass the test mode configuration
          mockVariation,   // Optional mock data variation
          executionMode: 'sandbox',
          inputData: {},
          workflowData: {
            nodes,
            edges,
          },
          skipTriggers: testModeConfig.triggerMode === 'use_mock_data', // Only skip if using mock data
        }),
      })

      if (!response.ok) {
        const error = await response.json()
        throw new Error(error.error || 'Failed to execute workflow')
      }

      const result = await response.json()

      // CHECK FOR PAUSED EXECUTION FIRST (before processing results)
      // This prevents the visual feedback loop from marking the HITL node as "completed"
      if (result.paused) {
        pausedDuringRun = true
        addDebugLog('info', '⏸️ Workflow paused for human input', {
          conversationId: result.conversationId,
          pausedNodeId: result.pausedNodeId
        })

        // Mark trigger as completed (if exists)
        if (triggerNode) {
          setNodeStatuses(prev => ({ ...prev, [triggerNode.id]: 'completed' }))
        }

        // Set the paused node to "running" status (actively waiting)
        if (result.pausedNodeId) {
          setNodeStatuses(prev => ({
            ...prev,
            [result.pausedNodeId]: 'running' // Keep showing as active/running while waiting
          }))
          setActiveExecutionNodeId(result.pausedNodeId)

          const pausedNode = nodes.find(n => n.id === result.pausedNodeId)
          addDebugLog('info', `⏸️ Waiting for human input at: ${pausedNode?.data?.title || 'HITL Node'}`)
        }

        toast({
          title: "⏸️ Workflow Paused",
          description: "Human input required. Check your Discord channel to continue.",
        })

        // Set executing to false but keep the paused state visible
        setIsExecuting(false)
        setIsStepMode(false)
        setIsExecutingTest(false)
        setIsPaused(true)

        // Don't clear the node status or active node - keep them visible
      } else {
        // Normal completion flow (only runs if NOT paused)

        // Mark trigger as completed
        if (triggerNode) {
          setNodeStatuses(prev => ({ ...prev, [triggerNode.id]: 'completed' }))
          addDebugLog('success', `Trigger completed: ${triggerNode.data?.title || triggerNode.data?.type}`)
        }

        // Process results with visual feedback for each node
        if (result.results && Array.isArray(result.results)) {
          for (const nodeResult of result.results) {
            if (nodeResult.nodeId) {
              const node = nodes.find(n => n.id === nodeResult.nodeId)
              if (node) {
                // Show node as running
                setActiveExecutionNodeId(nodeResult.nodeId)
                setNodeStatuses(prev => ({ ...prev, [nodeResult.nodeId]: 'running' }))
                addDebugLog('info', `Executing: ${node.data?.title || node.data?.type}`)

                // Visual delay to show the transition
                await new Promise(resolve => setTimeout(resolve, 400))

                // Update to final status
                const status = nodeResult.success ? 'completed' : 'error'
                setNodeStatuses(prev => ({ ...prev, [nodeResult.nodeId]: status }))
                addDebugLog(
                  nodeResult.success ? 'success' : 'error',
                  `${node.data?.title || node.data?.type} ${nodeResult.success ? 'completed' : 'failed'}`,
                  nodeResult.error ? { error: nodeResult.error } : undefined
                )
              }
            }
          }
        }

        setActiveExecutionNodeId(null)

        // Process intercepted actions
        if (result.interceptedActions && Array.isArray(result.interceptedActions)) {
          setSandboxInterceptedActions(result.interceptedActions)
          setShowSandboxPreview(true)

          addDebugLog('success', `Sandbox execution complete: ${result.interceptedActions.length} actions intercepted`)

          toast({
            title: "Sandbox Test Complete",
            description: `${result.interceptedActions.length} actions were intercepted and can be reviewed`,
          })
        }
      }

    } catch (error: any) {
      logger.error('❌ [Sandbox Mode] Execution error:', error)
      addDebugLog('error', 'Sandbox execution failed', { error: error.message })

      toast({
        title: "Sandbox Test Failed",
        description: error.message || "Failed to execute workflow in sandbox mode",
        variant: "destructive",
      })
    } finally {
      if (pausedDuringRun) {
        return
      }

      setIsExecuting(false)
      setIsStepMode(false)
      setIsExecutingTest(false)
      setActiveExecutionNodeId(null)

      // Clear node statuses after delay
      setTimeout(() => {
        setNodeStatuses({})
      }, 5000)
    }
  }, [isExecutingTest, currentWorkflow, toast, addDebugLog, monitorExecution])

  // Start listening for webhook trigger
  const startWebhookListening = useCallback(async (nodes: Node[]) => {
    addDebugLog('info', 'Starting webhook listening mode')

    if (!currentWorkflow?.id) {
      toast({
        title: "Error",
        description: "Please save your workflow first",
        variant: "destructive",
      })
      addDebugLog('error', 'Cannot start webhook listening - workflow not saved')
      return
    }

    // Find trigger node
    const triggerNode = nodes.find(n => n.data?.isTrigger)
    if (!triggerNode) {
      toast({
        title: "Error",
        description: "Please add a trigger node first",
        variant: "destructive",
      })
      return
    }

    const triggerType = triggerNode.data?.type

    // Check if this is a webhook-based trigger
    const webhookTriggers = [
      'gmail_trigger_new_email',
      'airtable_trigger_new_record',
      'airtable_trigger_record_updated',
      'github_trigger_new_issue',
      'github_trigger_pr_updated',
      'slack_trigger_new_message',
      'discord_trigger_new_message',
      'trello_trigger_card_moved',
    ]

    if (!webhookTriggers.includes(triggerType)) {
      // Not a webhook trigger, just execute immediately with test data
      return handleExecute(nodes, [])
    }

    try {
      // PR-AUTH-5: cached user id.
      const { useAuthStore } = await import('@/stores/authStore')
      const user = useAuthStore.getState().user
      if (!user) {
        toast({
          title: "Error",
          description: "Not authenticated",
          variant: "destructive",
        })
        return
      }

      // Register webhook and start test session
      const response = await fetch(`/api/workflows/${currentWorkflow.id}/test-session`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
      })

      if (!response.ok) {
        const error = await response.json()
        throw new Error(error.error || 'Failed to start test session')
      }

      const data = await response.json()
      const newSessionId = data.sessionId

      addDebugLog('success', 'Webhook registered successfully', {
        sessionId: newSessionId,
        triggerType,
        workflowId: currentWorkflow.id
      })

      // Set listening state
      setIsListeningForWebhook(true)
      setWebhookTriggerType(triggerType)
      setUsingTestData(false)
      setTestDataNodes(new Set())
      setSessionId(newSessionId)
      setSessionUserId(user.id)

      toast({
        title: "Live Test Mode",
        description: `Waiting for ${triggerType.replace(/_/g, ' ')}... Click "Skip" to use test data.`,
        duration: 10000,
      })

      // Start polling for webhook arrival
      const pollInterval = setInterval(async () => {
        try {
          const statusResponse = await fetch(`/api/workflows/${currentWorkflow.id}/test-session`)

          // Handle 401 Unauthorized - session expired
          if (statusResponse.status === 401) {
            logger.info('Session expired, stopping webhook listener')
            clearInterval(pollInterval)
            setPollIntervalId(null)
            setIsListeningForWebhook(false)
            setWebhookTriggerType(null)
            setSessionId(null)
            setSessionUserId(null)
            toast({
              title: "Session Expired",
              description: "Please refresh the page and try again",
              variant: "destructive",
            })
            return
          }

          if (!statusResponse.ok) {
            logger.warn('Failed to fetch test session status')
            return
          }

          const statusData = await statusResponse.json()

          if (!statusData.active) {
            // Session ended or expired
            clearInterval(pollInterval)
            setPollIntervalId(null)
            setIsListeningForWebhook(false)
            return
          }

          // Check if webhook was received and execution started
          if (statusData.session?.status === 'executing' && statusData.session?.execution_id) {
            addDebugLog('success', 'Webhook received! Starting execution', {
              executionId: statusData.session.execution_id,
              sessionStatus: statusData.session.status
            })

            clearInterval(pollInterval)
            setPollIntervalId(null)
            setIsListeningForWebhook(false)
            setIsExecuting(true)

            toast({
              title: "Webhook Received!",
              description: "Executing workflow with real webhook data...",
            })

            // Monitor the execution progress
            await monitorExecution(statusData.session.execution_id, nodes)
          } else {
            // Log polling status
            addDebugLog('info', 'Polling for webhook...', {
              sessionActive: statusData.active,
              sessionStatus: statusData.session?.status
            })
          }
        } catch (error) {
          logger.error('Error polling test session:', error)
        }
      }, 2000) // Poll every 2 seconds

      setPollIntervalId(pollInterval)

    } catch (error: any) {
      logger.error('Failed to start webhook listening:', error)
      toast({
        title: "Error",
        description: error.message || "Failed to start webhook listener",
        variant: "destructive",
      })
    }
  }, [currentWorkflow, toast, handleExecute, monitorExecution, supabase, addDebugLog])

  // Stop webhook listening
  const stopWebhookListening = useCallback(async () => {
    // Clear polling interval if active
    if (pollIntervalId) {
      clearInterval(pollIntervalId)
      setPollIntervalId(null)
    }

    // Unregister webhook via API if we have an active session
    if (currentWorkflow?.id && sessionId) {
      try {
        await fetch(`/api/workflows/${currentWorkflow.id}/test-session`, {
          method: 'DELETE',
        })
        logger.info('✅ Webhook unregistered successfully')
      } catch (error) {
        logger.error('Failed to unregister webhook:', error)
        // Don't show error to user - best effort cleanup
      }
    }

    // Clear all execution states and node coloring
    setIsListeningForWebhook(false)
    setWebhookTriggerType(null)
    setSessionId(null)
    setSessionUserId(null)
    setIsExecuting(false)
    setActiveExecutionNodeId(null)
    setNodeStatuses({})
    setExecutionResults({})

    toast({
      title: "Stopped listening",
      description: "Live test mode cancelled",
    })
  }, [toast, currentWorkflow, sessionId, pollIntervalId])

  // Generate realistic test data based on trigger type
  const generateTestData = (triggerType: string) => {
    switch (triggerType) {
      case 'gmail_trigger_new_email':
        return {
          from: 'customer@example.com',
          to: 'you@company.com',
          subject: 'Question about pricing',
          content: 'Hi, I was wondering about your pricing plans. Can you help me understand the differences between Pro and Business tiers?',
          timestamp: new Date().toISOString(),
          messageId: `test-msg-${Date.now()}`,
          hasAttachments: false
        }

      case 'airtable_trigger_new_record':
      case 'airtable_trigger_record_updated':
        return {
          recordId: `test-rec-${Date.now()}`,
          fields: {
            Name: 'Test Record',
            Status: 'New',
            Created: new Date().toISOString()
          }
        }

      case 'discord_trigger_new_message':
        return {
          content: 'This is a test message from the workflow',
          author: {
            id: '123456789',
            username: 'TestUser',
            discriminator: '0001'
          },
          channel: {
            id: 'test-channel',
            name: 'general'
          },
          timestamp: new Date().toISOString()
        }

      case 'slack_trigger_new_message':
        return {
          text: 'This is a test message',
          user: 'U123456',
          channel: 'C123456',
          ts: Date.now().toString()
        }

      case 'github_trigger_new_issue':
        return {
          title: 'Test Issue',
          body: 'This is a test issue created by the workflow',
          number: Math.floor(Math.random() * 1000),
          state: 'open',
          user: {
            login: 'testuser'
          }
        }

      case 'trello_trigger_card_moved':
        return {
          cardName: 'Test Card',
          listName: 'In Progress',
          boardName: 'Test Board',
          movedBy: 'Test User'
        }

      default:
        return {
          triggered: true,
          timestamp: new Date().toISOString(),
          testData: true
        }
    }
  }

  // Skip webhook and use test data instead
  const skipToTestData = useCallback(async (nodes: Node[], edges: Edge[]) => {
    // Unregister webhook before executing with test data
    await stopWebhookListening()

    setUsingTestData(true)

    // Mark trigger node as using test data
    const triggerNode = nodes.find(n => n.data?.isTrigger)
    if (!triggerNode) {
      toast({
        title: "Error",
        description: "No trigger node found",
        variant: "destructive",
      })
      return
    }

    setTestDataNodes(new Set([triggerNode.id]))

    // Generate and inject test data into the trigger node
    const triggerType = triggerNode.data?.type
    const generatedTestData = generateTestData(triggerType)

    // Update the trigger node's testData config
    const updatedNodes = nodes.map(node => {
      if (node.id === triggerNode.id) {
        return {
          ...node,
          data: {
            ...node.data,
            config: {
              ...node.data.config,
              testData: generatedTestData
            }
          }
        }
      }
      return node
    })

    toast({
      title: "Using test data",
      description: "Executing workflow with auto-generated test data...",
    })

    // Execute with test data
    await handleExecute(updatedNodes, edges)
  }, [stopWebhookListening, toast, handleExecute])

  const handleExecuteLive = useCallback(async (
    nodes: Node[],
    edges: Edge[],
    onNodesUpdate?: (nodeUpdates: Array<{ nodeId: string; resultMessage: string }>) => void
  ) => {
    // Execute workflow with live data and parallel processing
    if (isExecuting) {
      logger.info('⚠️ [Live Mode] Already executing, ignoring duplicate request');
      return
    }

    // Validate workflow is saved
    if (!currentWorkflow?.id) {
      toast({
        title: "Error",
        description: "Please save your workflow first",
        variant: "destructive",
      })
      return
    }

    setIsExecuting(true)
    setActiveExecutionNodeId(null) // Will be updated to array for parallel
    addDebugLog('info', 'Starting Live Mode with parallel execution')

    try {
      logger.info('🚀 [Live Mode] Starting parallel execution...')

      const response = await fetch('/api/workflows/execute', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          workflowId: currentWorkflow.id,
          testMode: false,  // Use real actions
          executionMode: 'live',  // This triggers parallel execution
          inputData: {},
          workflowData: {
            nodes,
            edges,
          },
          skipTriggers: true, // Skip trigger nodes for manual execution
        }),
      })

      if (!response.ok) {
        const error = await response.json()
        throw new Error(error.error || 'Failed to execute workflow')
      }

      const result = await response.json()

      addDebugLog('success', 'Live execution complete', {
        executionMode: result.executionMode,
        sessionId: result.sessionId
      })

      toast({
        title: "Live Execution Complete",
        description: "Workflow executed successfully with parallel processing",
      })

      // Update node statuses based on results
      if (result.results && Array.isArray(result.results)) {
        result.results.forEach((nodeResult: any) => {
          if (nodeResult.nodeId) {
            setNodeStatuses(prev => ({
              ...prev,
              [nodeResult.nodeId]: nodeResult.success ? 'completed' : 'error'
            }))
          }
        })
      }

      // Fetch execution steps to get result messages for nodes
      if (result.executionHistoryId && onNodesUpdate) {
        try {
          const stepsResponse = await fetch(`/api/workflows/history/${result.executionHistoryId}/steps`)
          if (stepsResponse.ok) {
            const stepsData = await stepsResponse.json()
            const nodeUpdates = stepsData.steps
              .filter((step: any) => step.output_data?.message)
              .map((step: any) => ({
                nodeId: step.node_id,
                resultMessage: step.output_data.message
              }))

            if (nodeUpdates.length > 0) {
              logger.info(`📨 Updating ${nodeUpdates.length} nodes with result messages`)
              onNodesUpdate(nodeUpdates)
            }
          }
        } catch (error) {
          logger.error('Failed to fetch execution steps for result messages:', error)
        }
      }

    } catch (error: any) {
      logger.error('❌ [Live Mode] Execution error:', error)
      addDebugLog('error', 'Live execution failed', { error: error.message })

      toast({
        title: "Live Execution Failed",
        description: error.message || "Failed to execute workflow",
        variant: "destructive",
      })
    } finally {
      setIsExecuting(false)
      setActiveExecutionNodeId(null)

      // Clear node statuses after delay
      setTimeout(() => {
        setNodeStatuses({})
      }, 5000)
    }
  }, [isExecuting, currentWorkflow, toast, addDebugLog, setNodeStatuses, setActiveExecutionNodeId])

  const handleExecuteLiveSequential = useCallback(async (
    nodes: Node[],
    edges: Edge[],
    onNodesUpdate?: (nodeUpdates: Array<{ nodeId: string; resultMessage: string }>) => void
  ) => {
    // Execute workflow with live data but sequential processing (for debugging)
    if (isExecuting) {
      logger.info('⚠️ [Live Sequential] Already executing, ignoring duplicate request');
      return
    }

    // Validate workflow is saved
    if (!currentWorkflow?.id) {
      toast({
        title: "Error",
        description: "Please save your workflow first",
        variant: "destructive",
      })
      return
    }

    setIsExecuting(true)
    setActiveExecutionNodeId(null)
    addDebugLog('info', 'Starting Live Mode Sequential (Debug) execution')

    try {
      logger.info('🔍 [Live Sequential] Starting sequential execution for debugging...')

      const response = await fetch('/api/workflows/execute', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          workflowId: currentWorkflow.id,
          testMode: false,  // Use real actions
          executionMode: 'sequential',  // This triggers sequential execution
          inputData: {},
          workflowData: {
            nodes,
            edges,
          },
          skipTriggers: true,
        }),
      })

      if (!response.ok) {
        const error = await response.json()
        throw new Error(error.error || 'Failed to execute workflow')
      }

      const result = await response.json()

      addDebugLog('success', 'Sequential execution complete (debug mode)', {
        executionMode: result.executionMode,
        sessionId: result.sessionId
      })

      toast({
        title: "Sequential Execution Complete",
        description: "Workflow executed in debug mode (one node at a time)",
      })

      // Update node statuses
      if (result.results && Array.isArray(result.results)) {
        result.results.forEach((nodeResult: any) => {
          if (nodeResult.nodeId) {
            setNodeStatuses(prev => ({
              ...prev,
              [nodeResult.nodeId]: nodeResult.success ? 'completed' : 'error'
            }))
          }
        })
      }

      // Fetch execution steps to get result messages for nodes
      if (result.executionHistoryId && onNodesUpdate) {
        try {
          const stepsResponse = await fetch(`/api/workflows/history/${result.executionHistoryId}/steps`)
          if (stepsResponse.ok) {
            const stepsData = await stepsResponse.json()
            const nodeUpdates = stepsData.steps
              .filter((step: any) => step.output_data?.message)
              .map((step: any) => ({
                nodeId: step.node_id,
                resultMessage: step.output_data.message
              }))

            if (nodeUpdates.length > 0) {
              logger.info(`📨 Updating ${nodeUpdates.length} nodes with result messages`)
              onNodesUpdate(nodeUpdates)
            }
          }
        } catch (error) {
          logger.error('Failed to fetch execution steps for result messages:', error)
        }
      }

    } catch (error: any) {
      logger.error('❌ [Live Sequential] Execution error:', error)
      addDebugLog('error', 'Sequential execution failed', { error: error.message })

      toast({
        title: "Sequential Execution Failed",
        description: error.message || "Failed to execute workflow",
        variant: "destructive",
      })
    } finally {
      setIsExecuting(false)
      setActiveExecutionNodeId(null)

      // Clear node statuses after delay
      setTimeout(() => {
        setNodeStatuses({})
      }, 5000)
    }
  }, [isExecuting, currentWorkflow, toast, addDebugLog, setNodeStatuses, setActiveExecutionNodeId])

  const pauseExecution = useCallback(() => {
    setIsPaused(true)
  }, [])

  const stopStepExecution = useCallback(() => {
    setIsStepMode(false)
    setIsStepByStep(false)
    setIsPaused(false)
    setCurrentNodeId(null)
    setNodeStatuses({})
    setStepContinueCallback(null)
    setSkipCallback(null)
  }, [])

  const executeNodeStepByStep = useCallback(async (nodeId: string) => {
    setCurrentNodeId(nodeId)
    setNodeStatuses(prev => ({ ...prev, [nodeId]: 'running' }))
    // Implementation for step-by-step execution
  }, [])

  // Clean up test session when user leaves the page
  useEffect(() => {
    const cleanup = () => {
      // Only cleanup if there's an active session with user ID
      if (currentWorkflow?.id && sessionId && sessionUserId && isListeningForWebhook) {
        logger.info('🧹 Page unload detected - cleaning up test session')

        // Use the cleanup endpoint which works with sendBeacon
        const cleanupUrl = `/api/workflows/${currentWorkflow.id}/test-session/cleanup`

        // Try sendBeacon first (most reliable for page unload)
        if (navigator.sendBeacon) {
          const blob = new Blob([JSON.stringify({
            sessionId,
            userId: sessionUserId
          })], { type: 'application/json' })
          navigator.sendBeacon(cleanupUrl, blob)
        } else {
          // Fallback to regular DELETE for browsers without sendBeacon
          fetch(`/api/workflows/${currentWorkflow.id}/test-session`, {
            method: 'DELETE',
            keepalive: true, // Ensures request completes even if page closes
          }).catch(() => {
            // Ignore errors during cleanup
          })
        }
      }
    }

    // Handle page unload (close tab, close browser, navigate away)
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      cleanup()

      // Optionally warn user if test is running
      if (isListeningForWebhook) {
        e.preventDefault()
        // Modern browsers ignore custom messages, but we still need to set returnValue
        e.returnValue = ''
        return ''
      }
    }

    // Add event listener for page unload
    window.addEventListener('beforeunload', handleBeforeUnload)

    // Cleanup on component unmount (navigating to different page in app)
    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload)

      // Also cleanup on unmount
      cleanup()
    }
  }, [currentWorkflow?.id, sessionId, sessionUserId, isListeningForWebhook])

  return {
    isExecuting,
    setIsExecuting,
    activeExecutionNodeId,
    executionResults,
    handleExecute,
    handleTestSandbox,
    handleExecuteLive,
    handleExecuteLiveSequential,
    handleResetLoadingStates,
    // Step execution
    isStepMode,
    setIsStepMode,
    isStepByStep,
    setIsStepByStep,
    isPaused,
    setIsPaused,
    currentNodeId,
    setCurrentNodeId,
    nodeStatuses,
    setNodeStatuses,
    stepContinueCallback,
    setStepContinueCallback,
    skipCallback,
    setSkipCallback,
    pauseExecution,
    stopStepExecution,
    executeNodeStepByStep,
    // Webhook listening
    isListeningForWebhook,
    webhookTriggerType,
    usingTestData,
    testDataNodes,
    stopWebhookListening,
    skipToTestData,
    // Sandbox mode
    sandboxInterceptedActions,
    setSandboxInterceptedActions,
    showSandboxPreview,
    setShowSandboxPreview,
    testModeDialogOpen,
    setTestModeDialogOpen,
    isExecutingTest,
    handleRunTest,
  }
}
