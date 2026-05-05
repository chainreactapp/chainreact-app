"use client"

import { create } from "zustand"
import { supabase } from "@/utils/supabaseClient"
import { trackBetaTesterActivity } from "@/lib/utils/beta-tester-tracking"
import { ALL_NODE_COMPONENTS } from "@/lib/workflows/nodes"
import { logger } from "@/lib/utils/logger"
import { WorkflowService } from "@/services/workflow-service"
import { SessionManager } from "@/lib/auth/session"
import { getCrossTabSync } from "@/lib/utils/cross-tab-sync"

export interface WorkflowNode {
  id: string
  type: string
  position: { x: number; y: number }
  data: {
    label: string
    type: string
    config: Record<string, any>
    savedDynamicOptions?: Record<string, any[]>
    providerId?: string
    isTrigger?: boolean
    title?: string
    description?: string
    isAIAgentChild?: boolean
    parentAIAgentId?: string
    parentChainIndex?: number
    emptiedChains?: number[]
    validationState?: {
      missingRequired: string[]
      lastValidatedAt?: string
      lastUpdatedAt?: string
      isValid?: boolean
      message?: string
    }
    // Multi-account support - specific integration to use for this node
    integration_id?: string
  }
}

export interface WorkflowConnection {
  id: string
  source: string
  target: string
  sourceHandle?: string
  targetHandle?: string
}

export interface Workflow {
  id: string
  name: string
  description: string | null
  user_id: string
  organization_id?: string | null
  folder_id?: string | null
  nodes: WorkflowNode[]
  connections: WorkflowConnection[]
  status: 'draft' | 'active' | 'inactive'
  created_at: string
  updated_at: string
  visibility?: string
  executions_count?: number
  created_by?: string
  last_modified_by?: string | null
  source_template_id?: string | null
  deleted_at?: string | null
  original_folder_id?: string | null
  was_in_root?: boolean
  workspace_type?: 'personal' | 'team' | 'organization'
  workspace_id?: string | null
  user_permission?: 'use' | 'manage' | 'admin'
  validationState?: {
    invalidNodeIds: string[]
    lastValidatedAt?: string
    lastUpdatedAt?: string
    integrationPaused?: string
  }
  tags?: string[]
}

type FetchStatus = 'idle' | 'loading' | 'success' | 'error'

interface WorkflowState {
  workflows: Workflow[]
  currentWorkflow: Workflow | null
  selectedNode: WorkflowNode | null
  loadingList: boolean
  loadingCreate: boolean
  loadingSave: boolean
  updatingWorkflowIds: string[]
  deletingWorkflowIds: string[]
  error: string | null
  lastFetchTime: number | null
  fetchPromise: Promise<void> | null
  // Workspace context
  workspaceType: 'personal' | 'team' | 'organization'
  workspaceId: string | null
  currentUserId: string | null
  // Workspace cache key to prevent stale promise returns
  lastWorkspaceKey: string | null
  // Fetch state machine
  fetchStatus: FetchStatus
  loadedOnce: boolean
  dataOwnerKey: string | null
}

// Canonical identity key for the data currently in the store
function buildDataOwnerKey(userId: string, workspaceType?: string, workspaceId?: string | null): string {
  return `${userId}:${workspaceType || 'personal'}-${workspaceId || 'none'}`
}

type FetchTransition =
  | { type: 'FETCH_START' }
  | { type: 'FETCH_SUCCESS'; workflows: Workflow[]; ownerKey: string }
  | { type: 'TRANSIENT_FAILURE'; error: string }
  | { type: 'IDENTITY_CHANGE'; ownerKey: string }
  | { type: 'LOGOUT' }

function applyFetchTransition(state: WorkflowState, transition: FetchTransition): Partial<WorkflowState> {
  switch (transition.type) {
    case 'FETCH_START':
      return { fetchStatus: 'loading', loadingList: true, error: null }

    case 'FETCH_SUCCESS':
      return {
        fetchStatus: 'success',
        loadedOnce: true,
        loadingList: false,
        lastFetchTime: Date.now(),
        fetchPromise: null,
        dataOwnerKey: transition.ownerKey,
        workflows: transition.workflows,
      }

    case 'TRANSIENT_FAILURE':
      // Preserve existing workflows — same identity, just a blip
      return {
        fetchStatus: 'error',
        loadingList: false,
        error: transition.error,
        fetchPromise: null,
        lastFetchTime: null,
        // workflows: UNCHANGED — keep stale data visible
      }

    case 'IDENTITY_CHANGE':
      // Different user or workspace — clear everything
      return {
        workflows: [],
        fetchStatus: 'idle',
        loadedOnce: false,
        loadingList: false,
        lastFetchTime: null,
        fetchPromise: null,
        dataOwnerKey: transition.ownerKey,
        error: null,
      }

    case 'LOGOUT':
      return {
        workflows: [],
        fetchStatus: 'idle',
        loadedOnce: false,
        loadingList: false,
        lastFetchTime: null,
        fetchPromise: null,
        dataOwnerKey: null,
        currentUserId: null,
        error: null,
      }
  }
}

interface WorkflowActions {
  fetchWorkflows: (force?: boolean, filterContext?: 'personal' | 'team' | 'organization' | null, workspaceId?: string) => Promise<void>
  fetchPersonalWorkflows: () => Promise<void>
  fetchOrganizationWorkflows: (organizationId: string) => Promise<void>
  getGroupedWorkflows: () => GroupedWorkflows
  createWorkflow: (name: string, description?: string, organizationId?: string, folderId?: string) => Promise<Workflow>
  updateWorkflow: (id: string, updates: Partial<Workflow>) => Promise<any>
  deleteWorkflow: (id: string) => Promise<void>
  moveWorkflowToTrash: (id: string) => Promise<void>
  restoreWorkflowFromTrash: (id: string) => Promise<void>
  emptyTrash: () => Promise<void>
  moveWorkflowToOrganization: (workflowId: string, organizationId: string) => Promise<void>
  invalidateCache: () => void
  setCurrentWorkflow: (workflow: Workflow | null) => void
  setSelectedNode: (node: WorkflowNode | null) => void
  setWorkspaceContext: (workspaceType: 'personal' | 'team' | 'organization', workspaceId?: string | null) => Promise<void>
  addNode: (node: WorkflowNode) => void
  updateNode: (nodeId: string, updates: Partial<WorkflowNode>) => void
  removeNode: (nodeId: string) => void
  saveWorkflow: () => Promise<void>
  generateWorkflowWithAI: (prompt: string) => Promise<Workflow>
  createTemplateFromWorkflow: (
    workflowId: string,
    templateData: {
      name: string
      description: string
      category: string
      tags: string[]
      is_public: boolean
    },
  ) => Promise<void>
  isWorkflowComplete: (workflow: Workflow) => boolean
  updateWorkflowStatus: (id: string) => Promise<void>
  pauseWorkflowsForIntegration: (providerId: string) => Promise<void>
  resumeWorkflowsForIntegration: (providerId: string) => Promise<void>
  clearAllData: () => void
  recalculateWorkflowValidation: (workflow: Workflow) => Workflow
  addWorkflowToStore: (workflow: Workflow) => void
  // --- Duplication ---
  duplicateWorkflow: (id: string) => Promise<Workflow>
  // --- Sharing ---
  shareWorkflow: (id: string, teamIds: string[]) => Promise<void>
  unshareWorkflow: (id: string, teamId: string) => Promise<void>
  // --- Permissions ---
  addPermission: (workflowId: string, userId: string, permission: string) => Promise<void>
  removePermission: (workflowId: string, userId: string) => Promise<void>
  updatePermission: (workflowId: string, userId: string, permission: string) => Promise<void>
  // --- Batch Operations ---
  batchMoveToFolder: (workflowIds: string[], folderId: string) => Promise<void>
  batchTrash: (workflowIds: string[]) => Promise<void>
  batchDelete: (workflowIds: string[]) => Promise<void>
  batchRestore: (workflowIds: string[]) => Promise<void>
  // --- Activation ---
  activateWorkflow: (id: string) => Promise<any>
  deactivateWorkflow: (id: string) => Promise<any>
  // --- Folders ---
  folders: any[]
  foldersLoading: boolean
  fetchFolders: () => Promise<void>
  createFolder: (name: string, description?: string) => Promise<any>
  updateFolder: (id: string, updates: { name?: string; description?: string }) => Promise<void>
  deleteFolder: (id: string, options?: { action?: string; targetFolderId?: string | null }) => Promise<void>
  setDefaultFolder: (id: string) => Promise<void>
}

export interface GroupedWorkflows {
  personal: Workflow[]
  teams: Record<string, Workflow[]> // team_id -> workflows
  organizations: Record<string, Workflow[]> // org_id -> workflows
}

export const useWorkflowStore = create<WorkflowState & WorkflowActions>((set, get) => ({
  workflows: [],
  currentWorkflow: null,
  selectedNode: null,
  loadingList: false,
  loadingCreate: false,
  loadingSave: false,
  updatingWorkflowIds: [],
  deletingWorkflowIds: [],
  error: null,
  lastFetchTime: null,
  fetchPromise: null,
  // Workspace context - default to personal
  workspaceType: 'personal',
  workspaceId: null,
  currentUserId: null,
  lastWorkspaceKey: null,
  fetchStatus: 'idle' as FetchStatus,
  loadedOnce: false,
  dataOwnerKey: null,
  // Folders
  folders: [],
  foldersLoading: false,

  fetchWorkflows: async (force = false, filterContext?: 'personal' | 'team' | 'organization' | null, workspaceId?: string) => {
    const state = get()

    // Create workspace cache key to prevent returning stale promises from different workspaces
    const effectiveWorkspaceType = filterContext || state.workspaceType
    const effectiveWorkspaceId = workspaceId || state.workspaceId || undefined
    const workspaceCacheKey = `${effectiveWorkspaceType}-${effectiveWorkspaceId || 'null'}`
    const lastKey = state.lastWorkspaceKey

    // If workspace changed, discard old promise
    if (lastKey !== workspaceCacheKey) {
      logger.info('[WorkflowStore] Workspace changed, discarding old fetch promise', {
        oldKey: lastKey,
        newKey: workspaceCacheKey
      })
      set({ fetchPromise: null })
    }

    // If already fetching for THIS workspace, return the existing promise
    if (state.fetchPromise && state.loadingList && !force) {
      logger.info('[WorkflowStore] Already fetching for same workspace, waiting for existing request')
      return state.fetchPromise
    }

    // Force refresh clears the promise
    if (force) {
      set({ fetchPromise: null })
    }

    // Cache duration: 30 seconds for navigation performance
    // Workflows don't change that frequently during normal usage
    const CACHE_DURATION = 30000 // 30 seconds
    const timeSinceLastFetch = state.lastFetchTime ? Date.now() - state.lastFetchTime : Infinity

    if (!force && timeSinceLastFetch < CACHE_DURATION && state.loadedOnce && state.fetchStatus === 'success') {
      logger.info('[WorkflowStore] Using cached workflows (age: ' + Math.round(timeSinceLastFetch / 1000) + 's)')
      return
    }

    // Create the fetch promise
    const fetchPromise = (async () => {
      logger.info('[WorkflowStore] Starting fresh workflow fetch (unified view)')
      set(applyFetchTransition(get(), { type: 'FETCH_START' }))

      try {
        // Try to get user session, but handle auth failures gracefully
        let user;
        try {
          const sessionData = await SessionManager.getSecureUserAndSession();
          user = sessionData.user;
        } catch (authError: any) {
          logger.info("User not authenticated, skipping workflow fetch")
          // Transient if we have no confirmed identity change; logout if we had a user
          const currentState = get()
          if (currentState.currentUserId && currentState.dataOwnerKey) {
            // Had a user before — this is a transient failure (auth not ready yet)
            set(applyFetchTransition(currentState, { type: 'TRANSIENT_FAILURE', error: 'Auth not ready' }))
          } else {
            // No prior user — treat as logout/initial state
            set(applyFetchTransition(currentState, { type: 'LOGOUT' }))
          }
          return
        }

        const currentState = get()
        const ownerKey = buildDataOwnerKey(user.id, effectiveWorkspaceType, effectiveWorkspaceId)

        // Check for identity change (different user or workspace)
        if (currentState.currentUserId && user.id !== currentState.currentUserId) {
          logger.warn("User session mismatch detected — clearing stale data")
          set({
            ...applyFetchTransition(currentState, { type: 'IDENTITY_CHANGE', ownerKey }),
            currentUserId: user.id,
          })
        } else if (!currentState.currentUserId) {
          set({ currentUserId: user.id })
        }

        // Fetch ALL workflows (unified view) - pass null/undefined to get everything
        // Include trashed workflows so the UI can display them in the trash folder
        const workflows = await WorkflowService.fetchWorkflows(force, filterContext || null, workspaceId, true)

        logger.info('[WorkflowStore] Successfully fetched workflows (unified view)', {
          count: workflows.length,
          filterContext: filterContext || 'ALL',
          workspaceId
        });

        set({
          ...applyFetchTransition(get(), { type: 'FETCH_SUCCESS', workflows, ownerKey }),
          lastWorkspaceKey: workspaceCacheKey
        })

      } catch (error: any) {
        logger.error("Error fetching workflows:", error)
        // Transient failure — preserve existing workflows for same identity
        set(applyFetchTransition(get(), { type: 'TRANSIENT_FAILURE', error: error.message || 'Failed to fetch workflows' }))
      }
    })()

    // Store the promise
    set({ fetchPromise })

    // Execute and wait for it
    await fetchPromise
  },

  fetchPersonalWorkflows: async () => {
    // Fetch workflows with personal workspace context
    await get().fetchWorkflows(false, 'personal')
  },

  fetchOrganizationWorkflows: async (organizationId: string) => {
    // Fetch workflows with organization workspace context
    await get().fetchWorkflows(false, 'organization', organizationId)
  },

  getGroupedWorkflows: () => {
    const { workflows } = get()

    const grouped: GroupedWorkflows = {
      personal: [],
      teams: {},
      organizations: {}
    }

    workflows.forEach(workflow => {
      if (workflow.workspace_type === 'personal') {
        grouped.personal.push(workflow)
      } else if (workflow.workspace_type === 'team' && workflow.workspace_id) {
        if (!grouped.teams[workflow.workspace_id]) {
          grouped.teams[workflow.workspace_id] = []
        }
        grouped.teams[workflow.workspace_id].push(workflow)
      } else if (workflow.workspace_type === 'organization' && workflow.workspace_id) {
        if (!grouped.organizations[workflow.workspace_id]) {
          grouped.organizations[workflow.workspace_id] = []
        }
        grouped.organizations[workflow.workspace_id].push(workflow)
      }
    })

    return grouped
  },

  createWorkflow: async (name: string, description?: string, organizationId?: string, folderId?: string) => {
    set({ loadingCreate: true, error: null })

    try {
      const state = get()
      const effectiveWorkspaceType = state.workspaceType
      const effectiveWorkspaceId = state.workspaceId

      const workflow = await WorkflowService.createWorkflow(
        name,
        description,
        effectiveWorkspaceType,
        effectiveWorkspaceId || undefined,
        organizationId,
        folderId
      )

      // Add to local store
      set((state) => ({
        workflows: [workflow, ...state.workflows],
      }))

      // Track beta tester activity
      try {
        const { user } = await SessionManager.getSecureUserAndSession()
        if (user) {
          await trackBetaTesterActivity({
            userId: user.id,
            activityType: 'workflow_created',
            activityData: {
              workflowId: workflow.id,
              workflowName: workflow.name
            }
          })
        }
      } catch (trackError) {
        logger.warn("Failed to track workflow creation:", trackError)
      }

      return workflow
    } catch (error: any) {
      logger.error("Error creating workflow:", error)
      throw error
    } finally {
      set({ loadingCreate: false })
    }
  },

  updateWorkflow: async (id: string, updates: Partial<Workflow>) => {
    set((state) => {
      const next = new Set(state.updatingWorkflowIds)
      next.add(id)
      return { updatingWorkflowIds: Array.from(next) }
    })

    try {
      // Get the current workflow to compare status changes
      const currentWorkflow = get().workflows.find(w => w.id === id)
      const oldStatus = currentWorkflow?.status
      const newStatus = updates.status

      logger.info(`[WorkflowStore] Updating workflow ${id}:`, {
        oldStatus,
        newStatus,
        updates
      })

      // Use WorkflowService to update
      const responseData = await WorkflowService.updateWorkflow(id, updates)

      // If the server rolled back the status (e.g., trigger activation failed),
      // use the server's actual status instead of our intended updates
      const effectiveUpdates = responseData?.triggerActivationError
        ? { ...updates, status: responseData.status || 'inactive' }
        : updates

      // Update local store - merge updates with existing workflow
      set((state) => ({
        workflows: state.workflows.map((w) => (w.id === id ? { ...w, ...effectiveUpdates } : w)),
        currentWorkflow:
          state.currentWorkflow?.id === id ? { ...state.currentWorkflow, ...effectiveUpdates } : state.currentWorkflow,
      }))

      // Invalidate cache so next fetchWorkflows() gets fresh data
      set({ lastFetchTime: null, fetchPromise: null })

      // Return trigger activation error so callers can show toast
      if (responseData?.triggerActivationError) {
        logger.warn(`[WorkflowStore] Trigger activation failed for workflow ${id}:`, responseData.triggerActivationError)
        return responseData.triggerActivationError
      }

      logger.info(`[WorkflowStore] Successfully updated workflow ${id}`)

    } catch (error: any) {
      logger.error("Error updating workflow:", error)
      throw error
    } finally {
      set((state) => {
        const next = new Set(state.updatingWorkflowIds)
        next.delete(id)
        return { updatingWorkflowIds: Array.from(next) }
      })
    }
  },

  deleteWorkflow: async (id: string) => {
    // Get workflow details before deletion for logging
    const workflowToDelete = get().workflows.find(w => w.id === id)

    if (!workflowToDelete) {
      throw new Error('Workflow not found')
    }

    // OPTIMISTIC UPDATE: Remove from UI immediately
    set((state) => ({
      workflows: state.workflows.filter((w) => w.id !== id),
      currentWorkflow: state.currentWorkflow?.id === id ? null : state.currentWorkflow,
      deletingWorkflowIds: [...state.deletingWorkflowIds, id]
    }))

    // Handle backend deletion asynchronously (non-blocking)
    const deleteAsync = async () => {
      try {
        // Use WorkflowService to delete
        await WorkflowService.deleteWorkflow(id)

        // Track beta tester activity
        try {
          const { user } = await SessionManager.getSecureUserAndSession()
          if (user) {
            await trackBetaTesterActivity({
              userId: user.id,
              activityType: 'workflow_deleted',
              activityData: {
                workflowId: id,
                workflowName: workflowToDelete.name
              }
            })
          }
        } catch (trackError) {
          logger.warn("Failed to track workflow deletion:", trackError)
        }

        logger.info("Workflow deleted successfully:", id)
      } catch (error: any) {
        logger.error("Error deleting workflow from backend:", error.message, {
          workflowId: id,
          workflowName: workflowToDelete.name
        })
      } finally {
        // Remove from deleting state
        set((state) => ({
          deletingWorkflowIds: state.deletingWorkflowIds.filter(wId => wId !== id)
        }))
      }
    }

    // Execute deletion asynchronously - don't await (non-blocking)
    deleteAsync().catch((error) => {
      logger.error("Unexpected error in async workflow deletion:", error.message, {
        workflowId: id
      })
    })

    // Return immediately (optimistic update already applied)
  },

  moveWorkflowToTrash: async (id: string) => {
    const workflowToTrash = get().workflows.find(w => w.id === id)

    if (!workflowToTrash) {
      throw new Error('Workflow not found')
    }

    // OPTIMISTIC UPDATE: Remove from active list immediately
    set((state) => ({
      workflows: state.workflows.filter(w => w.id !== id),
      currentWorkflow: state.currentWorkflow?.id === id ? null : state.currentWorkflow,
    }))

    try {
      await WorkflowService.batchOperation('trash', [id])

      // Clear cache and background refetch for consistency
      set({ lastFetchTime: null, fetchPromise: null })
      get().fetchWorkflows(true)

      logger.info("Workflow moved to trash:", id)
    } catch (error: any) {
      // ROLLBACK: Restore workflow on failure
      set((state) => ({
        workflows: [...state.workflows, workflowToTrash],
      }))

      const errorMessage = error?.message || error?.toString() || 'Unknown error'
      logger.error("Error moving workflow to trash:", errorMessage, {
        workflowId: id,
        error: error?.stack || error
      })
      throw error
    }
  },

  restoreWorkflowFromTrash: async (id: string) => {
    try {
      await WorkflowService.batchOperation('restore', [id])

      // Clear cache and refresh workflows to show updated state
      set({ lastFetchTime: null, fetchPromise: null })
      await get().fetchWorkflows()

      logger.info("Workflow restored from trash:", id)
    } catch (error: any) {
      const errorMessage = error?.message || error?.toString() || 'Unknown error'
      logger.error("Error restoring workflow from trash:", errorMessage, {
        workflowId: id,
        error: error?.stack || error
      })
      throw error
    }
  },

  emptyTrash: async () => {
    try {
      await WorkflowService.batchOperation('empty-trash', [])

      // Clear cache and refresh workflows to show updated state
      set({ lastFetchTime: null, fetchPromise: null })
      await get().fetchWorkflows()

      logger.info("User trash emptied successfully")
    } catch (error: any) {
      const errorMessage = error?.message || error?.toString() || 'Unknown error'
      logger.error("Error emptying trash:", errorMessage, {
        error: error?.stack || error
      })
      throw error
    }
  },

  moveWorkflowToOrganization: async (workflowId: string, organizationId: string) => {
    // TEMP: organization_id column doesn't exist yet (pending workspace migration)
    // This function is disabled until the migration is complete
    logger.warn("moveWorkflowToOrganization called but organization_id column doesn't exist yet - operation skipped")
    throw new Error("Organization features are not yet available. The workspace migration is pending.")
  },

  // --- Duplication ---

  duplicateWorkflow: async (id: string) => {
    try {
      const duplicated = await WorkflowService.duplicateWorkflow(id)
      // Add to local list and invalidate cache
      set((state) => ({
        workflows: [duplicated, ...state.workflows],
        lastFetchTime: null,
        fetchPromise: null,
      }))
      logger.info('[WorkflowStore] Workflow duplicated:', id)
      return duplicated
    } catch (error: any) {
      logger.error('[WorkflowStore] Failed to duplicate workflow:', error.message)
      throw error
    }
  },

  // --- Sharing ---

  shareWorkflow: async (id: string, teamIds: string[]) => {
    try {
      await WorkflowService.shareWorkflow(id, teamIds)
      set({ lastFetchTime: null, fetchPromise: null })
      logger.info('[WorkflowStore] Workflow shared:', { id, teamIds })
    } catch (error: any) {
      logger.error('[WorkflowStore] Failed to share workflow:', error.message)
      throw error
    }
  },

  unshareWorkflow: async (id: string, teamId: string) => {
    try {
      await WorkflowService.unshareWorkflow(id, teamId)
      set({ lastFetchTime: null, fetchPromise: null })
      logger.info('[WorkflowStore] Workflow unshared:', { id, teamId })
    } catch (error: any) {
      logger.error('[WorkflowStore] Failed to unshare workflow:', error.message)
      throw error
    }
  },

  // --- Permissions ---

  addPermission: async (workflowId: string, userId: string, permission: string) => {
    try {
      await WorkflowService.addPermission(workflowId, userId, permission)
      logger.info('[WorkflowStore] Permission added:', { workflowId, userId, permission })
    } catch (error: any) {
      logger.error('[WorkflowStore] Failed to add permission:', error.message)
      throw error
    }
  },

  removePermission: async (workflowId: string, userId: string) => {
    try {
      await WorkflowService.removePermission(workflowId, userId)
      logger.info('[WorkflowStore] Permission removed:', { workflowId, userId })
    } catch (error: any) {
      logger.error('[WorkflowStore] Failed to remove permission:', error.message)
      throw error
    }
  },

  updatePermission: async (workflowId: string, userId: string, permission: string) => {
    try {
      await WorkflowService.updatePermission(workflowId, userId, permission)
      logger.info('[WorkflowStore] Permission updated:', { workflowId, userId, permission })
    } catch (error: any) {
      logger.error('[WorkflowStore] Failed to update permission:', error.message)
      throw error
    }
  },

  // --- Batch Operations ---

  batchMoveToFolder: async (workflowIds: string[], folderId: string) => {
    // Optimistic update
    set((state) => ({
      workflows: state.workflows.map(w =>
        workflowIds.includes(w.id) ? { ...w, folder_id: folderId } : w
      ),
    }))

    try {
      await WorkflowService.batchOperation('move', workflowIds, { folder_id: folderId })
      set({ lastFetchTime: null, fetchPromise: null })
      logger.info('[WorkflowStore] Batch move to folder:', { workflowIds, folderId })
    } catch (error: any) {
      // Rollback — refetch to get correct state
      set({ lastFetchTime: null, fetchPromise: null })
      get().fetchWorkflows(true)
      logger.error('[WorkflowStore] Batch move failed:', error.message)
      throw error
    }
  },

  batchTrash: async (workflowIds: string[]) => {
    const originalWorkflows = get().workflows.filter(w => workflowIds.includes(w.id))

    // Optimistic remove
    set((state) => ({
      workflows: state.workflows.filter(w => !workflowIds.includes(w.id)),
    }))

    try {
      await WorkflowService.batchOperation('trash', workflowIds)
      set({ lastFetchTime: null, fetchPromise: null })
      logger.info('[WorkflowStore] Batch trash:', workflowIds)
    } catch (error: any) {
      // Rollback
      set((state) => ({
        workflows: [...state.workflows, ...originalWorkflows],
        lastFetchTime: null,
        fetchPromise: null,
      }))
      logger.error('[WorkflowStore] Batch trash failed:', error.message)
      throw error
    }
  },

  batchDelete: async (workflowIds: string[]) => {
    const originalWorkflows = get().workflows.filter(w => workflowIds.includes(w.id))

    // Optimistic remove
    set((state) => ({
      workflows: state.workflows.filter(w => !workflowIds.includes(w.id)),
    }))

    try {
      await WorkflowService.batchOperation('delete', workflowIds)
      set({ lastFetchTime: null, fetchPromise: null })
      logger.info('[WorkflowStore] Batch delete:', workflowIds)
    } catch (error: any) {
      // Rollback
      set((state) => ({
        workflows: [...state.workflows, ...originalWorkflows],
        lastFetchTime: null,
        fetchPromise: null,
      }))
      logger.error('[WorkflowStore] Batch delete failed:', error.message)
      throw error
    }
  },

  batchRestore: async (workflowIds: string[]) => {
    try {
      await WorkflowService.batchOperation('restore', workflowIds)
      set({ lastFetchTime: null, fetchPromise: null })
      await get().fetchWorkflows(true)
      logger.info('[WorkflowStore] Batch restore:', workflowIds)
    } catch (error: any) {
      logger.error('[WorkflowStore] Batch restore failed:', error.message)
      throw error
    }
  },

  // --- Activation ---

  activateWorkflow: async (id: string) => {
    // Optimistic status update
    set((state) => ({
      workflows: state.workflows.map(w =>
        w.id === id ? { ...w, status: 'active' as const } : w
      ),
    }))

    try {
      const result = await WorkflowService.activateWorkflow(id)
      set({ lastFetchTime: null, fetchPromise: null })
      logger.info('[WorkflowStore] Workflow activated:', id)
      return result
    } catch (error: any) {
      // Rollback
      set((state) => ({
        workflows: state.workflows.map(w =>
          w.id === id ? { ...w, status: 'inactive' as const } : w
        ),
      }))
      logger.error('[WorkflowStore] Activation failed:', error.message)
      throw error
    }
  },

  deactivateWorkflow: async (id: string) => {
    // Optimistic status update
    set((state) => ({
      workflows: state.workflows.map(w =>
        w.id === id ? { ...w, status: 'inactive' as const } : w
      ),
    }))

    try {
      const result = await WorkflowService.deactivateWorkflow(id)
      set({ lastFetchTime: null, fetchPromise: null })
      logger.info('[WorkflowStore] Workflow deactivated:', id)
      return result
    } catch (error: any) {
      // Rollback
      set((state) => ({
        workflows: state.workflows.map(w =>
          w.id === id ? { ...w, status: 'active' as const } : w
        ),
      }))
      logger.error('[WorkflowStore] Deactivation failed:', error.message)
      throw error
    }
  },

  // --- Folders ---

  fetchFolders: async () => {
    set({ foldersLoading: true })
    try {
      const folders = await WorkflowService.fetchFolders()
      set({ folders, foldersLoading: false })
    } catch (error: any) {
      logger.error('[WorkflowStore] Failed to fetch folders:', error.message)
      set({ foldersLoading: false })
      throw error
    }
  },

  createFolder: async (name: string, description?: string) => {
    try {
      const result = await WorkflowService.createFolder(name, description)
      const folder = result.data?.folder || result.folder || result
      set((state) => ({ folders: [...state.folders, folder] }))
      logger.info('[WorkflowStore] Folder created:', name)
      return folder
    } catch (error: any) {
      logger.error('[WorkflowStore] Failed to create folder:', error.message)
      throw error
    }
  },

  updateFolder: async (id: string, updates: { name?: string; description?: string }) => {
    // Optimistic update
    set((state) => ({
      folders: state.folders.map(f => f.id === id ? { ...f, ...updates } : f),
    }))

    try {
      await WorkflowService.updateFolder(id, updates)
      logger.info('[WorkflowStore] Folder updated:', id)
    } catch (error: any) {
      // Rollback — refetch
      get().fetchFolders()
      logger.error('[WorkflowStore] Failed to update folder:', error.message)
      throw error
    }
  },

  deleteFolder: async (id: string, options?: { action?: string; targetFolderId?: string | null }) => {
    const originalFolders = get().folders

    // Optimistic remove
    set((state) => ({
      folders: state.folders.filter(f => f.id !== id),
    }))

    try {
      await WorkflowService.deleteFolder(id, options)
      set({ lastFetchTime: null, fetchPromise: null })
      logger.info('[WorkflowStore] Folder deleted:', id)
    } catch (error: any) {
      // Rollback
      set({ folders: originalFolders })
      logger.error('[WorkflowStore] Failed to delete folder:', error.message)
      throw error
    }
  },

  setDefaultFolder: async (id: string) => {
    try {
      await WorkflowService.setDefaultFolder(id)
      // Refresh folders to get updated default state
      get().fetchFolders()
      logger.info('[WorkflowStore] Default folder set:', id)
    } catch (error: any) {
      logger.error('[WorkflowStore] Failed to set default folder:', error.message)
      throw error
    }
  },

  invalidateCache: () => {
    logger.info('🏪 [WorkflowStore] Invalidating cache')
    set({ lastFetchTime: null, fetchPromise: null })
  },

  setCurrentWorkflow: (workflow: Workflow | null) => {
    logger.info('🏪 [WorkflowStore] Setting current workflow:', {
      id: workflow?.id,
      name: workflow?.name,
      nameType: typeof workflow?.name,
      nameIsEmpty: !workflow?.name,
      nameIsNull: workflow?.name === null,
      nameIsUndefined: workflow?.name === undefined
    });
    set({ currentWorkflow: workflow })
  },

  setSelectedNode: (node: WorkflowNode | null) => {
    set({ selectedNode: node })
  },

  setWorkspaceContext: async (workspaceType: 'personal' | 'team' | 'organization', workspaceId?: string | null) => {
    const state = get()
    const newWorkspaceId = workspaceId || null

    // Check if workspace context is actually changing
    const contextChanged = state.workspaceType !== workspaceType || state.workspaceId !== newWorkspaceId

    logger.info('[WorkflowStore] Setting workspace context:', {
      workspaceType,
      workspaceId: newWorkspaceId,
      previousType: state.workspaceType,
      previousId: state.workspaceId,
      contextChanged
    });

    // If context hasn't changed, do nothing
    if (!contextChanged) {
      logger.info('[WorkflowStore] Workspace context unchanged, skipping refetch')
      return
    }

    // Identity change — clear stale data for the new workspace
    const newOwnerKey = state.currentUserId
      ? buildDataOwnerKey(state.currentUserId, workspaceType, newWorkspaceId)
      : null

    set({
      ...applyFetchTransition(state, { type: 'IDENTITY_CHANGE', ownerKey: newOwnerKey || '' }),
      workspaceType,
      workspaceId: newWorkspaceId,
      lastWorkspaceKey: null,
    })

    // DON'T auto-fetch here - let the caller decide when to fetch
    // This prevents infinite loops when called from AppContext
  },

  addNode: (node: WorkflowNode) => {
    set((state) => ({
      currentWorkflow: state.currentWorkflow
        ? {
            ...state.currentWorkflow,
            nodes: [...state.currentWorkflow.nodes, node],
          }
        : null,
    }))
  },

  updateNode: (nodeId: string, updates: Partial<WorkflowNode>) => {
    set((state) => ({
      currentWorkflow: state.currentWorkflow
        ? {
            ...state.currentWorkflow,
            nodes: state.currentWorkflow.nodes.map((node) => (node.id === nodeId
              ? {
                  ...node,
                  ...updates,
                  data: {
                    ...node.data,
                    ...(updates.data || {}),
                  },
                }
              : node
            )),
            validationState: updates.data?.validationState
              ? {
                  invalidNodeIds: Array.from(
                    new Set([
                      ...(state.currentWorkflow.validationState?.invalidNodeIds || []).filter(id => id !== nodeId),
                      ...(updates.data.validationState.isValid ? [] : [nodeId])
                    ])
                  ),
                  lastValidatedAt: updates.data.validationState.lastValidatedAt,
                  lastUpdatedAt: updates.data.validationState.lastUpdatedAt
                }
              : state.currentWorkflow.validationState,
          }
        : null,
    }))
  },

  removeNode: (nodeId: string) => {
    set((state) => ({
      currentWorkflow: state.currentWorkflow
        ? {
            ...state.currentWorkflow,
            nodes: state.currentWorkflow.nodes.filter((node) => node.id !== nodeId),
            connections: state.currentWorkflow.connections.filter(
              (conn) => conn.source !== nodeId && conn.target !== nodeId,
            ),
          }
        : null,
    }))
  },

  saveWorkflow: async () => {
    const { currentWorkflow } = get()
    if (!currentWorkflow || !supabase) return

    set({ loadingSave: true, error: null })

    try {
      // Determine the appropriate status based on workflow completeness
      const hasTrigger = currentWorkflow.nodes.some(node => node.data?.isTrigger)
      const hasActions = currentWorkflow.nodes.some(node => !node.data?.isTrigger)

      const nodesForUpdate = JSON.parse(JSON.stringify(currentWorkflow.nodes || [])) as WorkflowNode[]
      const connectionsForUpdate = JSON.parse(JSON.stringify(currentWorkflow.connections || [])) as WorkflowConnection[]

      const hasConnections = connectionsForUpdate.length > 0
      const isStructurallyComplete = hasTrigger && hasActions && hasConnections
      const currentStatus = currentWorkflow.status || 'draft'

      // Preserve existing status on save. Only the activation API should promote to 'active'.
      // If structure is broken (no trigger/action/connections), downgrade to 'draft'.
      const newStatus = isStructurallyComplete ? (currentStatus || 'draft') : 'draft'

      // Validate the data structure before sending
      if (!Array.isArray(nodesForUpdate) || !Array.isArray(connectionsForUpdate)) {
        throw new Error("Invalid workflow data structure")
      }

      // Save through the normalized API path — writes to workflow_nodes + workflow_edges tables.
      // Server-side auto-wiring handles edge generation if needed.
      const responseData = await WorkflowService.updateWorkflow(currentWorkflow.id, {
        nodes: nodesForUpdate,
        connections: connectionsForUpdate,
        status: newStatus,
      })

      // Use server response (which may include auto-wired edges) as the source of truth
      const updatedWorkflowState: Workflow = {
        ...currentWorkflow,
        nodes: responseData?.nodes || nodesForUpdate,
        connections: responseData?.connections || connectionsForUpdate,
        status: responseData?.status || newStatus,
        updated_at: responseData?.updated_at || new Date().toISOString()
      }

      // Update the workflow in the list
      set((state) => ({
        workflows: state.workflows.map((w) =>
          w.id === currentWorkflow.id
            ? { ...w, ...updatedWorkflowState }
            : w,
        ),
        currentWorkflow: updatedWorkflowState
      }))

      // Audit logging is handled server-side by the PUT /api/workflows/[id] endpoint
    } catch (error: any) {
      logger.error("Error saving workflow:", error)
      throw error
    } finally {
      set({ loadingSave: false })
    }
  },

  generateWorkflowWithAI: async (prompt: string) => {
    try {
      const response = await fetch("/api/ai/generate-workflow", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ prompt }),
      })

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}))
        throw new Error(errorData.error || `Failed to generate workflow (${response.status})`)
      }

      const data = await response.json()

      if (!data.success) {
        throw new Error(data.error || "Failed to generate workflow")
      }

      // Add the new workflow to the list
      set((state) => ({
        workflows: [data.workflow, ...state.workflows],
      }))

      return data.workflow
    } catch (error: any) {
      logger.error("Error generating workflow with AI:", error)
      throw error
    }
  },

  createTemplateFromWorkflow: async (workflowId: string, templateData) => {
    if (!supabase) {
      throw new Error("Supabase not available")
    }

    try {
      const workflow = get().workflows.find((w) => w.id === workflowId)
      if (!workflow) throw new Error("Workflow not found")

      // PR-AUTH-5: cached user id.
      const { useAuthStore } = await import('./authStore')
      const user = useAuthStore.getState().user
      if (!user) throw new Error("User not authenticated")

      const { error } = await supabase.from("templates").insert({
        ...templateData,
        workflow_json: {
          nodes: workflow.nodes,
          connections: workflow.connections,
        },
        created_by: user.id,
      })

      if (error) throw error
    } catch (error: any) {
      logger.error("Error creating template:", error)
      throw error
    }
  },

  // Helper function to check if a workflow is complete
  isWorkflowComplete: (workflow: Workflow): boolean => {
    const hasTrigger = workflow.nodes.some(node => node.data?.isTrigger)
    const hasActions = workflow.nodes.some(node => !node.data?.isTrigger)
    const hasConnections = workflow.connections.length > 0
    return hasTrigger && hasActions && hasConnections
  },

  // Function to update workflow status based on completeness
  updateWorkflowStatus: async (id: string) => {
    const { workflows, updateWorkflow } = get()
    const workflow = workflows.find(w => w.id === id)
    
    if (!workflow) return

    const isComplete = get().isWorkflowComplete(workflow)
    const newStatus = isComplete ? 'active' : 'draft'
    
    if (workflow.status !== newStatus) {
      await updateWorkflow(id, { status: newStatus })
    }
  },

  pauseWorkflowsForIntegration: async (providerId: string) => {
    const { workflows, updateWorkflow } = get()
    const affectedWorkflows = workflows.filter(workflow =>
      Array.isArray(workflow.nodes) && workflow.nodes.some(node => {
        const nodeProvider =
          node.data?.providerId ||
          node.data?.config?.providerId ||
          ALL_NODE_COMPONENTS.find(component => component.type === node.data?.type)?.providerId
        return nodeProvider === providerId
      })
    )

    if (!affectedWorkflows.length) return

    for (const workflow of affectedWorkflows) {
      if (workflow.status !== 'inactive') {
        const validationState = {
          ...(workflow.validationState || {}),
          integrationPaused: providerId,
          lastValidatedAt: new Date().toISOString(),
        }

        await updateWorkflow(workflow.id, {
          status: 'inactive',
          validationState: validationState as any,
        })
      }
    }
  },

  resumeWorkflowsForIntegration: async (providerId: string) => {
    const { workflows, updateWorkflow } = get()
    const affectedWorkflows = workflows.filter(workflow =>
      workflow.status === 'inactive' && workflow.validationState?.integrationPaused === providerId
    )

    if (!affectedWorkflows.length) return

    for (const workflow of affectedWorkflows) {
      const validationState = {
        ...(workflow.validationState || {}),
        lastValidatedAt: new Date().toISOString(),
      }
      delete (validationState as any).integrationPaused

      await updateWorkflow(workflow.id, {
        status: 'draft',
        validationState: validationState as any,
      })
    }
  },

  clearAllData: () => {
    set({
      ...applyFetchTransition(get(), { type: 'LOGOUT' }),
      currentWorkflow: null,
      selectedNode: null,
      loadingCreate: false,
      loadingSave: false,
      updatingWorkflowIds: [],
      deletingWorkflowIds: [],
    })
  },

  recalculateWorkflowValidation: (workflow: Workflow): Workflow => {
    // Import validation utilities
    const { validateWorkflowNodes } = require('@/lib/workflows/validation/workflow')
    const { ALL_NODE_COMPONENTS } = require('@/lib/workflows/nodes')

    // Validate nodes and get the result
    const validationResult = validateWorkflowNodes(workflow, ALL_NODE_COMPONENTS)

    // Update workflow with validated nodes and validation state
    return {
      ...workflow,
      nodes: validationResult.nodes,
      validationState: {
        invalidNodeIds: validationResult.invalidNodeIds,
        lastValidatedAt: new Date().toISOString(),
        lastUpdatedAt: workflow.updated_at,
      },
    }
  },

  addWorkflowToStore: (workflow: Workflow) => {
    logger.info('[WorkflowStore] Adding workflow to store:', workflow.id)
    set((state) => ({
      workflows: [workflow, ...state.workflows.filter(existing => existing.id !== workflow.id)],
    }))
  },
}))

// Initialize cross-tab synchronization for workflow state
if (typeof window !== 'undefined') {
  const sync = getCrossTabSync()

  // Listen for workflow updates from other tabs
  sync.subscribe('workflow-updated', (data) => {
    logger.info('[WorkflowStore] Received workflow-updated event from another tab', data)
    const state = useWorkflowStore.getState()
    // Refresh workflows to get the latest state
    if (state.fetchWorkflows) {
      state.fetchWorkflows(true)
    }
  })

  // Listen for workflow deletion from other tabs
  sync.subscribe('workflow-deleted', (data) => {
    logger.info('[WorkflowStore] Received workflow-deleted event from another tab', data)
    const state = useWorkflowStore.getState()
    // Remove the workflow from local state
    set((currentState: any) => ({
      workflows: currentState.workflows.filter((w: any) => w.id !== data.workflowId),
    }))
  })

  // Listen for workspace changes from other tabs
  sync.subscribe('workspace-changed', (data) => {
    logger.info('[WorkflowStore] Received workspace-changed event from another tab', data)
    const state = useWorkflowStore.getState()
    // Refresh workflows for the new workspace
    if (state.fetchWorkflows) {
      state.fetchWorkflows(true)
    }
  })
}
