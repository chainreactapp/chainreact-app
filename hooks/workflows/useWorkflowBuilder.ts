import { useState, useCallback, useEffect, useMemo, useRef } from 'react'
import { useSearchParams, useRouter, useParams } from 'next/navigation'
import { useNodesState, useEdgesState, useReactFlow, type Node, type Edge, type Connection } from '@xyflow/react'
import { useToast } from '@/hooks/use-toast'

// Store imports
import { type Workflow, type WorkflowNode, type WorkflowConnection } from '@/stores/workflowStore'
import { useWorkflowStore } from '@/stores/workflowStore'
import { useIntegrationStore } from '@/stores/integrationStore'
import { useCollaborationStore } from '@/stores/collaborationStore'

// Custom hooks - Refactored for better performance
import { useWorkflowState } from './useWorkflowState'
import { useWorkflowNodes } from './useWorkflowNodes'
import { useWorkflowSaveActions } from './useWorkflowSaveActions'
import { useWorkflowExecution } from './useWorkflowExecution'
import { useWorkflowDialogs } from './useWorkflowDialogs'
import { useIntegrationSelection } from './useIntegrationSelection'
import { useNodeConfiguration } from './useNodeConfiguration'
import { useWorkflowHistory } from './useWorkflowHistory'

// Utils
import { supabase } from '@/utils/supabaseClient'
import CustomNode from '@/components/workflows/CustomNode'
import { AddActionNode } from '@/components/workflows/AddActionNode'
import { ChainPlaceholderNode } from '@/components/workflows/ChainPlaceholderNode'
import InsertActionNode from '@/components/workflows/InsertActionNode'
import { ALL_NODE_COMPONENTS, type NodeComponent } from '@/lib/workflows/nodes'
import { validateWorkflowNodes } from '@/lib/workflows/validation/workflow'
import { getCenteredAddActionX } from '@/lib/workflows/addActionLayout'
import { INTEGRATION_CONFIGS } from '@/lib/integrations/availableIntegrations'

import { logger } from '@/lib/utils/logger'
import type { TemplateIntegrationSetup, TemplateSetupOverview, TemplateAsset } from '@/types/templateSetup'

interface IntegrationInfo {
  id: string
  name: string
  description: string
  category: string
  color: string
  triggers: NodeComponent[]
  actions: NodeComponent[]
}

interface TemplateDraftMetadata {
  primarySetupTarget: string | null
  setupOverview: TemplateSetupOverview | null
  integrationSetup: TemplateIntegrationSetup[]
  defaultFieldValues: Record<string, any>
  status: string
}

interface TemplatePublishedMetadata {
  primarySetupTarget: string | null
  setupOverview: TemplateSetupOverview | null
  integrationSetup: TemplateIntegrationSetup[]
  defaultFieldValues: Record<string, any>
  publishedAt?: string | null
}

interface SaveTemplateDraftOptions {
  nodes?: WorkflowNode[]
  connections?: WorkflowConnection[]
  primarySetupTarget?: string | null
  setupOverview?: TemplateSetupOverview | null
  integrationSetup?: TemplateIntegrationSetup[]
  defaultFieldValues?: Record<string, any>
  status?: string
}

type PreflightIssueType = 'integration' | 'configuration' | 'ai'

interface PreflightIssue {
  type: PreflightIssueType
  message: string
  nodeId?: string
  providerId?: string
  missingFields?: string[]
}

interface PreflightResult {
  issues: PreflightIssue[]
  warnings: PreflightIssue[]
  checkedAt: string
}

interface RunPreflightOptions {
  openOnSuccess?: boolean
  openOnFailure?: boolean
}

export function useWorkflowBuilder() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const params = useParams()

  // Support both path params (/workflows/builder/[id]) and query params (/workflows/builder?id=xxx)
  const workflowId = (params?.id as string) || searchParams.get("id")
  const editTemplateId = searchParams.get("editTemplate")
  const isTemplateEditing = Boolean(editTemplateId && !workflowId)
  const { toast } = useToast()

  // Store hooks - Now using useWorkflowState with shallow equality
  const {
    workflows,
    currentWorkflow,
    setCurrentWorkflow,
    updateWorkflow,
    removeNode,
    workflowLoading,
    fetchWorkflows,
    addWorkflowToStore,
    joinCollaboration,
    leaveCollaboration,
    collaborators,
    getConnectedProviders,
    integrationsLoading,
    addError,
    setErrorStoreWorkflow,
    getLatestErrorForNode,
  } = useWorkflowState()
  
  // React Flow state - Now using useWorkflowNodes hook
  const {
    nodes,
    edges,
    selectedEdgeId,
    setSelectedEdgeId,
    setNodes,
    setEdges,
    onNodesChange,
    // Note: We override optimizedOnNodesChange below with more advanced logic for AI agent chains
    onEdgesChange,
    fitView,
    getNodes,
    getEdges,
    nodeTypes,
    edgeTypes,
    addActionHandlersRef,
  } = useWorkflowNodes()

  const deletedTriggerBackupRef = useRef<{ node: Node; edges: Edge[] } | null>(null)
  const collaborationWorkflowIdRef = useRef<string | null>(null)
  const timeoutToastShownRef = useRef<boolean>(false)

  // Additional states needed by the main component
  const [cachedIntegrationStatus, setCachedIntegrationStatus] = useState<Map<string, boolean>>(new Map())
  const [preflightResult, setPreflightResult] = useState<PreflightResult | null>(null)
  const [isPreflightDialogOpen, setIsPreflightDialogOpen] = useState(false)
  const [isRunningPreflight, setIsRunningPreflight] = useState(false)
  const [directFetchStatus, setDirectFetchStatus] = useState<'idle' | 'loading' | 'success' | 'error'>('idle')
  const [hasHandledDirectFetchError, setHasHandledDirectFetchError] = useState(false)
  const directFetchErrorRef = useRef<string | null>(null)

  useEffect(() => {
    setDirectFetchStatus('idle')
    setHasHandledDirectFetchError(false)
    directFetchErrorRef.current = null
  }, [workflowId])

  // Workflow metadata
  const [workflowName, setWorkflowName] = useState("")
  const [workflowDescription, setWorkflowDescription] = useState("")
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false)
  const [isTemplateLoading, setIsTemplateLoading] = useState(false)
  const [listeningMode, setListeningMode] = useState(false)
  const [hasShownLoading, setHasShownLoading] = useState(false)
  const isProcessingChainsRef = useRef(false)
  // justSavedRef now comes from useWorkflowSaveActions hook
  const isCleaningAddActionsRef = useRef(false)
  const templateLoadStateRef = useRef<{ id: string; status: "pending" | "fulfilled" | "rejected" } | null>(null)
  const [templateDraftMetadata, setTemplateDraftMetadata] = useState<TemplateDraftMetadata>({
    primarySetupTarget: null,
    setupOverview: null,
    integrationSetup: [],
    defaultFieldValues: {},
    status: 'draft',
  })
  const [templatePublishedMetadata, setTemplatePublishedMetadata] = useState<TemplatePublishedMetadata | null>(null)
  const [templateAssets, setTemplateAssets] = useState<TemplateAsset[]>([])
  const [isSavingTemplateDraft, setIsSavingTemplateDraft] = useState(false)

  const parseJson = useCallback(<T,>(value: any, fallback: T): T => {
    if (value === undefined || value === null) {
      return fallback
    }
    if (typeof value === 'string') {
      try {
        return JSON.parse(value) as T
      } catch (error) {
        logger.warn('[WorkflowBuilder] Failed to parse JSON value', { error, value })
        return fallback
      }
    }
    return (value as T) ?? fallback
  }, [])

  const cloneDeep = useCallback(<T,>(value: T): T => {
    if (value === undefined || value === null) {
      return value
    }
    try {
      return JSON.parse(JSON.stringify(value)) as T
    } catch (error) {
      logger.warn('[WorkflowBuilder] Failed to clone value', { error, value })
      return value
    }
  }, [])

  const loadWorkflowDirect = useCallback(async (id: string): Promise<boolean> => {
    try {
      const { data, error } = await supabase
        .from('workflows')
        .select('*')
        .eq('id', id)
        .maybeSingle()

      if (error) {
        logger.error('[WorkflowBuilder] Direct workflow fetch error:', error)
        directFetchErrorRef.current = error.message || 'Failed to load workflow.'
        return false
      }

      if (!data) {
        directFetchErrorRef.current = 'Workflow not found.'
        return false
      }

      directFetchErrorRef.current = null
      addWorkflowToStore(data as Workflow)
      return true
    } catch (error) {
      logger.error('[WorkflowBuilder] Direct workflow fetch failed:', error)
      directFetchErrorRef.current = error instanceof Error ? error.message : 'Failed to load workflow.'
      return false
    }
  }, [addWorkflowToStore])

  // Wrapper to safely set unsaved changes (ignores changes right after save)
  const markAsUnsaved = useCallback(() => {
    if (!justSavedRef.current) {
      setHasUnsavedChanges(true)
    }
  }, [])

  const updateTemplateDraftMetadata = useCallback((updates: Partial<TemplateDraftMetadata>) => {
    setTemplateDraftMetadata(prev => {
      const base = prev ?? {
        primarySetupTarget: null,
        setupOverview: null,
        integrationSetup: [],
        defaultFieldValues: {},
        status: 'draft',
      }

      return {
        primarySetupTarget: updates.primarySetupTarget ?? base.primarySetupTarget,
        setupOverview: updates.setupOverview !== undefined ? updates.setupOverview : base.setupOverview,
        integrationSetup: updates.integrationSetup
          ? updates.integrationSetup.map(setup => ({ ...setup }))
          : base.integrationSetup.map(setup => ({ ...setup })),
        defaultFieldValues: updates.defaultFieldValues !== undefined
          ? { ...updates.defaultFieldValues }
          : { ...base.defaultFieldValues },
        status: updates.status ?? base.status,
      }
    })
    markAsUnsaved()
  }, [markAsUnsaved])

  const serializeWorkflowState = useCallback(() => {
    const currentNodes = getNodes()
    const currentEdges = getEdges()

    const placeholderNodeIds = new Set(
      currentNodes
        .filter(n =>
          n.type === 'addAction' ||
          n.type === 'chainPlaceholder' ||
          (typeof n.id === 'string' && (n.id.startsWith('add-action-') || n.id.startsWith('chain-placeholder-')))
        )
        .map(n => n.id)
    )

    const persistedNodes = currentNodes.filter(n => !placeholderNodeIds.has(n.id))
    const persistedEdges = currentEdges.filter(e =>
      !placeholderNodeIds.has(e.source) &&
      !placeholderNodeIds.has(e.target) &&
      !e.target.includes('add-action') &&
      !e.source.includes('add-action')
    )

    const workflowNodes: WorkflowNode[] = persistedNodes.map(node => ({
      id: node.id,
      type: node.type || 'custom',
      position: node.position,
      data: node.data,
    }))

    const workflowConnections: WorkflowConnection[] = persistedEdges.map(edge => ({
      id: edge.id,
      source: edge.source,
      target: edge.target,
    }))

    return { workflowNodes, workflowConnections, persistedNodes, persistedEdges }
  }, [getNodes, getEdges])

  const saveTemplateDraft = useCallback(async (options: SaveTemplateDraftOptions = {}) => {
    if (!isTemplateEditing || !editTemplateId) {
      return null
    }

    const snapshot = (options.nodes && options.connections)
      ? { workflowNodes: options.nodes, workflowConnections: options.connections }
      : serializeWorkflowState()

    const payload = {
      nodes: snapshot.workflowNodes,
      connections: snapshot.workflowConnections,
      default_field_values: cloneDeep(
        options.defaultFieldValues ?? templateDraftMetadata.defaultFieldValues ?? {}
      ),
      integration_setup: cloneDeep(
        options.integrationSetup ?? templateDraftMetadata.integrationSetup ?? []
      ),
      setup_overview: cloneDeep(
        options.setupOverview ?? templateDraftMetadata.setupOverview ?? null
      ),
      primary_setup_target:
        options.primarySetupTarget ?? templateDraftMetadata.primarySetupTarget ?? null,
      status: options.status ?? templateDraftMetadata.status ?? 'draft',
    }

    setIsSavingTemplateDraft(true)

    try {
      const response = await fetch(`/api/templates/${editTemplateId}/draft`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      })

      const body = await response.json().catch(() => ({}))
      if (!response.ok) {
        throw new Error(body.error || 'Failed to save template draft')
      }

      const savedDraft = body?.draft || {}

      setTemplateDraftMetadata(prev => {
        const base = prev ?? templateDraftMetadata
        return {
          primarySetupTarget: savedDraft.primary_setup_target ?? base.primarySetupTarget ?? null,
          setupOverview: savedDraft.setup_overview ?? base.setupOverview ?? null,
          integrationSetup: Array.isArray(savedDraft.integration_setup)
            ? cloneDeep(savedDraft.integration_setup)
            : cloneDeep(base.integrationSetup),
          defaultFieldValues: cloneDeep(savedDraft.default_field_values ?? base.defaultFieldValues ?? {}),
          status: savedDraft.status ?? base.status ?? 'draft',
        }
      })

      if (
        savedDraft.published_default_field_values ||
        savedDraft.published_integration_setup ||
        savedDraft.published_setup_overview ||
        typeof savedDraft.published_at !== 'undefined'
      ) {
        setTemplatePublishedMetadata({
          primarySetupTarget: savedDraft.primary_setup_target ?? templatePublishedMetadata?.primarySetupTarget ?? null,
          setupOverview: cloneDeep(savedDraft.published_setup_overview ?? templatePublishedMetadata?.setupOverview ?? null),
          integrationSetup: cloneDeep(savedDraft.published_integration_setup ?? templatePublishedMetadata?.integrationSetup ?? []),
          defaultFieldValues: cloneDeep(savedDraft.published_default_field_values ?? templatePublishedMetadata?.defaultFieldValues ?? {}),
          publishedAt: savedDraft.published_at ?? templatePublishedMetadata?.publishedAt ?? null,
        })
      }

      templateLoadStateRef.current = { id: editTemplateId, status: "fulfilled" }
      justSavedRef.current = true
      setHasUnsavedChanges(false)
      setTimeout(() => {
        justSavedRef.current = false
      }, 500)

      return savedDraft
    } catch (error) {
      setHasUnsavedChanges(true)
      throw error
    } finally {
      setIsSavingTemplateDraft(false)
    }
  }, [
    isTemplateEditing,
    editTemplateId,
    serializeWorkflowState,
    cloneDeep,
    templateDraftMetadata,
    templatePublishedMetadata,
    setHasUnsavedChanges,
  ])

  const uploadTemplateAsset = useCallback(async (file: File, options?: { name?: string; assetType?: string }) => {
    if (!isTemplateEditing || !editTemplateId) {
      throw new Error('Template asset uploads are only available in template editing mode')
    }

    try {
      const formData = new FormData()
      formData.append('file', file)
      if (options?.assetType) {
        formData.append('assetType', options.assetType)
      }
      if (options?.name) {
        formData.append('name', options.name)
      }

      const response = await fetch(`/api/templates/${editTemplateId}/assets`, {
        method: 'POST',
        body: formData,
      })

      const body = await response.json().catch(() => ({}))
      if (!response.ok) {
        throw new Error(body.error || 'Failed to upload asset')
      }

      const asset: TemplateAsset | undefined = body?.asset
      if (asset) {
        setTemplateAssets(prev => [asset, ...prev.filter(existing => existing.id !== asset.id)])
      }

      toast({
        title: 'Asset uploaded',
        description: `${asset?.name || 'File'} is ready to use in the setup guide.`,
      })

      markAsUnsaved()
      return asset || null
    } catch (error: any) {
      logger.error('[WorkflowBuilder] Failed to upload template asset', error)
      toast({
        title: 'Upload failed',
        description: error?.message || 'Could not upload template asset',
        variant: 'destructive',
      })
      throw error
    }
  }, [isTemplateEditing, editTemplateId, toast, markAsUnsaved])

  const deleteTemplateAsset = useCallback(async (assetId: string) => {
    if (!isTemplateEditing || !editTemplateId) {
      return
    }

    try {
      const response = await fetch(`/api/templates/${editTemplateId}/assets?assetId=${encodeURIComponent(assetId)}`, {
        method: 'DELETE',
      })

      const body = await response.json().catch(() => ({}))
      if (!response.ok) {
        throw new Error(body.error || 'Failed to delete asset')
      }

      setTemplateAssets(prev => prev.filter(asset => asset.id !== assetId))
      toast({
        title: 'Asset removed',
        description: 'The asset has been removed from this template.',
      })
      markAsUnsaved()
    } catch (error: any) {
      logger.error('[WorkflowBuilder] Failed to delete template asset', error)
      toast({
        title: 'Delete failed',
        description: error?.message || 'Could not delete template asset',
        variant: 'destructive',
      })
      throw error
    }
  }, [isTemplateEditing, editTemplateId, toast, markAsUnsaved])

  // Custom hooks
  const executionHook = useWorkflowExecution()

  // Debug logging
  useEffect(() => {
    console.log('🧪 [useWorkflowBuilder] executionHook.testModeDialogOpen:', executionHook.testModeDialogOpen)
  }, [executionHook.testModeDialogOpen])
  const dialogsHook = useWorkflowDialogs()
  const integrationHook = useIntegrationSelection()
  const historyHook = useWorkflowHistory()
  const configHook = useNodeConfiguration(
    currentWorkflow?.id,
    nodes,
    setNodes,
    setHasUnsavedChanges,
    edges,
    setEdges
  )

  // Save actions hook - provides stable handleSave and handleToggleLive
  const saveActionsHook = useWorkflowSaveActions({
    currentWorkflow,
    setCurrentWorkflow,
    updateWorkflow,
    workflowName,
    workflowDescription,
    nodes,
    edges,
    getNodes,
    getEdges,
    isTemplateEditing,
    editTemplateId,
    saveTemplateDraft,
    setHasUnsavedChanges,
    hasUnsavedChanges,
  })

  // Extract save actions (note: we keep local serializeWorkflowState for saveTemplateDraft)
  const {
    isSaving,
    isUpdatingStatus,
    handleSave,
    handleToggleLive,
    showActivationReview,
    setShowActivationReview,
    confirmActivation,
    justSavedRef,
    // serializeWorkflowState - using local version below
  } = saveActionsHook

  // Auto-save mechanism - debounced save after changes
  const autoSaveTimeoutRef = useRef<NodeJS.Timeout | null>(null)

  useEffect(() => {
    // Only auto-save if we have unsaved changes and a workflow to save
    if (!hasUnsavedChanges || !currentWorkflow?.id || isSaving || isTemplateEditing) {
      return
    }

    // Clear any existing timeout
    if (autoSaveTimeoutRef.current) {
      clearTimeout(autoSaveTimeoutRef.current)
    }

    // Set a new timeout to save after 3 seconds of inactivity
    autoSaveTimeoutRef.current = setTimeout(() => {
      logger.info('[WorkflowBuilder] Auto-saving workflow after inactivity...')
      handleSave().catch(err => {
        logger.error('[WorkflowBuilder] Auto-save failed:', err)
      })
    }, 3000) // 3 second debounce

    // Cleanup timeout on unmount or when dependencies change
    return () => {
      if (autoSaveTimeoutRef.current) {
        clearTimeout(autoSaveTimeoutRef.current)
      }
    }
  }, [hasUnsavedChanges, currentWorkflow?.id, isSaving, isTemplateEditing, handleSave, nodes, edges, workflowName, workflowDescription])

  // Load initial data in parallel with proper error handling
  useEffect(() => {
    const loadInitialData = async () => {
      // Set a global timeout for all initial loading
      const loadingTimeout = setTimeout(() => {
        logger.warn('[WorkflowBuilder] Initial load timeout - resetting loading states')
        // Force clear any stuck loading states
        if (workflowLoading) {
          useWorkflowStore.setState({ loading: false })
        }
        if (integrationsLoading) {
          useIntegrationStore.setState({ loading: false })
        }
      }, 10000) // 10 second timeout for initial load

      try {
        // Fetch workflows and integrations in parallel
        const workflowPromise = isTemplateEditing
          ? Promise.resolve()
          : fetchWorkflows().catch(err => {
              logger.error('[WorkflowBuilder] Failed to fetch workflows:', err)
              return [] // Continue even if workflows fail
            })

        const integrationPromise = !getConnectedProviders()?.length
          ? useIntegrationStore.getState().fetchIntegrations().catch(err => {
              logger.error('[WorkflowBuilder] Failed to fetch integrations:', err)
              return [] // Continue even if integrations fail
            })
          : Promise.resolve()

        await Promise.all([workflowPromise, integrationPromise])
      } finally {
        clearTimeout(loadingTimeout)
      }
    }

    loadInitialData()
  }, [])

  useEffect(() => {
    if (!workflowId || isTemplateEditing) return

    const hasWorkflow = workflows.some(workflow => workflow.id === workflowId)
    if (hasWorkflow) return
    if (directFetchStatus !== 'idle') return

    setDirectFetchStatus('loading')
    void loadWorkflowDirect(workflowId).then(success => {
      setDirectFetchStatus(success ? 'success' : 'error')
    })
  }, [workflowId, workflows, isTemplateEditing, directFetchStatus, loadWorkflowDirect])

  // Track last validated node IDs to prevent infinite loops
  const lastValidatedNodesRef = useRef<string>('')

  // Update nodes with execution status for live highlighting
  useEffect(() => {
    setNodes(currentNodes => {
      return currentNodes.map(node => {
        // If not executing and not listening, clear all execution status
        if (!executionHook.isExecuting && !executionHook.isListeningForWebhook && !executionHook.isPaused) {
          // Only update if the node has execution status to clear
          if (node.data?.executionStatus || node.data?.isActiveExecution) {
            return {
              ...node,
              data: {
                ...node.data,
                executionStatus: undefined,
                isActiveExecution: false,
              }
            }
          }
          return node
        }

        // Otherwise, apply execution status
        const isActive = executionHook.activeExecutionNodeId === node.id
        const pausedHighlight = executionHook.isPaused && executionHook.activeExecutionNodeId === node.id
        const status = executionHook.nodeStatuses[node.id] || (pausedHighlight ? 'running' : undefined)

        // Highlight trigger node when listening for webhook
        const isTriggerListening = executionHook.isListeningForWebhook && node.data?.isTrigger
        const listeningStatus = isTriggerListening ? 'running' : null

        return {
          ...node,
          data: {
            ...node.data,
            executionStatus: status || listeningStatus,
            isActiveExecution: isActive || isTriggerListening || pausedHighlight,
          }
        }
      })
    })
  }, [executionHook.nodeStatuses, executionHook.activeExecutionNodeId, executionHook.isExecuting, executionHook.isListeningForWebhook, executionHook.isPaused])

  // Validate nodes when they change (runs for ALL workflows, not just AI Agent)
  useEffect(() => {
    if (nodes.length === 0) {
      return
    }

    // Create a hash of node IDs and their config to detect actual changes
    const nodeHash = nodes.map(n => `${n.id}:${JSON.stringify(n.data?.config)}`).join('|')

    // Skip if we already validated this exact set of nodes
    if (lastValidatedNodesRef.current === nodeHash) {
      return
    }

    logger.info('🔍 [Validation] Running validation on nodes...')

    const workflow = {
      id: currentWorkflow?.id || '',
      name: workflowName,
      nodes: nodes as WorkflowNode[],
      edges: edges as WorkflowConnection[],
    } as Workflow

    const validationResult = validateWorkflowNodes(workflow, ALL_NODE_COMPONENTS)

    logger.info('🔍 [Validation] Invalid node IDs:', validationResult.invalidNodeIds)

    // Build a map of validation states
    const validationMap = new Map<string, any>()
    validationResult.nodes.forEach(node => {
      if (node.data?.validationState) {
        validationMap.set(node.id, node.data.validationState)
      }
    })

    // Update nodes with validation state
    setNodes(currentNodes => {
      return currentNodes.map(node => {
        const newValidationState = validationMap.get(node.id)
        if (newValidationState) {
          return {
            ...node,
            data: {
              ...node.data,
              validationState: newValidationState
            }
          }
        }
        return node
      })
    })

    // Store the hash to prevent re-validation
    lastValidatedNodesRef.current = nodeHash
  }, [nodes, edges, currentWorkflow?.id, workflowName])

  // Stable callback refs - don't depend on nodes to avoid loops
  const nodesRef = useRef(nodes)
  nodesRef.current = nodes

  // Handle add action button click - moved up before other callbacks to ensure it's available
  const handleAddActionClick = useCallback((nodeId: string, parentId: string) => {
    // logger.info('handleAddActionClick called with nodeId:', nodeId, 'parentId:', parentId)

    // Check if the parent node is part of an AI Agent chain OR is an AI Agent itself
    const parentNode = nodesRef.current.find(n => n.id === parentId)
    const sourceNode = nodesRef.current.find(n => n.id === nodeId)
    const aiAgentId = parentNode?.data?.parentAIAgentId || (parentNode?.data?.type === 'ai_agent' ? parentNode.id : null)

    // Get chain index from the source node (chain placeholder or add action button) if available,
    // otherwise from parent node
    const parentChainIndex = sourceNode?.data?.parentChainIndex ?? parentNode?.data?.parentChainIndex ?? 0

    if (aiAgentId) {
      // This is an AI Agent chain - open action dialog with AI Agent context
      logger.info('🤖 Add Action clicked for AI Agent chain - opening action selection with AI context')
      logger.info('🔵 Chain index for new action:', parentChainIndex)

      // Store AI Agent context for when action is selected
      dialogsHook.setSourceAddNode({
        id: nodeId,
        parentId,
        aiAgentId, // Store AI Agent ID
        parentChainIndex, // Store chain index from source node
        isAIAgentAction: true // Flag indicating this is for an AI Agent
      })
      dialogsHook.setSelectedIntegration(null)
      dialogsHook.setSelectedAction(null)
      dialogsHook.setSearchQuery("")
      dialogsHook.setShowActionDialog(true)

      logger.info('Called setShowActionDialog(true) for AI Agent chain')
      return
    }

    // Regular action node - proceed with action dialog
    dialogsHook.setSourceAddNode({ id: nodeId, parentId })
    dialogsHook.setSelectedIntegration(null)
    dialogsHook.setSelectedAction(null)
    dialogsHook.setSearchQuery("")
    dialogsHook.setShowActionDialog(true)

    logger.info('Called setShowActionDialog(true)')
    // Force a check after a small delay to see if state updated
    setTimeout(() => {
      logger.info('showActionDialog state after 100ms:', dialogsHook.showActionDialog)
    }, 100)
  }, [dialogsHook])

  const handleNodeConfigure = useCallback((id: string, options?: { focusField?: string }) => {
    console.log('🔍 [handleNodeConfigure] Called with id:', id)
    const nodeToConfig = nodesRef.current.find(n => n.id === id)
    console.log('🔍 [handleNodeConfigure] Found node:', !!nodeToConfig, nodeToConfig?.data?.type)
    if (nodeToConfig) {
      // Manual triggers should open the trigger selection dialog instead of config modal
      if (nodeToConfig.data?.type === 'manual') {
        console.log('🔍 [handleNodeConfigure] Opening trigger dialog')
        dialogsHook.setShowTriggerDialog(true)
        return
      }

      const nodeComponent = ALL_NODE_COMPONENTS.find(c => c.type === nodeToConfig.data?.type)
      console.log('🔍 [handleNodeConfigure] Setting configuringNode:', {
        hasNodeComponent: !!nodeComponent,
        nodeComponentType: nodeComponent?.type
      })
      configHook.setConfiguringNode({
        id: nodeToConfig.id,
        nodeComponent: nodeComponent,
        integration: null,
        config: nodeToConfig.data?.config || {},
        focusField: options?.focusField
      })
    } else {
      console.log('🔍 [handleNodeConfigure] Node NOT found')
    }
  }, [configHook, dialogsHook])

  const handleNodeDelete = useCallback((id: string) => {
    const node = nodesRef.current.find(n => n.id === id)
    dialogsHook.setDeletingNode({ id, name: node?.data?.title || 'this node' })
  }, [dialogsHook])

  const handleNodeEditingStateChange = useCallback((id: string, isEditing: boolean) => {
    setNodes((nds) =>
      nds.map((n) => {
        if (n.id === id) {
          return {
            ...n,
            draggable: !isEditing
          }
        }
        return n
      })
    )
  }, [setNodes])

  const handleNodeRename = useCallback((id: string, newTitle: string) => {
    setNodes((nds) =>
      nds.map((n) => {
        if (n.id === id) {
          return {
            ...n,
            data: {
              ...n.data,
              title: newTitle
            }
          }
        }
        return n
      })
    )
  }, [setNodes])

  // Context menu handlers
  const handleTestNode = useCallback(async (nodeId: string) => {
    console.log('[handleTestNode] Called with nodeId:', nodeId)
    const currentNodes = getNodes()
    console.log('[handleTestNode] Total nodes:', currentNodes.length)
    const node = currentNodes.find(n => n.id === nodeId)
    console.log('[handleTestNode] Found node:', !!node, node?.data?.type)

    if (!node) {
      console.error('[handleTestNode] Node not found!')
      return
    }

    console.log('[handleTestNode] Starting test for:', node.data.title, 'Type:', node.data.type)

    // Set node to running state
    setNodes(currentNodes.map(n => {
      if (n.id === nodeId) {
        return {
          ...n,
          data: {
            ...n.data,
            executionStatus: 'running',
            isActiveExecution: true,
          },
        }
      }
      return n
    }))

    try {
      // Call the test-node API
      console.log('[handleTestNode] Making API call to /api/workflows/test-node')
      console.log('[handleTestNode] Request payload:', {
        nodeType: node.data.type,
        configKeys: Object.keys(node.data.config || {}),
        hasTestData: !!node.data.testData
      })

      const response = await fetch('/api/workflows/test-node', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          nodeType: node.data.type,
          config: node.data.config || {},
          testData: node.data.testData || {},
        }),
      })

      console.log('[handleTestNode] Response status:', response.status)
      const result = await response.json()
      console.log('[handleTestNode] Response result:', result)

      if (result.success) {
        // Update node with test results - show as completed with output
        setNodes(getNodes().map(n => {
          if (n.id === nodeId) {
            return {
              ...n,
              data: {
                ...n.data,
                executionStatus: 'completed',
                isActiveExecution: false,
                testData: result.testResult?.output || {},
                resultMessage: result.testResult?.message || 'Test completed successfully',
              },
            }
          }
          return n
        }))
      } else {
        throw new Error(result.error || 'Test failed')
      }
    } catch (error: any) {
      // Update node to show error state
      setNodes(getNodes().map(n => {
        if (n.id === nodeId) {
          return {
            ...n,
            data: {
              ...n.data,
              executionStatus: 'error',
              isActiveExecution: false,
              errorMessage: error.message,
              errorTimestamp: new Date().toISOString(),
            },
          }
        }
        return n
      }))
    }
  }, [getNodes, setNodes])

  const handleTestFlowFromHere = useCallback(async (nodeId: string) => {
    console.log('[handleTestFlowFromHere] Starting test from node:', nodeId)
    const currentNodes = getNodes()
    const currentEdges = getEdges()
    const startNode = currentNodes.find(n => n.id === nodeId)

    if (!startNode) {
      console.error('[handleTestFlowFromHere] Node not found:', nodeId)
      return
    }

    // Get all downstream nodes (nodes that come after this one)
    const getDownstreamNodes = (fromNodeId: string, visited = new Set<string>()): string[] => {
      if (visited.has(fromNodeId)) return []
      visited.add(fromNodeId)

      const downstreamIds: string[] = [fromNodeId]
      const outgoingEdges = currentEdges.filter(edge => edge.source === fromNodeId)

      for (const edge of outgoingEdges) {
        const childNodes = getDownstreamNodes(edge.target, visited)
        downstreamIds.push(...childNodes)
      }

      return downstreamIds
    }

    const nodesToTest = getDownstreamNodes(nodeId)
    console.log('[handleTestFlowFromHere] Testing nodes:', nodesToTest)

    // Sort nodes in execution order (topological sort based on edges)
    const sortedNodeIds: string[] = []
    const visited = new Set<string>()

    const topologicalSort = (nId: string) => {
      if (visited.has(nId)) return
      visited.add(nId)

      // Visit all dependencies first (nodes that point to this node)
      const incomingEdges = currentEdges.filter(edge => edge.target === nId && nodesToTest.includes(edge.source))
      for (const edge of incomingEdges) {
        topologicalSort(edge.source)
      }

      sortedNodeIds.push(nId)
    }

    for (const nId of nodesToTest) {
      topologicalSort(nId)
    }

    console.log('[handleTestFlowFromHere] Execution order:', sortedNodeIds)

    // Test nodes sequentially, passing output from one to the next
    let currentTestData: Record<string, any> = {}

    for (const nId of sortedNodeIds) {
      const node = currentNodes.find(n => n.id === nId)
      if (!node) continue

      console.log('[handleTestFlowFromHere] Testing node:', node.data.title)

      // Set node to running state
      setNodes(getNodes().map(n => {
        if (n.id === nId) {
          return {
            ...n,
            data: {
              ...n.data,
              executionStatus: 'running',
              isActiveExecution: true,
            },
          }
        }
        return n
      }))

      try {
        // Call the test-node API with accumulated test data
        const response = await fetch('/api/workflows/test-node', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            nodeType: node.data.type,
            config: node.data.config || {},
            testData: currentTestData,
          }),
        })

        const result = await response.json()

        if (result.success) {
          // Merge the output into currentTestData for the next node
          currentTestData = {
            ...currentTestData,
            ...(result.testResult?.output || {}),
          }

          // Update node with test results
          setNodes(getNodes().map(n => {
            if (n.id === nId) {
              return {
                ...n,
                data: {
                  ...n.data,
                  executionStatus: 'completed',
                  isActiveExecution: false,
                  testData: result.testResult?.output || {},
                  resultMessage: result.testResult?.message || 'Test completed successfully',
                },
              }
            }
            return n
          }))
        } else {
          throw new Error(result.error || 'Test failed')
        }
      } catch (error: any) {
        // Update node to show error state
        setNodes(getNodes().map(n => {
          if (n.id === nId) {
            return {
              ...n,
              data: {
                ...n.data,
                executionStatus: 'error',
                isActiveExecution: false,
                errorMessage: error.message,
                errorTimestamp: new Date().toISOString(),
              },
            }
          }
          return n
        }))

        // Stop testing on error
        console.error('[handleTestFlowFromHere] Test failed at node:', node.data.title, error)
        break
      }
    }

    console.log('[handleTestFlowFromHere] Flow test completed')
  }, [getNodes, getEdges, setNodes])

  const handleFreezeNode = useCallback((nodeId: string) => {
    const currentNodes = getNodes()
    const node = currentNodes.find(n => n.id === nodeId)

    if (!node) {
      console.error('Freeze: Node not found', nodeId)
      return
    }

    // Toggle freeze state
    const isFrozen = node.data.frozen || false
    const updatedNodes = currentNodes.map(n => {
      if (n.id === nodeId) {
        return {
          ...n,
          data: {
            ...n.data,
            frozen: !isFrozen,
          },
          className: !isFrozen ? 'opacity-50' : '',
        }
      }
      return n
    })

    setNodes(updatedNodes)
    console.log(isFrozen ? 'Unfroze node:' : 'Froze node:', nodeId)
  }, [getNodes, setNodes])

  const handleStopNode = useCallback((nodeId: string) => {
    const node = getNodes().find(n => n.id === nodeId)

    if (!node) {
      console.error('Stop: Node not found', nodeId)
      return
    }

    // Check if node is currently executing
    const isExecuting = node.data.executionStatus === 'running'

    if (!isExecuting) {
      console.warn('Stop: Node not currently running', nodeId)
      return
    }

    // Stop the node execution
    const updatedNodes = getNodes().map(n => {
      if (n.id === nodeId) {
        return {
          ...n,
          data: {
            ...n.data,
            executionStatus: null,
            isActiveExecution: false,
          },
        }
      }
      return n
    })

    setNodes(updatedNodes)
    console.log('Stopped node:', nodeId)
  }, [getNodes, setNodes])

  const runPreflightCheck = useCallback((options: RunPreflightOptions = {}) => {
    const { openOnSuccess = false, openOnFailure = true } = options
    const currentNodes = getNodes()
    const currentEdges = getEdges()

    if (!currentNodes || currentNodes.length === 0) {
      const emptyResult: PreflightResult = {
        issues: [{
          type: 'configuration',
          message: 'Add a trigger and at least one action before running.',
        }],
        warnings: [],
        checkedAt: new Date().toISOString(),
      }
      setPreflightResult(emptyResult)
      if (openOnFailure) {
        setIsPreflightDialogOpen(true)
      }
      return {
        ok: false,
        issues: emptyResult.issues,
        warnings: emptyResult.warnings,
      }
    }

    const workflowSnapshot = {
      id: currentWorkflow?.id || 'temp-workflow',
      name: workflowName || currentWorkflow?.name || 'Untitled Workflow',
      description: currentWorkflow?.description || null,
      user_id: currentWorkflow?.user_id || '',
      organization_id: currentWorkflow?.organization_id ?? null,
      nodes: currentNodes.map((node) => ({
        id: node.id,
        type: node.type || 'custom',
        position: {
          x: node.position?.x ?? 0,
          y: node.position?.y ?? 0,
        },
        data: {
          label: (node.data as any)?.label ?? (node.data as any)?.title ?? node.id,
          type: (node.data as any)?.type,
          config: (node.data as any)?.config ?? {},
          savedDynamicOptions: (node.data as any)?.savedDynamicOptions,
          providerId: (node.data as any)?.providerId,
          isTrigger: (node.data as any)?.isTrigger ?? false,
          title: (node.data as any)?.title,
          description: (node.data as any)?.description,
          isAIAgentChild: (node.data as any)?.isAIAgentChild,
          parentAIAgentId: (node.data as any)?.parentAIAgentId,
          parentChainIndex: (node.data as any)?.parentChainIndex,
          emptiedChains: (node.data as any)?.emptiedChains,
          validationState: (node.data as any)?.validationState,
        },
      })),
      connections: currentEdges.map((edge) => ({
        id: edge.id,
        source: edge.source,
        target: edge.target,
        sourceHandle: edge.sourceHandle,
        targetHandle: edge.targetHandle,
      })),
      status: currentWorkflow?.status || 'draft',
      created_at: currentWorkflow?.created_at || new Date().toISOString(),
      updated_at: new Date().toISOString(),
      visibility: currentWorkflow?.visibility,
      executions_count: currentWorkflow?.executions_count,
      created_by: currentWorkflow?.created_by,
      validationState: currentWorkflow?.validationState,
    } as Workflow

    const validationResult = validateWorkflowNodes(workflowSnapshot, ALL_NODE_COMPONENTS)

    const validationMap = new Map<string, any>()
    validationResult.nodes.forEach(node => {
      if (node.data?.validationState) {
        validationMap.set(node.id, node.data.validationState)
      }
    })

    setNodes(existingNodes =>
      existingNodes.map(node => {
        const validationState = validationMap.get(node.id)
        if (!validationState) return node
        return {
          ...node,
          data: {
            ...(node.data as any),
            validationState,
          },
        }
      })
    )

    const configurationIssues: PreflightIssue[] = validationResult.nodes
      .filter(node => node.data?.validationState?.missingRequired?.length)
      .map(node => {
        const missing = node.data?.validationState?.missingRequired ?? []
        const title = node.data?.title || node.data?.label || node.data?.type || node.id
        return {
          type: 'configuration',
          nodeId: node.id,
          missingFields: missing,
          message: `${title} is missing required field${missing.length > 1 ? 's' : ''}: ${missing.join(', ')}`,
        }
      })

    const integrationIssues: PreflightIssue[] = []
    const providerNameMap = integrationHook.availableIntegrations?.reduce<Record<string, string>>((acc, integration) => {
      acc[integration.id] = integration.name
      return acc
    }, {}) ?? {}

    validationResult.nodes.forEach(node => {
      const component = ALL_NODE_COMPONENTS.find(c => c.type === node.data?.type)
      const providerId = node.data?.providerId || component?.providerId
      if (!providerId || ['core', 'logic', 'ai', 'manual', 'schedule'].includes(providerId)) {
        return
      }

      if (integrationHook.isIntegrationConnected && integrationHook.isIntegrationConnected(providerId)) {
        return
      }

      const providerName = providerNameMap[providerId] || INTEGRATION_CONFIGS[providerId]?.name || providerId
      const title = node.data?.title || component?.title || node.data?.type || node.id
      integrationIssues.push({
        type: 'integration',
        nodeId: node.id,
        providerId,
        message: `${providerName} connection required for ${title}`,
      })
    })

    const warnings: PreflightIssue[] = []
    validationResult.nodes.forEach(node => {
      if (node.data?.type === 'ai_message') {
        const config = node.data?.config || {}
        const contextIds: string[] = Array.isArray(config.contextNodeIds)
          ? config.contextNodeIds
          : typeof config.contextNodeIds === 'string'
            ? [config.contextNodeIds]
            : []

        const missingContext = contextIds.filter(id => !workflowSnapshot.nodes.some(n => n.id === id))
        if (missingContext.length > 0) {
          warnings.push({
            type: 'ai',
            nodeId: node.id,
            message: `AI Message “${node.data?.title || node.id}” references steps that no longer exist (${missingContext.join(', ')}).`,
          })
        }
      }
    })

    const issues = [...integrationIssues, ...configurationIssues]
    const result: PreflightResult = {
      issues,
      warnings,
      checkedAt: new Date().toISOString(),
    }

    setPreflightResult(result)

    if ((issues.length === 0 && warnings.length === 0 && openOnSuccess) || (issues.length > 0 && openOnFailure) || (issues.length === 0 && warnings.length > 0 && openOnSuccess)) {
      setIsPreflightDialogOpen(true)
    } else if (issues.length === 0 && warnings.length === 0 && !openOnSuccess) {
      setIsPreflightDialogOpen(false)
    }

    return {
      ok: issues.length === 0,
      issues,
      warnings,
    }
  }, [
    getNodes,
    getEdges,
    currentWorkflow?.id,
    currentWorkflow?.description,
    currentWorkflow?.organization_id,
    currentWorkflow?.status,
    currentWorkflow?.created_at,
    currentWorkflow?.updated_at,
    currentWorkflow?.executions_count,
    currentWorkflow?.created_by,
    currentWorkflow?.visibility,
    currentWorkflow?.user_id,
    workflowName,
    integrationHook.availableIntegrations,
    integrationHook.isIntegrationConnected,
  ])

  const openPreflightChecklist = useCallback(() => {
    setIsRunningPreflight(true)
    const result = runPreflightCheck({ openOnSuccess: true, openOnFailure: true })
    setIsRunningPreflight(false)
    if (result.ok && result.warnings.length === 0) {
      toast({
        title: "Preflight check passed",
        description: "All checks completed successfully.",
      })
    }
  }, [runPreflightCheck, toast])

  const handleNodeAddChain = useCallback((nodeId: string) => {
    logger.info('🔗 Add chain to AI Agent:', nodeId)

    const aiAgentNode = nodesRef.current.find(n => n.id === nodeId)
    if (!aiAgentNode) {
      logger.error('AI Agent node not found:', nodeId)
      return
    }

    // Find all existing chains for this AI Agent
    const existingChains = nodesRef.current.filter(n => n.data?.parentAIAgentId === nodeId)

    // Get the highest chain index
    const maxChainIndex = existingChains.reduce((max, node) => {
      const chainIndex = node.data?.parentChainIndex ?? -1
      return Math.max(max, chainIndex)
    }, -1)

    const newChainIndex = maxChainIndex + 1
    logger.info('🔗 Creating chain placeholder for chain index:', newChainIndex)

    // Create chain placeholder node
    const chainPlaceholderId = `chain-placeholder-${nodeId}-${newChainIndex}-${Date.now()}`
    const clickHandler = () => handleAddActionClick(chainPlaceholderId, nodeId)
    addActionHandlersRef.current[chainPlaceholderId] = clickHandler

    // Find the first node in the first chain (chain 0) to determine Y position
    const firstChainFirstNode = existingChains
      .filter(n => n.data?.parentChainIndex === 0 && n.type !== 'chainPlaceholder' && n.type !== 'addAction')
      .sort((a, b) => a.position.y - b.position.y)[0]

    let yPosition: number
    if (firstChainFirstNode) {
      // Use the Y position of the first node in the first chain
      yPosition = firstChainFirstNode.position.y
    } else {
      // If no nodes in chain 0, use default position below AI Agent (consistent with addAction spacing)
      yPosition = aiAgentNode.position.y + 160
    }

    // Find the first node in the highest numbered existing chain to calculate X position
    // maxChainIndex is the highest chain index currently in use
    const highestChainNodes = existingChains
      .filter(n => n.data?.parentChainIndex === maxChainIndex && n.type !== 'addAction')
      .sort((a, b) => a.position.y - b.position.y)

    const highestChainFirstNode = highestChainNodes[0]

    let xPosition: number
    if (highestChainFirstNode) {
      // Place to the right of the highest chain's first node with a gap
      const nodeWidth = 480
      const horizontalGap = 80 // Small gap between chains
      xPosition = highestChainFirstNode.position.x + nodeWidth + horizontalGap
      logger.info('🔗 Positioning to the right of chain', maxChainIndex, 'first node at X:', highestChainFirstNode.position.x, 'new X:', xPosition)
    } else {
      // If no existing chains, use AI Agent's X position
      xPosition = aiAgentNode.position.x
      logger.info('🔗 No existing chains found, using AI Agent X:', xPosition)
    }

    logger.info('🔗 Chain placeholder position:', { x: xPosition, y: yPosition, chainIndex: newChainIndex })

    const chainPlaceholderNode: Node = {
      id: chainPlaceholderId,
      type: 'chainPlaceholder',
      position: {
        x: xPosition,
        y: yPosition
      },
      draggable: false,
      selectable: false,
      data: {
        type: 'chainPlaceholder',
        parentId: nodeId,
        parentAIAgentId: nodeId,
        parentChainIndex: newChainIndex,
        onClick: clickHandler
      }
    }

    // Add the chain placeholder node
    setNodes(nds => [...nds, chainPlaceholderNode])

    // Add edge connecting AI Agent to chain placeholder
    const edgeId = `e-${nodeId}-${chainPlaceholderId}`
    setEdges(edges => [
      ...edges,
      {
        id: edgeId,
        source: nodeId,
        target: chainPlaceholderId,
        type: 'smoothstep',
        animated: false
      }
    ])

    logger.info('🔗 Chain placeholder created:', chainPlaceholderId, 'for chain index:', newChainIndex)
  }, [setNodes, setEdges, handleAddActionClick])

  // Now we can define the actual undo/redo implementation
  useEffect(() => {
    handleUndoRef.current = () => {
      const previousState = historyHook.undo()
      if (previousState) {
        // Restore nodes and edges from history
        setNodes(previousState.nodes)
        setEdges(previousState.edges)

        setHasUnsavedChanges(true)
        toast({
          title: "Undo",
          description: "Action undone",
        })
      }
    }

    handleRedoRef.current = () => {
      const nextState = historyHook.redo()
      if (nextState) {
        // Restore nodes and edges from history
        setNodes(nextState.nodes)
        setEdges(nextState.edges)

        setHasUnsavedChanges(true)
        toast({
          title: "Redo",
          description: "Action redone",
        })
      }
    }
  }, [historyHook, setNodes, setEdges, toast, setHasUnsavedChanges])

  // Track changes for undo/redo
  const trackChange = useCallback((newNodes?: Node[], newEdges?: Edge[]) => {
    const nodesToTrack = newNodes || nodes
    const edgesToTrack = newEdges || edges
    historyHook.pushState(nodesToTrack, edgesToTrack)
  }, [nodes, edges, historyHook])

  // Set trackChange ref
  useEffect(() => {
    trackChangeRef.current = trackChange
  }, [trackChange])

  // For now, just create placeholder functions that will be updated
  const handleUndo = useCallback(() => {
    if (!handleUndoRef.current) {
      logger.info('Undo handler not yet initialized')
      return
    }
    handleUndoRef.current()
  }, [])

  const handleRedo = useCallback(() => {
    if (!handleRedoRef.current) {
      logger.info('Redo handler not yet initialized')
      return
    }
    handleRedoRef.current()
  }, [])

  // Keyboard shortcuts for undo/redo
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const isMac = navigator.platform.toUpperCase().indexOf('MAC') >= 0
      const ctrlOrCmd = isMac ? e.metaKey : e.ctrlKey

      if (ctrlOrCmd && e.key === 'z' && !e.shiftKey) {
        e.preventDefault()
        handleUndo()
      } else if ((ctrlOrCmd && e.key === 'y') || (ctrlOrCmd && e.shiftKey && e.key === 'z')) {
        e.preventDefault()
        handleRedo()
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [handleUndo, handleRedo])

  // Load workflow when ID changes
  useEffect(() => {
    if (workflowId && workflows && workflows.length > 0) {
      const workflow = workflows.find(w => w.id === workflowId)
      if (workflow) {
        // Clear history when loading a new workflow
        historyHook.clearHistory()

        // Set loading flag to prevent name sync effect from running during load
        isLoadingWorkflowRef.current = true

        setCurrentWorkflow(workflow)
        setWorkflowName(workflow.name)
        setWorkflowDescription(workflow.description || "")

        // Load nodes and edges from normalized tables asynchronously
        const loadWorkflowGraph = async () => {
          try {
            const [nodesResult, edgesResult] = await Promise.all([
              supabase.from('workflow_nodes').select('*').eq('workflow_id', workflowId).order('display_order'),
              supabase.from('workflow_edges').select('*').eq('workflow_id', workflowId)
            ])

            // Handle errors gracefully - workflow may use JSONB storage instead of normalized tables
            if (nodesResult.error) {
              // Only log once per session to avoid console spam
              if (typeof window !== 'undefined' && !(window as any).__wfNodesErrorLogged) {
                (window as any).__wfNodesErrorLogged = true
                console.debug('[WorkflowBuilder] Could not load from workflow_nodes table:', nodesResult.error.message)
              }
            }
            if (edgesResult.error) {
              if (typeof window !== 'undefined' && !(window as any).__wfEdgesErrorLogged) {
                (window as any).__wfEdgesErrorLogged = true
                console.debug('[WorkflowBuilder] Could not load from workflow_edges table:', edgesResult.error.message)
              }
            }

            // Map normalized nodes to WorkflowNode format
            const loadedNodes: WorkflowNode[] = (nodesResult.data || []).map((n: any) => ({
            id: n.id,
            type: 'custom',  // React Flow component type - always 'custom' for workflow nodes
            position: { x: n.position_x, y: n.position_y },
            data: {
              type: n.node_type,  // Action type (e.g., 'gmail_trigger_new_email')
              label: n.label,
              title: n.label,
              config: n.config || {},
              isTrigger: n.is_trigger,
              providerId: n.provider_id
            }
          }))

          // Map normalized edges to WorkflowConnection format
          const loadedConnections: WorkflowConnection[] = (edgesResult.data || []).map((e: any) => ({
            id: e.id,
            source: e.source_node_id,
            target: e.target_node_id,
            sourceHandle: e.source_port_id || 'source',
            targetHandle: e.target_port_id || 'target'
          }))

          return { nodes: loadedNodes, connections: loadedConnections }
          } catch (error) {
            // Gracefully handle errors - return empty arrays to fall back to JSONB storage
            console.debug('[WorkflowBuilder] Error loading normalized workflow graph:', error)
            return { nodes: [], connections: [] }
          }
        }

        loadWorkflowGraph().then(({ nodes: workflowNodes, connections: workflowConnections }) => {
        // Convert workflow nodes and connections to React Flow format
        let allNodes: Node[] = []

        if (workflowNodes && workflowNodes.length > 0) {
          // Sanitize: drop any UI-only or malformed nodes that can appear from older saves
          const sanitizedNodes = workflowNodes.filter((node: any) => {
            // Remove placeholder UI nodes by type or id pattern
            if (node?.type === 'addAction') return false
            if (typeof node?.id === 'string' && node.id.startsWith('add-action-')) return false
            // Remove nodes with no actionable type (but keep triggers explicitly marked)
            const hasType = Boolean(node?.data?.type)
            const isTrigger = Boolean(node?.data?.isTrigger)
            return hasType || isTrigger
          })

          const flowNodes = sanitizedNodes.map((node: WorkflowNode) => ({
            id: node.id,
            type: node.type || 'custom',
            position: node.position,
            data: {
              ...node.data,
              // Ensure providerId is set for proper logo display
              providerId: (() => {
                // First check if providerId is already set
                if (node.data?.providerId) return node.data.providerId
                
                // Try to extract from type
                const type = node.data?.type
                if (!type) return null
                
                // Handle different type formats
                if (type.includes('_trigger_')) {
                  return type.split('_')[0] // gmail_trigger_new_email -> gmail
                } else if (type.includes('_')) {
                  return type.split('_')[0] // gmail_action_send_email -> gmail
                } else if (type.includes(':')) {
                  return type.split(':')[0] // google-drive:upload -> google-drive
                }
                
                // Look up the component to get providerId
                const component = ALL_NODE_COMPONENTS.find(c => c.type === type)
                return component?.providerId || null
              })(),
              // Ensure a human-readable title exists for actions; fallback to component title or type
              title: (() => {
                const existing = (node.data as any)?.title
                if (existing && typeof existing === 'string' && existing.trim().length > 0) return existing
                const comp = ALL_NODE_COMPONENTS.find(c => c.type === (node.data as any)?.type)
                return comp?.title || (node.data as any)?.type || 'Unnamed Action'
              })(),
              // Ensure description is populated from component definition
              description: (() => {
                const existing = (node.data as any)?.description
                if (existing && typeof existing === 'string' && existing.trim().length > 0) return existing
                const comp = ALL_NODE_COMPONENTS.find(c => c.type === (node.data as any)?.type)
                return comp?.description || ''
              })(),
              onConfigure: handleNodeConfigure,
              onDelete: handleNodeDelete,
              onEditingStateChange: handleNodeEditingStateChange,
              onRename: handleNodeRename,
              onAddChain: node.data?.type === 'ai_agent' ? handleNodeAddChain : undefined,
              onTestNode: handleTestNode,
              onTestFlowFromHere: handleTestFlowFromHere,
              onFreeze: handleFreezeNode,
              onStop: handleStopNode
            }
          }))

          // Normalize spacing for AI agent chain nodes
          // This ensures consistent spacing even if workflow was saved with old spacing values
          const aiAgentIds = new Set(
            flowNodes.filter((n: any) => n.data?.type === 'ai_agent').map((n: any) => n.id)
          )

          // Group chain nodes by AI agent and chain index
          const chainNodesByAgent = new Map<string, Map<number, any[]>>()
          flowNodes.forEach((node: any) => {
            if (node.data?.parentAIAgentId && aiAgentIds.has(node.data.parentAIAgentId)) {
              const agentId = node.data.parentAIAgentId
              const chainIndex = node.data.parentChainIndex ?? 0

              if (!chainNodesByAgent.has(agentId)) {
                chainNodesByAgent.set(agentId, new Map())
              }
              const chainMap = chainNodesByAgent.get(agentId)!
              if (!chainMap.has(chainIndex)) {
                chainMap.set(chainIndex, [])
              }
              chainMap.get(chainIndex)!.push(node)
            }
          })

          // Recalculate positions for each chain
          chainNodesByAgent.forEach((chainMap, agentId) => {
            const aiAgentNode = flowNodes.find((n: any) => n.id === agentId)
            if (!aiAgentNode) return

            chainMap.forEach((chainNodes, chainIndex) => {
              // Sort by Y position
              chainNodes.sort((a, b) => a.position.y - b.position.y)

              // Recalculate Y positions with 120px spacing
              chainNodes.forEach((node, index) => {
                node.position.y = aiAgentNode.position.y + 160 + (index * 120)
              })
            })
          })

          // No longer adding AddActionNodes - users add nodes via drag and connect
          allNodes = [...flowNodes]

          setNodes(allNodes)
        }

        if (workflowConnections && workflowConnections.length > 0) {
          // Filter out edges that reference nodes we filtered out above
          const validNodeIds = new Set(allNodes.map(n => n.id))
          const seenEdgeKey = new Set<string>()
          const seenIds = new Set<string>()
          const flowEdges = [] as any[]
          for (const conn of workflowConnections) {
            if (!conn?.source || !conn?.target) continue
            // Skip edges to/from AddActionNodes (they should be created dynamically)
            if (conn.source.includes('add-action') || conn.target.includes('add-action')) {
              // logger.info('Skipping saved AddActionNode edge:', conn.id)
              continue
            }
            if (!validNodeIds.has(conn.source) || !validNodeIds.has(conn.target)) continue
            const key = `${conn.source}->${conn.target}`
            if (seenEdgeKey.has(key)) continue
            seenEdgeKey.add(key)
            let id = conn.id || `e-${conn.source}-${conn.target}`
            if (seenIds.has(id)) {
              id = `e-${conn.source}-${conn.target}-${Date.now()}-${Math.random().toString(36).slice(2,6)}`
            }
            seenIds.add(id)
            flowEdges.push({
              id,
              source: conn.source,
              target: conn.target,
              type: (conn as any).type || 'custom',
              animated: (conn as any).animated ?? false,
              style: (conn as any).style || {
                stroke: "#9ca3af",
                strokeWidth: 2,
                strokeLinecap: "round",
                strokeLinejoin: "round"
              }
            })
          }

          // No longer adding edges to AddActionNodes - users connect nodes manually

          setEdges(flowEdges)
        }

        // Push initial state to history after loading
        setTimeout(() => {
          const currentNodes = getNodes()
          const currentEdges = getEdges()
          if (currentNodes.length > 0) {
            historyHook.pushState(currentNodes, currentEdges)
          }
        }, 200)

        // Join collaboration only if not already joined for this workflow
        if (collaborationWorkflowIdRef.current !== workflowId) {
          collaborationWorkflowIdRef.current = workflowId
          joinCollaboration(workflowId)
        }

        // Set workflow for error tracking
        setErrorStoreWorkflow(workflow)

        // Fit view after loading with offset to prevent nodes from going under top UI
        setTimeout(() => {
          fitView({
            padding: 0.2,
            includeHiddenNodes: false,
            minZoom: 0.5,
            maxZoom: 2,
            offset: { x: 0, y: 40 }
          })

          // Don't run cleanup automatically to avoid interfering with normal operations
          // The workflow loading already creates Add Actions correctly

          // Clear loading flag after workflow is fully loaded
          isLoadingWorkflowRef.current = false
        }, 100)
        }) // End of loadWorkflowGraph().then()
      } else {
        if (directFetchStatus === 'idle' || directFetchStatus === 'loading' || directFetchStatus === 'success') {
          return
        }

        if (directFetchStatus === 'error' && !hasHandledDirectFetchError) {
          // Flow V2 behavior: silently handle errors
          setHasHandledDirectFetchError(true)
          return
        }
      }
    }

    return () => {
      // Only leave collaboration when workflowId actually changes or component unmounts
      const currentWorkflowId = collaborationWorkflowIdRef.current
      if (currentWorkflowId && currentWorkflowId !== workflowId) {
        leaveCollaboration()
        collaborationWorkflowIdRef.current = null
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workflowId, workflows, workflowLoading, directFetchStatus, hasHandledDirectFetchError])

  // Cleanup collaboration on component unmount
  useEffect(() => {
    return () => {
      if (collaborationWorkflowIdRef.current) {
        // Fetch fresh leaveCollaboration from store on unmount
        const { leaveCollaboration: leave } = useCollaborationStore.getState()
        leave()
        collaborationWorkflowIdRef.current = null
      }
    }
  // Empty deps - only run on mount/unmount
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (!isTemplateEditing || !editTemplateId) {
      templateLoadStateRef.current = null
      setTemplateDraftMetadata({
        primarySetupTarget: null,
        setupOverview: null,
        integrationSetup: [],
        defaultFieldValues: {},
        status: 'draft',
      })
      setTemplatePublishedMetadata(null)
      setTemplateAssets([])
      return
    }

    const currentState = templateLoadStateRef.current

    if (currentState?.id === editTemplateId) {
      if (currentState.status === "pending") {
        return
      }
      if (currentState.status === "fulfilled" || currentState.status === "rejected") {
        setIsTemplateLoading(false)
        return
      }
    }

    const abortController = new AbortController()
    let isCancelled = false

    templateLoadStateRef.current = { id: editTemplateId, status: "pending" }
    setIsTemplateLoading(true)

    const loadTemplateForEditing = async () => {
      try {
        historyHook.clearHistory()

        const response = await fetch(`/api/templates/${editTemplateId}`, {
          signal: abortController.signal
        })

        if (!response.ok) {
          const errorBody = await response.json().catch(() => ({}))
          throw new Error(errorBody.error || `Failed to load template (${response.status})`)
        }

        const payload = await response.json()
        if (isCancelled || abortController.signal.aborted) {
          return
        }

        const templateRecord = payload.template || {}
        const rawNodes: WorkflowNode[] = Array.isArray(payload.nodes)
          ? payload.nodes
          : Array.isArray(templateRecord.nodes)
            ? templateRecord.nodes
            : []
        const rawConnections: WorkflowConnection[] = Array.isArray(payload.connections)
          ? payload.connections
          : Array.isArray(templateRecord.connections)
            ? templateRecord.connections
            : []

        const sanitizedNodes = rawNodes.filter((node: any) => {
          if (!node) return false
          const nodeType = node?.data?.type || node?.type
          if (nodeType === 'addAction' || nodeType === 'insertAction' || nodeType === 'chain_placeholder') {
            return false
          }
          if (node?.type === 'addAction' || node?.type === 'insertAction' || node?.type === 'chainPlaceholder') {
            return false
          }
          if (typeof node?.id === 'string' && (node.id.startsWith('add-action-') || node.id.startsWith('chain-placeholder-'))) {
            return false
          }
          if (node?.data?.isPlaceholder) {
            return false
          }
          const hasType = Boolean(node?.data?.type)
          const isTrigger = Boolean(node?.data?.isTrigger)
          return hasType || isTrigger
        }) as WorkflowNode[]

        const publishedDefaultValues = cloneDeep(parseJson<Record<string, any>>(templateRecord.default_field_values, {}))
        const publishedIntegrationSetup = cloneDeep(parseJson<TemplateIntegrationSetup[]>(templateRecord.integration_setup, []))
        const publishedOverview = cloneDeep(parseJson<TemplateSetupOverview>(templateRecord.setup_overview, null))
        const publishedPrimaryTarget = templateRecord.primary_setup_target ?? null

        setTemplatePublishedMetadata({
          primarySetupTarget: publishedPrimaryTarget,
          setupOverview: publishedOverview,
          integrationSetup: publishedIntegrationSetup,
          defaultFieldValues: publishedDefaultValues,
          publishedAt: templateRecord.published_at ?? null,
        })

        let draftMetadata: TemplateDraftMetadata = {
          primarySetupTarget: publishedPrimaryTarget,
          setupOverview: publishedOverview,
          integrationSetup: publishedIntegrationSetup,
          defaultFieldValues: publishedDefaultValues,
          status: templateRecord.status ?? 'draft',
        }

        const flowNodes: Node[] = sanitizedNodes.map((node: WorkflowNode) => {
          const safeData = node.data || {}
          return {
            id: node.id,
            type: node.type || 'custom',
            position: node.position || { x: 0, y: 0 },
            data: {
              ...safeData,
              providerId: (() => {
                if (safeData.providerId) return safeData.providerId
                const type = safeData.type
                if (!type || typeof type !== 'string') return null
                if (type.includes('_trigger_')) {
                  return type.split('_')[0]
                }
                if (type.includes('_')) {
                  return type.split('_')[0]
                }
                if (type.includes(':')) {
                  return type.split(':')[0]
                }
                const component = ALL_NODE_COMPONENTS.find(c => c.type === type)
                return component?.providerId || null
              })(),
              title: (() => {
                const existing = safeData.title
                if (existing && typeof existing === 'string' && existing.trim().length > 0) {
                  return existing
                }
                const comp = ALL_NODE_COMPONENTS.find(c => c.type === safeData.type)
                return comp?.title || safeData.type || (safeData.isTrigger ? 'Trigger' : 'Unnamed Action')
              })(),
              onConfigure: handleNodeConfigure,
              onDelete: handleNodeDelete,
              onEditingStateChange: handleNodeEditingStateChange,
              onRename: handleNodeRename,
              onAddChain: safeData.type === 'ai_agent' ? handleNodeAddChain : undefined,
              onTestNode: handleTestNode,
              onTestFlowFromHere: handleTestFlowFromHere,
              onFreeze: handleFreezeNode,
              onStop: handleStopNode
            }
          }
        })

        setNodes(flowNodes)

        const validNodeIds = new Set(flowNodes.map(node => node.id))
        const seenEdgeKey = new Set<string>()
        const seenIds = new Set<string>()
        const flowEdges: Edge[] = []

        rawConnections.forEach((conn: WorkflowConnection) => {
          if (!conn?.source || !conn?.target) return
          if (conn.source.includes('add-action') || conn.target.includes('add-action')) return
          if (!validNodeIds.has(conn.source) || !validNodeIds.has(conn.target)) return

          const edgeKey = `${conn.source}->${conn.target}`
          if (seenEdgeKey.has(edgeKey)) return
          seenEdgeKey.add(edgeKey)

          let id = conn.id || `e-${conn.source}-${conn.target}`
          if (seenIds.has(id)) {
            id = `e-${conn.source}-${conn.target}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`
          }
          seenIds.add(id)

          flowEdges.push({
            id,
            source: conn.source,
            target: conn.target,
            type: (conn as any)?.type || 'custom',
            animated: (conn as any)?.animated ?? false,
            style: (conn as any)?.style || {
              stroke: "#9ca3af",
              strokeWidth: 2,
              strokeLinecap: "round",
              strokeLinejoin: "round"
            }
          })
        })

        setEdges(flowEdges)

        setWorkflowName(templateRecord.name || "Untitled Template")
        setWorkflowDescription(templateRecord.description || "")
        setHasUnsavedChanges(false)

        const templateWorkflow: Workflow = {
          id: templateRecord.id || editTemplateId,
          name: templateRecord.name || "Untitled Template",
          description: templateRecord.description || "",
          user_id: templateRecord.created_by || templateRecord.user_id || templateRecord.author_id || "",
          nodes: sanitizedNodes,
          connections: rawConnections,
          status: 'template_draft',
          created_at: templateRecord.created_at || new Date().toISOString(),
          updated_at: templateRecord.updated_at || new Date().toISOString(),
        }

        setCurrentWorkflow(templateWorkflow)
        setErrorStoreWorkflow(templateWorkflow)
        templateLoadStateRef.current = { id: editTemplateId, status: "fulfilled" }

        if (!abortController.signal.aborted) {
          try {
            const draftResponse = await fetch(`/api/templates/${editTemplateId}/draft`, {
              signal: abortController.signal,
            })
            if (draftResponse.ok) {
              const draftPayload = await draftResponse.json()
              const draft = draftPayload?.draft || {}

              draftMetadata = {
                primarySetupTarget: draft.primary_setup_target ?? draftMetadata.primarySetupTarget,
                setupOverview: draft.setup_overview ?? draftMetadata.setupOverview,
                integrationSetup: Array.isArray(draft.integration_setup)
                  ? cloneDeep(draft.integration_setup)
                  : draftMetadata.integrationSetup,
                defaultFieldValues: cloneDeep(draft.default_field_values ?? draftMetadata.defaultFieldValues ?? {}),
                status: draft.status ?? draftMetadata.status,
              }

              if (
                draft.published_default_field_values ||
                draft.published_integration_setup ||
                draft.published_setup_overview ||
                typeof draft.published_at !== 'undefined'
              ) {
                setTemplatePublishedMetadata({
                  primarySetupTarget: draft.primary_setup_target ?? draftMetadata.primarySetupTarget,
                  setupOverview: cloneDeep(draft.published_setup_overview ?? publishedOverview),
                  integrationSetup: cloneDeep(draft.published_integration_setup ?? publishedIntegrationSetup),
                  defaultFieldValues: cloneDeep(draft.published_default_field_values ?? publishedDefaultValues),
                  publishedAt: draft.published_at ?? templateRecord.published_at ?? null,
                })
              }
            }
          } catch (draftError) {
            if (!abortController.signal.aborted) {
              logger.warn('[WorkflowBuilder] Failed to load template draft metadata', draftError)
            }
          }

          try {
            const assetResponse = await fetch(`/api/templates/${editTemplateId}/assets`, {
              signal: abortController.signal,
            })
            if (assetResponse.ok) {
              const assetPayload = await assetResponse.json()
              const assets = Array.isArray(assetPayload.assets) ? assetPayload.assets : []
              setTemplateAssets(assets)
            } else if (assetResponse.status !== 404) {
              const assetErrorBody = await assetResponse.json().catch(() => ({}))
              logger.warn('[WorkflowBuilder] Failed to fetch template assets', assetErrorBody)
            }
          } catch (assetError) {
            if (!abortController.signal.aborted) {
              logger.warn('[WorkflowBuilder] Failed to load template assets', assetError)
            }
          }
        }

        setTemplateDraftMetadata(draftMetadata)

        const safeRun = (fn: () => void, delay: number) => {
          setTimeout(() => {
            if (isCancelled || abortController.signal.aborted) return
            fn()
          }, delay)
        }

        safeRun(() => {
          const currentNodesSnapshot = getNodes()
          const currentEdgesSnapshot = getEdges()
          if (currentNodesSnapshot.length > 0) {
            historyHook.pushState(currentNodesSnapshot, currentEdgesSnapshot)
          }
        }, 200)

        safeRun(() => {
          fitView({
            padding: 0.2,
            includeHiddenNodes: false,
            minZoom: 0.5,
            maxZoom: 2,
            offset: { x: 0, y: 40 }
          })
        }, 150)
      } catch (error: any) {
        if (isCancelled || abortController.signal.aborted) {
          return
        }
        templateLoadStateRef.current = { id: editTemplateId, status: "rejected" }
        logger.error('Failed to load template for editing:', error)
        toast({
          title: "Error",
          description: error?.message || "Failed to load template",
          variant: "destructive",
        })
      } finally {
        if (!isCancelled && !abortController.signal.aborted) {
          setIsTemplateLoading(false)
        }
      }
    }

    void loadTemplateForEditing()

    return () => {
      isCancelled = true
      abortController.abort()
      const state = templateLoadStateRef.current
      if (state?.id === editTemplateId && state.status === "pending") {
        templateLoadStateRef.current = null
      }
    }
    // We intentionally limit dependencies to avoid effect loops.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isTemplateEditing, editTemplateId])

  // Sync workflow name changes to store
  // Uses a ref to track if we're currently in the loading phase to prevent infinite loops
  const isLoadingWorkflowRef = useRef(false)

  useEffect(() => {
    if (!currentWorkflow?.id) return
    if (currentWorkflow.name === workflowName) return

    // Don't update during initial workflow load to prevent loop with loading effect
    if (isLoadingWorkflowRef.current) return

    const updatedWorkflow = { ...currentWorkflow, name: workflowName }
    setCurrentWorkflow(updatedWorkflow)
    useWorkflowStore.setState((state) => ({
      workflows: state.workflows.map((workflow) =>
        workflow.id === updatedWorkflow.id ? { ...workflow, name: workflowName } : workflow
      )
    }))
  }, [currentWorkflow?.id, currentWorkflow?.name, workflowName])

  // Note: handleSave and handleToggleLive now come from useWorkflowSaveActions hook above

  // Use refs for undo/redo handlers to avoid initialization issues
  const handleUndoRef = useRef<(() => void) | null>(null)
  const handleRedoRef = useRef<(() => void) | null>(null)
  const trackChangeRef = useRef<((newNodes?: Node[], newEdges?: Edge[]) => void) | null>(null)

  // Handle node connection
  const onConnect = useCallback((params: Connection) => {
    if (!params.source || !params.target) return

    const newEdge: Edge = {
      id: `${params.source}-${params.target}`,
      source: params.source,
      target: params.target,
      type: 'custom',
      animated: false,
      style: { stroke: "#9ca3af", strokeWidth: 2, strokeLinecap: "round" }
    }

    setEdges((eds) => {
      const newEdges = [...eds, newEdge]
      // Track change after edge is added
      setTimeout(() => trackChangeRef.current?.(nodes, newEdges), 100)
      return newEdges
    })
    markAsUnsaved()
  }, [setEdges, nodes, trackChange, markAsUnsaved])

  // Process edges to add handleAddNodeBetween and selection styling
  const processedEdges = useMemo(() => {
    return edges.map(edge => {
      // Add selected styling
      const isSelected = edge.id === selectedEdgeId
      const edgeStyle = {
        ...edge.style,
        stroke: isSelected ? '#3b82f6' : edge.style?.stroke || '#9ca3af',
        strokeWidth: isSelected ? 3 : edge.style?.strokeWidth || 2,
        strokeLinecap: 'round' as const,
        strokeLinejoin: 'round' as const,
      }

      if (edge.type === 'custom') {
        // No longer adding onAddNode handler - users add nodes via drag and connect
        return {
          ...edge,
          style: edgeStyle,
        }
      }
      // Return edge with selected styling for non-custom edges
      return {
        ...edge,
        style: edgeStyle
      }
    })
  }, [edges, nodes, dialogsHook, selectedEdgeId])

  // Determine loading state with timeout protection
  const [loadingStartTime, setLoadingStartTime] = useState<number | null>(null)
  const MAX_LOADING_TIME = 60000 // 60 seconds max loading time (increased to handle complex workflows)

  const shouldShowLoading = () => {
    if (isTemplateEditing && isTemplateLoading) {
      if (loadingStartTime && Date.now() - loadingStartTime > MAX_LOADING_TIME) {
        logger.info('[WorkflowBuilder] Template loading timeout reached, hiding loading screen')
        return false
      }
      return true
    }
    // If we have a workflow ID but no current workflow, we're loading
    if (workflowId && !currentWorkflow) {
      // But not if we've been loading for too long
      if (loadingStartTime && Date.now() - loadingStartTime > MAX_LOADING_TIME) {
        logger.info('[WorkflowBuilder] Loading timeout reached, hiding loading screen')
        // Don't call toast here - it causes infinite render loop
        // Toast notification is handled in a useEffect below
        return false
      }
      return true
    }
    // Only show loading for integrations if we have no workflows yet
    if (integrationsLoading && workflows.length === 0) {
      if (loadingStartTime && Date.now() - loadingStartTime > MAX_LOADING_TIME) {
        return false
      }
      return true
    }
    // Show loading if workflows are loading and we don't have a current workflow
    if (workflowLoading && !currentWorkflow) {
      if (loadingStartTime && Date.now() - loadingStartTime > MAX_LOADING_TIME) {
        return false
      }
      return true
    }
    return false
  }

  const isLoading = shouldShowLoading()

  // Track when loading starts
  useEffect(() => {
    if (isLoading && !loadingStartTime) {
      setLoadingStartTime(Date.now())
    } else if (!isLoading && loadingStartTime) {
      setLoadingStartTime(null)
    }
  }, [isLoading, loadingStartTime])

  // Show timeout toast when loading takes too long
  // This is separate from render to avoid infinite loops
  useEffect(() => {
    if (!loadingStartTime) {
      // Reset the flag when loading stops
      timeoutToastShownRef.current = false
      return
    }

    const checkTimeout = () => {
      if (timeoutToastShownRef.current) return // Already shown

      if (loadingStartTime && Date.now() - loadingStartTime > MAX_LOADING_TIME) {
        timeoutToastShownRef.current = true
        // Only log, don't show toast - the loading screen will automatically hide
        logger.info('[WorkflowBuilder] Loading timeout of 60s reached - hiding loading screen')
      }
    }

    // Check timeout periodically
    const intervalId = setInterval(checkTimeout, 1000)

    return () => clearInterval(intervalId)
  }, [loadingStartTime, toast])
  // Track loading state changes
  useEffect(() => {
    if (isLoading && !hasShownLoading) {
      setHasShownLoading(true)
    } else if (!isLoading && hasShownLoading) {
      setHasShownLoading(false)
    }
  }, [isLoading, hasShownLoading])

  // Handle trigger selection
  const handleTriggerSelect = useCallback((integration: IntegrationInfo, trigger: NodeComponent) => {
    if (configHook.nodeNeedsConfiguration(trigger)) {
      // Store the pending trigger info and open configuration
      configHook.setPendingNode({ type: 'trigger', integration, nodeComponent: trigger })
      configHook.setConfiguringNode({
        id: 'pending-trigger',
        integration,
        nodeComponent: trigger,
        config: {}
      })
    } else {
      // Add trigger without configuration (e.g., manual trigger)
      // Use UUID for database compatibility (workflow_nodes.id is uuid type)
      const newNodeId = crypto.randomUUID()
      const newNode: Node = {
        id: newNodeId,
        type: 'custom',
        position: { x: 250, y: 100 },
        data: {
          title: trigger.title,
          description: trigger.description,
          type: trigger.type,
          isTrigger: true,
          config: {},
          providerId: trigger.providerId || integration.id,
          onConfigure: handleNodeConfigure,
          onDelete: handleNodeDelete,
          onEditingStateChange: handleNodeEditingStateChange,
          onRename: handleNodeRename,
          onTestNode: handleTestNode,
          onTestFlowFromHere: handleTestFlowFromHere,
          onFreeze: handleFreezeNode,
          onStop: handleStopNode
        }
      }

      // Check if we're replacing a deleted trigger
      const replacingTrigger = deletedTriggerBackupRef.current
      const firstActionEdge = replacingTrigger?.edges.find(e =>
        e.source === replacingTrigger.node.id &&
        !e.target.startsWith('add-action-')
      )

      // Add the trigger node - no longer adding AddActionNodes
      setNodes(nds => [...nds, newNode])

      // Add edges only if replacing a trigger with existing connections
      if (firstActionEdge) {
        setEdges(eds => {
          const reconnectedEdge: Edge = {
            id: `e-${newNodeId}-${firstActionEdge.target}`,
            source: newNodeId,
            target: firstActionEdge.target,
            type: firstActionEdge.type,
            animated: firstActionEdge.animated,
            style: firstActionEdge.style
          }
          return [...eds, reconnectedEdge]
        })
      }

      // Auto-fit view after adding trigger to keep everything visible
      setTimeout(() => {
        if (fitView) {
          fitView({
            padding: 0.2,
            includeHiddenNodes: false,
            minZoom: 0.5,
            maxZoom: 2,
            duration: 400,
            offset: { x: 0, y: 40 }
          })
        }
      }, 100)

      setHasUnsavedChanges(true)
    }
    dialogsHook.setShowTriggerDialog(false)
    // Only clear the backup if this trigger doesn't need configuration
    // (if it needs config, backup will be cleared on successful save or restored on cancel)
    if (!configHook.nodeNeedsConfiguration(trigger)) {
      deletedTriggerBackupRef.current = null
    }
  }, [
    configHook,
    dialogsHook,
    handleNodeConfigure,
    handleNodeDelete,
    handleNodeEditingStateChange,
    handleNodeRename,
    setNodes,
    setEdges,
    addActionHandlersRef,
    handleAddActionClick,
    getCenteredAddActionX,
    fitView,
    setHasUnsavedChanges
  ])

  // Handle trigger dialog close (for restoration logic)
  const handleTriggerDialogClose = useCallback((open: boolean) => {
    // Always call the original setter first
    dialogsHook.setShowTriggerDialog(open)

    // Only handle restoration when dialog is actually closing and we have a backup
    if (!open && deletedTriggerBackupRef.current) {
      // Store backup in local variable to avoid null issues
      const backup = deletedTriggerBackupRef.current

      // Clear backup immediately to prevent re-processing
      deletedTriggerBackupRef.current = null

      // Small delay to let the dialog close and any pending trigger selection complete
      setTimeout(() => {
        // Check if a new trigger was selected or is being configured
        const hasNewTrigger = getNodes().some(n => {
          const comp = ALL_NODE_COMPONENTS.find(c => c.type === n.data?.type)
          return comp?.isTrigger === true
        })

        const isPendingTriggerConfig = configHook.pendingNode?.type === 'trigger'

        if (!hasNewTrigger && !isPendingTriggerConfig && backup) {
          // No new trigger selected and no pending configuration - restore the old one
          setNodes((prevNodes) => [...prevNodes, backup.node])
          // Deduplicate edges when restoring backup to prevent duplicate key errors
          setEdges((prevEdges) => {
            const existingIds = new Set(prevEdges.map(e => e.id))
            const newEdges = backup.edges.filter((e: Edge) => !existingIds.has(e.id))
            return [...prevEdges, ...newEdges]
          })
        }
      }, 100)
    }
  }, [getNodes, setNodes, setEdges, dialogsHook, configHook])

  // Handle action selection
  const handleActionSelect = useCallback((integration: IntegrationInfo, action: NodeComponent) => {
    // logger.info('🟣 [handleActionSelect] Called with:', {
    //   integration: integration?.name,
    //   action: action?.type,
    //   sourceAddNode: dialogsHook.sourceAddNode,
    //   hasSourceAddNode: !!dialogsHook.sourceAddNode
    // })

    // Check if trying to add an AI Agent when one already exists
    if (action.type === 'ai_agent') {
      const existingAIAgent = nodes.find(n => n.data?.type === 'ai_agent')
      if (existingAIAgent) {
        toast({
          title: "AI Agent Already Exists",
          description: "You can only have one AI Agent node per workflow.",
          variant: "destructive"
        })
        return
      }
    }

    if (configHook.nodeNeedsConfiguration(action)) {
      const sourceInfo = dialogsHook.sourceAddNode

      // Check if this is for an AI Agent chain - if so, auto-create config with AI fields
      if (sourceInfo?.isAIAgentAction) {
        logger.info('🤖 [handleActionSelect] AI Agent action - creating auto config with AI fields', {
          actionType: action.type,
          actionTitle: action.title,
          sourceInfo
        })

        // Create config with _allFieldsAI flag to indicate all fields should use AI
        // Except for certain fields that are needed for configuration (selectors)
        const aiConfig: Record<string, any> = {
          _allFieldsAI: true,  // Flag to indicate all fields should be AI-generated
        }

        logger.info('🤖 [handleActionSelect] Created aiConfig:', aiConfig)

        // Add the action directly with AI config and chain metadata
        handleAddAction(integration, action, aiConfig, sourceInfo)

        // Close the dialog
        dialogsHook.setShowActionDialog(false)
        return
      }

      // Make a deep copy of sourceInfo to preserve it
      const preservedSourceInfo = sourceInfo ? { ...sourceInfo } : undefined

      // Store the pending action info and open configuration
      configHook.setPendingNode({
        type: 'action',
        integration,
        nodeComponent: action,
        sourceNodeInfo: preservedSourceInfo  // Use the preserved copy
      })
      configHook.setConfiguringNode({
        id: 'pending-action',
        integration,
        nodeComponent: action,
        config: {}
      })

      // Close dialog AFTER setting pending node to ensure state is saved
      setTimeout(() => {
        dialogsHook.setShowActionDialog(false)
      }, 0)
    } else {
      // Add action without configuration
      const sourceInfo = dialogsHook.sourceAddNode
      logger.info('🟣 [handleActionSelect] Node does NOT need configuration, adding directly with sourceNodeInfo:', sourceInfo)

      if (sourceInfo) {
        // TODO: Add the action directly without configuration
        // This needs to be handled differently since handleAddAction is defined later
        logger.info('🟣 [handleActionSelect] Would add action directly, but implementation needed')
      } else {
        logger.warn('🟣 [handleActionSelect] No sourceNodeInfo available for direct add')
      }

      dialogsHook.setShowActionDialog(false)
    }
  }, [nodes, configHook, dialogsHook, toast])

  // Handle adding a trigger node
  const handleAddTrigger = useCallback((integration: any, nodeComponent: any, config: Record<string, any>) => {
    // Check if we're replacing a deleted trigger before clearing the backup
    const replacingTrigger = deletedTriggerBackupRef.current
    const firstActionEdge = replacingTrigger?.edges.find(e =>
      e.source === replacingTrigger.node.id &&
      !e.target.startsWith('add-action-')
    )

    // Clear the backup since we're successfully adding a new trigger
    deletedTriggerBackupRef.current = null

    // Use UUID for database compatibility (workflow_nodes.id is uuid type)
    const newNodeId = crypto.randomUUID()
    const newNode: Node = {
      id: newNodeId,
      type: 'custom',
      position: { x: 250, y: 100 },
      data: {
        title: nodeComponent.title,
        description: nodeComponent.description,
        type: nodeComponent.type,
        isTrigger: true,
        config,
        providerId: nodeComponent.providerId || integration.id,
        onConfigure: handleNodeConfigure,
        onDelete: handleNodeDelete,
        onEditingStateChange: handleNodeEditingStateChange,
        onRename: handleNodeRename,
        onTestNode: handleTestNode,
        onTestFlowFromHere: handleTestFlowFromHere,
        onFreeze: handleFreezeNode,
        onStop: handleStopNode,
        onRun: handleRunNode
      }
    }

    // Add the trigger node - no longer adding AddActionNodes
    setNodes(nds => [...nds, newNode])

    // Add edges only if replacing a trigger with existing connections
    if (firstActionEdge) {
      setEdges(eds => {
        const reconnectedEdge: Edge = {
          id: `e-${newNodeId}-${firstActionEdge.target}`,
          source: newNodeId,
          target: firstActionEdge.target,
          type: firstActionEdge.type,
          animated: firstActionEdge.animated,
          style: firstActionEdge.style
        }
        return [...eds, reconnectedEdge]
      })
    }

    // Auto-fit view after adding trigger to keep everything visible
    setTimeout(() => {
      if (fitView) {
        fitView({
          padding: 0.2,
          includeHiddenNodes: false,
          minZoom: 0.5,
          maxZoom: 2,
          duration: 400,
          offset: { x: 0, y: 40 }
        })
      }
    }, 150)

    setHasUnsavedChanges(true)
  }, [setNodes, setEdges, handleNodeConfigure, handleNodeDelete, handleAddActionClick, fitView])

  // Handle adding an action node
  const handleAddAction = useCallback((integration: any, nodeComponent: any, config: Record<string, any>, sourceNodeInfo: any) => {
    // logger.info('🟢 [handleAddAction] START - called with:', {
    //   integration: integration?.name,
    //   nodeComponent: nodeComponent?.type,
    //   sourceNodeInfo,
    //   insertBefore: sourceNodeInfo?.insertBefore
    // })

    // Check if sourceNodeInfo is valid
    if (!sourceNodeInfo) {
      logger.warn('handleAddAction called without sourceNodeInfo - this should only be used for adding new actions')
      return undefined
    }

    // Check if sourceNodeInfo is an empty object (which shouldn't happen)
    if (Object.keys(sourceNodeInfo).length === 0) {
      logger.error('handleAddAction called with empty sourceNodeInfo object - this indicates sourceAddNode was null when action was selected')
      return undefined
    }

    // For insertions, parentId is the source node, insertBefore is the target
    // For regular additions, parentId is the parent node, id is the AddAction node to replace
    const parentId = sourceNodeInfo?.parentId
    if (!parentId) {
      logger.error('No parentId found in sourceNodeInfo:', sourceNodeInfo)
      return undefined
    }

    const parentNode = nodes.find(n => n.id === parentId)
    if (!parentNode) {
      logger.error('Parent node not found:', parentId)
      return undefined
    }

    // logger.info('Found parent node:', parentNode.id, 'insertBefore:', sourceNodeInfo.insertBefore)

    // Check if the parent node is part of an AI agent chain
    let parentAIAgentId = parentNode?.data?.parentAIAgentId
    let parentChainIndex = parentNode?.data?.parentChainIndex

    // For regular additions (not insertions), also check the AddAction node being replaced
    if (!sourceNodeInfo.insertBefore && sourceNodeInfo.id) {
      const sourceAddActionNode = nodes.find(n => n.id === sourceNodeInfo.id)
      if (sourceAddActionNode?.data?.parentAIAgentId) {
        parentAIAgentId = sourceAddActionNode.data.parentAIAgentId
        parentChainIndex = sourceAddActionNode.data.parentChainIndex
      }
    }

    // Also check if AI Agent metadata was passed directly in sourceNodeInfo (for Chain Placeholder)
    if (sourceNodeInfo.aiAgentId) {
      parentAIAgentId = sourceNodeInfo.aiAgentId
      parentChainIndex = sourceNodeInfo.parentChainIndex ?? 0
    }

    // logger.info('AI Agent metadata:', { parentAIAgentId, parentChainIndex })

    // Generate proper node ID using UUID for database compatibility
    // (workflow_nodes.id is uuid type)
    const newNodeId = crypto.randomUUID()

    // logger.info('Generated newNodeId:', newNodeId, 'isAIAgentChain:', !!parentAIAgentId)

    // Determine position: if adding from a chain placeholder, use its exact position
    const sourceNode = nodes.find(n => n.id === sourceNodeInfo.id)
    const isChainPlaceholder = sourceNode?.type === 'chainPlaceholder'

    let nodePosition: { x: number; y: number }
    if (isChainPlaceholder && sourceNode) {
      // Use the exact position of the chain placeholder
      nodePosition = {
        x: sourceNode.position.x,
        y: sourceNode.position.y
      }
      logger.info('🔵 Using chain placeholder position:', nodePosition)
    } else {
      // Default positioning below parent
      nodePosition = {
        x: parentNode.position.x,
        y: parentNode.position.y + 220
      }
    }

    const newNode: Node = {
      id: newNodeId,
      type: 'custom',
      position: nodePosition,
      data: {
        title: nodeComponent.title,
        description: nodeComponent.description,
        type: nodeComponent.type,
        config,
        providerId: nodeComponent.providerId || integration.id,
        // Store the nodeComponent and integration for proper reconstruction after save
        nodeComponent: nodeComponent,
        integration: integration,
        onConfigure: handleNodeConfigure,
        onDelete: handleNodeDelete,
        onEditingStateChange: handleNodeEditingStateChange,
        onRename: handleNodeRename,
        onAddChain: nodeComponent.type === 'ai_agent' ? handleNodeAddChain : undefined,
        onTestNode: handleTestNode,
        onTestFlowFromHere: handleTestFlowFromHere,
        onFreeze: handleFreezeNode,
        onStop: handleStopNode,
        // Preserve AI agent chain metadata if this is part of a chain
        ...(parentAIAgentId && {
          isAIAgentChild: true,
          parentAIAgentId,
          parentChainIndex
        })
      }
    }
    
    // Remove old AddActionNode and add new nodes
    setNodes(nds => {
      // Check if we're inserting between nodes
      if (sourceNodeInfo.insertBefore) {
        // logger.info('Inserting between nodes. Target:', sourceNodeInfo.insertBefore)

        const targetNode = nds.find(n => n.id === sourceNodeInfo.insertBefore)
        if (targetNode) {
          // Calculate spacing for inserted node
          const nodeSpacing = parentAIAgentId ? 120 : 160 // Tighter spacing for AI agent chains
          const halfSpacing = nodeSpacing / 2

          // Position the new node between parent and target with proper spacing
          const xPosition = targetNode.position.x || parentNode.position.x
          const yPosition = parentNode.position.y + nodeSpacing // Place it one full spacing below parent

          newNode.position = {
            x: xPosition,
            y: yPosition
          }

          // Move the target node and all nodes below it down to make room
          const updatedNodes = nds.map(node => {
            if (node.id === sourceNodeInfo.insertBefore ||
                (node.position.y >= targetNode.position.y &&
                 Math.abs(node.position.x - xPosition) < 50)) { // Only move nodes in the same vertical chain
              return {
                ...node,
                position: {
                  ...node.position,
                  y: node.position.y + nodeSpacing // Move down by one spacing unit
                }
              }
            }
            return node
          })

          logger.info('Positioned new node at:', newNode.position)
          logger.info('Moved target and downstream nodes down by:', nodeSpacing)

          const result = [...updatedNodes, { ...newNode, draggable: true }]
          logger.info('Total nodes after insertion:', result.length)
          return result
        } else {
          logger.error('Target node not found for insertion:', sourceNodeInfo.insertBefore)
          return [...nds, { ...newNode, draggable: true }]
        }
      } else {
        // Regular add action - remove the old AddActionNode and add new one
        const filteredNodes = nds.filter(n => n.id !== sourceNodeInfo.id)
        const newNodeWithDrag = { ...newNode, draggable: true }
        const updatedNodes = [...filteredNodes, newNodeWithDrag]

        // Check if this is an AI Agent node
        const isAIAgent = nodeComponent.type === 'ai_agent'

        if (isAIAgent) {
          // For AI Agent nodes, create a chain placeholder
          const placeholderId = `chain-placeholder-${newNodeId}`
          logger.info('🟣 Creating chain placeholder for AI Agent:', newNodeId, 'with ID:', placeholderId)

          // Store the handler to open action selection modal
          const clickHandler = () => {
            logger.info('Chain placeholder clicked for AI Agent:', newNodeId)
            // Open the action selection dialog with AI Agent as source
            handleAddActionClick(placeholderId, newNodeId)
          }
          addActionHandlersRef.current[placeholderId] = clickHandler

          const placeholderNode: Node = {
            id: placeholderId,
            type: 'chainPlaceholder',
            position: {
              x: newNode.position.x, // Same width (480px) as AI Agent - no offset needed
              y: newNode.position.y + 160
            },
            draggable: false,
            selectable: false,
            data: {
              type: 'chainPlaceholder',
              parentId: newNodeId,
              parentAIAgentId: newNodeId,
              parentChainIndex: 0,
              onClick: clickHandler
            }
          }
          // logger.info('🟣 Chain placeholder node created:', placeholderNode)
          return [...updatedNodes, placeholderNode]
        }

        // For regular nodes, no longer adding AddActionNodes - users connect nodes manually
        return updatedNodes
      }
    })
    
    // Track change after adding action
    setTimeout(() => {
      const currentNodes = getNodes()
      const currentEdges = getEdges()
      trackChangeRef.current?.(currentNodes, currentEdges)
    }, 100)

    // Update edges
    setEdges(eds => {
      // Check if we're inserting between nodes
      if (sourceNodeInfo.insertBefore) {
        // logger.info('Updating edges for insertion. Removing edge:', parentId, '->', sourceNodeInfo.insertBefore)
        // Remove the edge between parentId and insertBefore
        const filteredEdges = eds.filter(e =>
          !(e.source === parentId && e.target === sourceNodeInfo.insertBefore)
        )

        // logger.info('Edges before:', eds.length, 'Edges after filter:', filteredEdges.length)

        // Add edges: parent -> newNode -> insertBefore
        const newEdges = [...filteredEdges,
          {
            id: `e-${parentId}-${newNodeId}`,
            source: parentId,
            target: newNodeId,
            type: 'custom',
            animated: false,
            style: { stroke: "#9ca3af", strokeWidth: 1 },
            data: {} // Ensure data object exists
          },
          {
            id: `e-${newNodeId}-${sourceNodeInfo.insertBefore}`,
            source: newNodeId,
            target: sourceNodeInfo.insertBefore,
            type: 'custom',
            animated: false,
            style: { stroke: "#9ca3af", strokeWidth: 1 },
            data: {} // Ensure data object exists
          }
          // Don't add edge to AddAction when inserting between nodes
        ]

        // logger.info('Added new edges:', `${parentId} -> ${newNodeId}`, `${newNodeId} -> ${sourceNodeInfo.insertBefore}`)
        // logger.info('Total edges after insertion:', newEdges.length)
        return newEdges
      } else {
        // Regular add action (at the end of chain)
        const filteredEdges = eds.filter(e => e.target !== sourceNodeInfo.id)

        // Add edge from parent to new node
        const newEdge = {
          id: `e-${parentId}-${newNodeId}`,
          source: parentId,
          target: newNodeId,
          type: 'custom',
          animated: false,
          style: { stroke: "#9ca3af", strokeWidth: 1 }
        }

        // For AI Agent nodes, also add edge to chain placeholder
        if (nodeComponent.type === 'ai_agent') {
          const placeholderEdge = {
            id: `e-${newNodeId}-chain-placeholder-${newNodeId}`,
            source: newNodeId,
            target: `chain-placeholder-${newNodeId}`,
            type: 'custom',
            animated: false,
            style: { stroke: "#9ca3af", strokeWidth: 2, strokeLinecap: "round", strokeDasharray: "5 5" }
          }
          return [...filteredEdges, newEdge, placeholderEdge]
        }

        // For regular nodes, no longer adding edges to AddActionNodes
        return [...filteredEdges, newEdge]
      }
    })

    // Auto-fit view after adding action to keep everything visible
    setTimeout(() => {
      if (fitView) {
        fitView({
          padding: 0.2,
          includeHiddenNodes: false,
          minZoom: 0.5,
          maxZoom: 2,
          duration: 400,
          offset: { x: 0, y: 40 }
        })
      }
    }, 150)

    setHasUnsavedChanges(true)
    return newNodeId
  }, [nodes, setNodes, setEdges, handleNodeConfigure, handleNodeDelete, handleNodeAddChain, handleAddActionClick, fitView])

  // Additional handlers needed
  const optimizedOnNodesChange = useCallback((changes: any) => {
    if (!Array.isArray(changes) || changes.length === 0) {
      return
    }

    const updateChanges = changes.filter((change: any) => change.type === 'update')
    const nonUpdateChanges = changes.filter((change: any) => change.type !== 'update')

    if (updateChanges.length > 0) {
      setNodes(currentNodes => {
        let mutated = false
        let nextNodes = currentNodes

        for (const change of updateChanges) {
          const applyUpdate = change.item
          nextNodes = nextNodes.map(node => {
            if (node.id !== change.id) return node

            let updatedNode = typeof applyUpdate === 'function'
              ? applyUpdate(node)
              : (applyUpdate || node)

            if (updatedNode === node) {
              updatedNode = { ...node }
            }

            if (updatedNode !== node) {
              mutated = true
            }

            return updatedNode
          })
        }

        return mutated ? nextNodes : currentNodes
      })

      // Record change for undo/redo history after ReactFlow updates
      setTimeout(() => {
        const updatedNodes = getNodes()
        const updatedEdges = getEdges()
        trackChangeRef.current?.(updatedNodes, updatedEdges)
      }, 0)
    }

    // Handle parent-child movement for add action nodes using remaining changes
    const positionChanges = nonUpdateChanges.filter((change: any) => change.type === 'position')

    if (positionChanges.length > 0) {
      const additionalChanges: any[] = []
      const currentNodes = getNodes()

      const hasFinishedDragging = positionChanges.some((change: any) => change.dragging === false)

      positionChanges.forEach((change: any) => {
        if (change.dragging !== false && !change.id.startsWith('add-action-')) {
          const addActionId = `add-action-${change.id}`
          const addActionNode = currentNodes.find(n => n.id === addActionId)
          const parentNode = currentNodes.find(n => n.id === change.id)

          if (addActionNode && change.position) {
            const isChainNode = Boolean(addActionNode.data?.parentAIAgentId)
            const spacing = isChainNode ? 120 : 160

            const centeredX = getCenteredAddActionX({
              position: change.position,
              data: parentNode?.data ?? addActionNode.data
            })

            additionalChanges.push({
              id: addActionId,
              type: 'position',
              position: {
                x: centeredX,
                y: change.position.y + spacing
              }
            })
          }
        }
      })

      onNodesChange([...nonUpdateChanges, ...additionalChanges])

      if (hasFinishedDragging) {
        setTimeout(() => {
          const updatedNodes = getNodes()
          const updatedEdges = getEdges()
          trackChangeRef.current?.(updatedNodes, updatedEdges)
        }, 100)
      }
    } else if (nonUpdateChanges.length > 0) {
      onNodesChange(nonUpdateChanges)
    }
  }, [setNodes, onNodesChange, getNodes, getEdges])

  const handleConfigureNode = useCallback((nodeId: string) => {
    const node = nodes.find(n => n.id === nodeId)
    if (node && configHook.setConfiguringNode) {
      // Try to find nodeComponent if not already set
      let nodeComponent = node.data?.nodeComponent
      if (!nodeComponent && node.data?.type) {
        // Import ALL_NODE_COMPONENTS if needed
        const { ALL_NODE_COMPONENTS } = require('@/lib/workflows/nodes')
        nodeComponent = ALL_NODE_COMPONENTS.find(nc => nc.type === node.data.type)
      }

      configHook.setConfiguringNode({
        id: nodeId,
        nodeComponent: nodeComponent,
        integration: node.data?.integration,
        config: node.data?.config || {}
      })
    }
  }, [nodes, configHook])

  const handleDeleteNodeWithConfirmation = useCallback((nodeId: string) => {
    const node = nodes.find(n => n.id === nodeId)
    if (node) {
      dialogsHook.setDeletingNode({
        id: nodeId,
        name: node.data?.title || 'Node'
      })
    }
  }, [nodes, dialogsHook])

  const handleAddNodeBetween = useCallback((sourceId: string, targetId: string, position?: { x: number; y: number }) => {
    // Open the action dialog to add a node between two existing nodes
    const insertNodeInfo = {
      id: `insert-${Date.now()}`,
      parentId: sourceId,
      insertBefore: targetId
    }

    // logger.info('🔶 [handleAddNodeBetween] Setting sourceAddNode for insertion:', insertNodeInfo)

    dialogsHook.setSourceAddNode(insertNodeInfo)
    dialogsHook.setSelectedIntegration(null)
    dialogsHook.setSelectedAction(null)
    dialogsHook.setSearchQuery("")
    dialogsHook.setShowActionDialog(true)
  }, [dialogsHook])

  const openTriggerDialog = useCallback(() => {
    dialogsHook.setShowTriggerDialog(true)
  }, [dialogsHook])

  const nodeNeedsConfiguration = useCallback((nodeId: string) => {
    const node = nodes.find(n => n.id === nodeId)
    if (!node || !node.data?.nodeComponent) return false
    const config = node.data?.config || {}
    const fields = node.data?.nodeComponent?.fields || []
    return fields.some((field: any) => field.required && !config[field.name])
  }, [nodes])

  // Edge click handler for selection
  const handleEdgeClick = useCallback((event: React.MouseEvent, edge: Edge) => {
    event.stopPropagation()
    setSelectedEdgeId(edge.id)
    setHasUnsavedChanges(true)
  }, [])

  // Delete selected edge
  const deleteSelectedEdge = useCallback(() => {
    if (selectedEdgeId) {
      setEdges((eds) => eds.filter((e) => e.id !== selectedEdgeId))
      setSelectedEdgeId(null)
      setHasUnsavedChanges(true)
      toast({
        title: "Connection deleted",
        description: "The connection between nodes has been removed.",
      })
    }
  }, [selectedEdgeId, setEdges, toast])

  // Keyboard handler for edge deletion
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      // Check if Delete or Backspace is pressed
      if ((event.key === 'Delete' || event.key === 'Backspace') && selectedEdgeId) {
        // Prevent default behavior if we're not in an input field
        const target = event.target as HTMLElement
        if (target.tagName !== 'INPUT' && target.tagName !== 'TEXTAREA') {
          event.preventDefault()
          deleteSelectedEdge()
        }
      }
      // Deselect edge on Escape
      if (event.key === 'Escape' && selectedEdgeId) {
        setSelectedEdgeId(null)
      }
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [selectedEdgeId, deleteSelectedEdge])

  // Click outside to deselect edge
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      // Check if click is outside of edges
      const target = event.target as HTMLElement
      if (!target.closest('.react-flow__edge')) {
        setSelectedEdgeId(null)
      }
    }

    if (selectedEdgeId) {
      document.addEventListener('click', handleClickOutside)
      return () => document.removeEventListener('click', handleClickOutside)
    }
  }, [selectedEdgeId])

  const confirmDeleteNode = useCallback((nodeId: string) => {
    const nodeToDelete = nodesRef.current.find((n) => n.id === nodeId)
    if (!nodeToDelete) {
      dialogsHook.setDeletingNode(null)
      return
    }

    const currentEdges = getEdges()
    const currentNodes = getNodes()

    // Check if this is a trigger node
    const nodeComponent = ALL_NODE_COMPONENTS.find(c => c.type === nodeToDelete.data?.type)
    const isTriggerNode = nodeComponent?.isTrigger === true

    // Note: Trigger selection dialog removed - triggers now deleted like any other node
    // Users can add new triggers via the IntegrationsSidePanel if needed

    // Check if this is an AI Agent node
    const isAIAgent = nodeToDelete.data?.type === 'ai_agent'

    // Build list of all nodes to delete
    let nodesToDelete = new Set([nodeId])
    let placeholdersToDelete = new Set([`add-action-${nodeId}`])

    if (isAIAgent) {
      // logger.info('🗑️ Deleting AI Agent and all its chains')

      // Find all nodes that are children of this AI Agent
      currentNodes.forEach(n => {
        // Check various ways a node could be a child of this AI Agent
        if (n.data?.parentAIAgentId === nodeId ||
            n.data?.parentId === nodeId ||
            (typeof n.id === 'string' && n.id.startsWith(`${nodeId}-`))) {
          nodesToDelete.add(n.id)
          placeholdersToDelete.add(`add-action-${n.id}`)
        }

        // Also check for chain placeholders
        if (n.type === 'chainPlaceholder' &&
            (n.data?.parentAIAgentId === nodeId || n.data?.parentId === nodeId)) {
          nodesToDelete.add(n.id)
        }

        // Also check for add action nodes that belong to this AI Agent
        if (n.type === 'addAction' && n.data?.parentAIAgentId === nodeId) {
          nodesToDelete.add(n.id)
        }
      })

      logger.info(`🗑️ Deleting AI Agent with ${nodesToDelete.size - 1} related nodes`)
    }

    // Convert sets to arrays for easier use
    const nodeIdsToDelete = Array.from(nodesToDelete)
    const placeholderIdsToDelete = Array.from(placeholdersToDelete)

    // Clear all handlers for deleted placeholders
    placeholderIdsToDelete.forEach(id => {
      delete addActionHandlersRef.current[id]
    })

    // Find edges for the main deleted node (not for AI Agent children)
    const incomingEdges = isAIAgent ? [] : currentEdges.filter((edge) => edge.target === nodeId)
    const outgoingEdges = isAIAgent ? [] : currentEdges.filter((edge) => edge.source === nodeId)

    // Get parent IDs (nodes that connect TO the deleted node)
    const parentIds = Array.from(new Set(incomingEdges.map((edge) => edge.source)))

    // Get the node spacing for positioning
    const parentAIAgentId = nodeToDelete.data?.parentAIAgentId
    const nodeSpacing = parentAIAgentId ? 120 : 160

    // Track nodes that need to move up after deletion
    const deletedNodeY = nodeToDelete.position.y
    const deletedNodeX = nodeToDelete.position.x

    setNodes((prevNodes) => {
      // Filter out all nodes and placeholders that need to be deleted
      let nextNodes = prevNodes.filter((node) =>
        !nodeIdsToDelete.includes(node.id) &&
        !placeholderIdsToDelete.includes(node.id)
      )

      // Move nodes that were below the deleted node up (only if not deleting an AI Agent)
      if (!isAIAgent) {
        nextNodes = nextNodes.map(node => {
          // Check if this node is in the same vertical chain and below the deleted node
          if (node.position.y > deletedNodeY && Math.abs(node.position.x - deletedNodeX) < 50) {
            return {
              ...node,
              position: {
                ...node.position,
                y: node.position.y - nodeSpacing
              }
            }
          }
          return node
        })
      }

      // After deleting a node, remove ALL Add Action nodes first
      // We'll add back the correct one after edges are updated
      nextNodes = nextNodes.filter(n => n.type !== 'addAction')

      return nextNodes
    })

    setEdges((prevEdges) => {
      let nextEdges = prevEdges.filter((edge) => {
        // Remove edges connected to any deleted node
        if (nodeIdsToDelete.includes(edge.source) || nodeIdsToDelete.includes(edge.target)) return false
        if (placeholderIdsToDelete.includes(edge.source) || placeholderIdsToDelete.includes(edge.target)) return false
        return true
      })

      // Reconnect nodes that were connected through the deleted node (skip for AI Agent deletion)
      if (!isAIAgent && incomingEdges.length > 0 && outgoingEdges.length > 0) {
        incomingEdges.forEach((incomingEdge) => {
          outgoingEdges.forEach((outgoingEdge) => {
            const targetNode = currentNodes.find(n => n.id === outgoingEdge.target)

            // Only reconnect if the target is NOT an Add Action button
            if (targetNode && targetNode.type !== 'addAction') {
              // Check if this edge already exists
              const edgeExists = nextEdges.some(e =>
                e.source === incomingEdge.source &&
                e.target === outgoingEdge.target
              )

              if (!edgeExists) {
                nextEdges = [
                  ...nextEdges,
                  {
                    id: `e-${incomingEdge.source}-${outgoingEdge.target}`,
                    source: incomingEdge.source,
                    target: outgoingEdge.target,
                    type: 'custom',
                    animated: false,
                    style: { stroke: '#d1d5db', strokeWidth: 1 },
                    data: {
                      onAddNode: () => {
                        // logger.info('🔵 Edge button clicked - inserting between:', incomingEdge.source, 'and', outgoingEdge.target)
                        handleAddNodeBetween(incomingEdge.source, outgoingEdge.target)
                      }
                    }
                  } as Edge,
                ]
              }
            }
          })
        })
      }

      // Don't try to add edges to Add Action nodes here

      return nextEdges
    })

    removeNode(nodeId)
    setHasUnsavedChanges(true)

    // Track change after deletion
    setTimeout(() => {
      const currentNodes = getNodes()
      const currentEdges = getEdges()
      trackChangeRef.current?.(currentNodes, currentEdges)
    }, 100)

    // If we deleted a chain node, check if the AI Agent needs a Chain Placeholder restored
    if (!isAIAgent && parentAIAgentId) {
      setTimeout(() => {
        const currentNodes = getNodes()
        const aiAgentNode = currentNodes.find(n => n.id === parentAIAgentId)

        if (aiAgentNode) {
          // Find all remaining chain nodes for this AI Agent (excluding placeholders and Add Action buttons)
          const remainingChainNodes = currentNodes.filter(n =>
            n.data?.parentAIAgentId === parentAIAgentId &&
            n.type !== 'chainPlaceholder' &&
            n.type !== 'addAction'
          )

          logger.info(`🔍 AI Agent ${parentAIAgentId} has ${remainingChainNodes.length} remaining chain nodes after deletion`)

          // If no chain nodes remain, restore the Chain Placeholder
          if (remainingChainNodes.length === 0) {
            logger.info('🔄 Restoring Chain Placeholder for AI Agent with no chains')

            const chainPlaceholderId = `chain-placeholder-${parentAIAgentId}-0-${Date.now()}`
            const chainPlaceholderNode: Node = {
              id: chainPlaceholderId,
              type: 'chainPlaceholder',
              position: {
                x: aiAgentNode.position.x,
                y: aiAgentNode.position.y + 160
              },
              data: {
                type: 'chainPlaceholder',
                parentId: parentAIAgentId,
                parentAIAgentId: parentAIAgentId,
                parentChainIndex: 0,
                onClick: () => {
                  logger.info('🔵 Chain placeholder onClick triggered')
                  handleAddActionClick(chainPlaceholderId, parentAIAgentId)
                }
              }
            }

            setNodes(nds => [...nds, chainPlaceholderNode])

            // Create edge from AI Agent to Chain Placeholder
            const edgeId = `e-${parentAIAgentId}-${chainPlaceholderId}`
            setEdges(edges => [
              ...edges,
              {
                id: edgeId,
                source: parentAIAgentId,
                target: chainPlaceholderId,
                type: 'custom',
                animated: false,
                style: { stroke: '#d1d5db', strokeWidth: 1 }
              }
            ])
          }
        }
      }, 100)
    }

    if (configHook.configuringNode?.id === nodeId) {
      configHook.setConfiguringNode(null)
    }
    if (configHook.pendingNode?.sourceNodeInfo?.id === nodeId || configHook.pendingNode?.sourceNodeInfo?.parentId === nodeId) {
      configHook.setPendingNode(null)
    }
    if (dialogsHook.sourceAddNode?.id === nodeId || dialogsHook.sourceAddNode?.parentId === nodeId) {
      dialogsHook.setSourceAddNode(null)
    }

    dialogsHook.setDeletingNode(null)

    // Toast notification removed per user request
  }, [setNodes, setEdges, getEdges, getNodes, handleAddActionClick, handleAddNodeBetween, removeNode, setHasUnsavedChanges, configHook, dialogsHook, toast])

  const forceUpdate = useCallback(() => {
    // Force a re-render
    setNodes(nodes => [...nodes])
  }, [setNodes])

  const [displayedTriggers, setDisplayedTriggers] = useState<any[]>([])
  const [filteredIntegrations, setFilteredIntegrations] = useState<any[]>([])

  const handleConfigurationClose = useCallback(() => {
    // Check if we're cancelling a pending trigger configuration after deleting an old trigger
    const wasPendingTrigger = configHook.pendingNode?.type === 'trigger' && deletedTriggerBackupRef.current

    configHook.setConfiguringNode(null)

    // If user was configuring a new trigger to replace a deleted one, and they cancelled, restore the old trigger
    if (wasPendingTrigger && deletedTriggerBackupRef.current) {
      const backup = deletedTriggerBackupRef.current
      deletedTriggerBackupRef.current = null

      // Small delay to let config modal close
      setTimeout(() => {
        const hasNewTrigger = getNodes().some(n => {
          const comp = ALL_NODE_COMPONENTS.find(c => c.type === n.data?.type)
          return comp?.isTrigger === true
        })

        if (!hasNewTrigger && backup) {
          setNodes((prevNodes) => [...prevNodes, backup.node])
          // Deduplicate edges when restoring backup to prevent duplicate key errors
          setEdges((prevEdges) => {
            const existingIds = new Set(prevEdges.map(e => e.id))
            const newEdges = backup.edges.filter((e: Edge) => !existingIds.has(e.id))
            return [...prevEdges, ...newEdges]
          })
        }
      }, 50)
    }
  }, [configHook, getNodes, setNodes, setEdges])

  const handleConfigurationSave = useCallback(async (config: any) => {
    if (configHook.configuringNode) {
      await configHook.handleSaveConfiguration(
        { id: configHook.configuringNode.id },
        config,
        handleAddTrigger,
        handleAddAction,
        handleSave
      )
    }
  }, [configHook, handleAddTrigger, handleAddAction, handleSave])

  const configuringNodeInfo = configHook.configuringNode?.nodeComponent
  const configuringIntegrationName = configHook.configuringNode?.integration?.name || ''
  const configuringInitialData = configHook.configuringNode?.config || {}

  // Wrap execution handlers to provide nodes and edges
  const handleTestSandbox = useCallback(() => {
    const currentNodes = getNodes()
    const currentEdges = getEdges()
    return executionHook.handleTestSandbox(currentNodes, currentEdges)
  }, [getNodes, getEdges, executionHook])

  const handleExecuteLive = useCallback(async () => {
    const currentNodes = getNodes()
    const currentEdges = getEdges()
    setIsRunningPreflight(true)
    const preflight = runPreflightCheck({ openOnSuccess: false, openOnFailure: true })
    setIsRunningPreflight(false)
    if (!preflight.ok) {
      toast({
        title: "Preflight check failed",
        description: "Resolve the issues in the checklist before running the workflow.",
        variant: "destructive",
      })
      return
    }

    // Callback to update nodes with result messages after execution
    const onNodesUpdate = (nodeUpdates: Array<{ nodeId: string; resultMessage: string }>) => {
      setNodes((nodes) =>
        nodes.map((node) => {
          const update = nodeUpdates.find(u => u.nodeId === node.id)
          if (update) {
            return {
              ...node,
              data: {
                ...node.data,
                resultMessage: update.resultMessage,
              }
            }
          }
          return node
        })
      )
    }

    return executionHook.handleExecuteLive(currentNodes, currentEdges, onNodesUpdate)
  }, [getNodes, getEdges, setNodes, executionHook, runPreflightCheck, toast])

  const handleExecuteLiveSequential = useCallback(async () => {
    const currentNodes = getNodes()
    const currentEdges = getEdges()
    setIsRunningPreflight(true)
    const preflight = runPreflightCheck({ openOnSuccess: false, openOnFailure: true })
    setIsRunningPreflight(false)
    if (!preflight.ok) {
      toast({
        title: "Preflight check failed",
        description: "Resolve the checklist issues before running sequential mode.",
        variant: "destructive",
      })
      return
    }

    // Callback to update nodes with result messages after execution
    const onNodesUpdate = (nodeUpdates: Array<{ nodeId: string; resultMessage: string }>) => {
      setNodes((nodes) =>
        nodes.map((node) => {
          const update = nodeUpdates.find(u => u.nodeId === node.id)
          if (update) {
            return {
              ...node,
              data: {
                ...node.data,
                resultMessage: update.resultMessage,
              }
            }
          }
          return node
        })
      )
    }

    return executionHook.handleExecuteLiveSequential(currentNodes, currentEdges, onNodesUpdate)
  }, [getNodes, getEdges, setNodes, executionHook, runPreflightCheck, toast])

  const templateSettingsLabel = useMemo(() => {
    if (!isTemplateEditing) return 'Template Settings'
    const target = templateDraftMetadata?.primarySetupTarget
    if (!target) return 'Template Settings'
    const formatted = target
      .split(/[_-]/)
      .map(segment => segment.charAt(0).toUpperCase() + segment.slice(1))
      .join(' ')
    return `${formatted} Setup`
  }, [isTemplateEditing, templateDraftMetadata?.primarySetupTarget])

  // Debug log: check what we're about to return
  const returnValue = {
    // React Flow state
    nodes,
    edges: processedEdges,
    setNodes,
    setEdges,
    onNodesChange,
    optimizedOnNodesChange,
    onEdgesChange,
    onConnect,
    nodeTypes,
    edgeTypes,
    fitView,
    getNodes,
    getEdges,
    
    // Workflow metadata
    workflowName,
    setWorkflowName,
    workflowDescription,
    setWorkflowDescription,
    currentWorkflow,
    workflowId,
    editTemplateId,
    isTemplateEditing,
    workflows,
    templateDraftMetadata,
    templatePublishedMetadata,
    
    // Loading/saving states
    isSaving,
    isSavingTemplateDraft,
    isLoading,
    workflowLoading,
    integrationsLoading,
    hasUnsavedChanges,
    setHasUnsavedChanges,
    listeningMode,
    setListeningMode,
    isProcessingChainsRef,
    
    // Handlers
    handleSave,
    handleToggleLive,
    showActivationReview,
    setShowActivationReview,
    confirmActivation,
    isUpdatingStatus,
    handleTriggerSelect,
    handleTriggerDialogClose,
    handleActionSelect,
    handleAddActionClick,
    handleAddTrigger,
    handleAddAction,
    updateTemplateDraftMetadata,
    saveTemplateDraft,

    // Collaboration
    collaborators,

    // From custom hooks (spread but override certain handlers)
    ...executionHook,
    handleTestSandbox,  // Override with wrapped version
    handleExecuteLive,  // Override with wrapped version
    handleExecuteLiveSequential,  // Override with wrapped version
    ...dialogsHook,
    handleSaveAndNavigate: dialogsHook.handleSaveAndNavigate,
    handleNavigateWithoutSaving: dialogsHook.handleNavigateWithoutSaving,
    ...integrationHook,
    ...configHook,

    // Additional handlers and states
    runPreflightCheck,
    preflightResult,
    isPreflightDialogOpen,
    setIsPreflightDialogOpen,
    isRunningPreflight,
    openPreflightChecklist,
    handleConfigureNode,
    handleDeleteNodeWithConfirmation,
    handleAddNodeBetween,
    handleNodeConfigure,
    handleNodeDelete,
    handleNodeEditingStateChange,
    handleNodeRename,
    handleNodeAddChain,
    handleTestNode,
    handleTestFlowFromHere,
    handleFreezeNode,
    handleStopNode,
    openTriggerDialog,
    nodeNeedsConfiguration,
    confirmDeleteNode,
    forceUpdate,
    displayedTriggers,
    filteredIntegrations,
    handleConfigurationClose,
    handleConfigurationSave,
    configuringNodeInfo,
    configuringIntegrationName,
    configuringInitialData,
    cachedIntegrationStatus,
    templateAssets,
    uploadTemplateAsset,
    deleteTemplateAsset,
    templateSettingsLabel,
    pushHistorySnapshot: trackChange,
    // Undo/redo functionality
    handleUndo,
    handleRedo,
    canUndo: historyHook.canUndo,
    canRedo: historyHook.canRedo,

    // Edge selection and deletion
    selectedEdgeId,
    handleEdgeClick,
    deleteSelectedEdge,
  }

  return returnValue
}
