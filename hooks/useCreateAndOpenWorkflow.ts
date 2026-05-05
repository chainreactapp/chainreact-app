/**
 * Hook for creating a workflow and navigating directly to the builder.
 * This unifies the workflow creation flow - no separate AI agent page needed.
 * The builder opens with the AI panel visible by default.
 */

import { useCallback, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useWorkflowStore } from '@/stores/workflowStore'
import { useWorkspaceContext } from '@/hooks/useWorkspaceContext'
import { useAuthStore } from '@/stores/authStore'
import { toast } from '@/hooks/use-toast'
import { logger } from '@/lib/utils/logger'

const SESSION_TIMEOUT_PATTERN = /timed out|getSession|refreshSession|No authenticated user/i

interface CreateWorkflowOptions {
  /** Initial prompt to pass to the AI agent (optional) */
  prompt?: string
  /** Workspace type override */
  workspaceType?: 'personal' | 'team' | 'organization'
  /** Workspace ID override */
  workspaceId?: string | null
}

export function useCreateAndOpenWorkflow() {
  const router = useRouter()
  const { setWorkspaceContext } = useWorkflowStore()
  const { workspaceContext } = useWorkspaceContext()
  const { profile } = useAuthStore()
  const [isCreating, setIsCreating] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const createAndOpen = useCallback(async (options: CreateWorkflowOptions = {}) => {
    setIsCreating(true)
    setError(null)

    try {
      // Determine workspace context
      const wsType = options.workspaceType || workspaceContext?.type || 'personal'
      const wsId = options.workspaceId !== undefined ? options.workspaceId : workspaceContext?.id || null

      // Set workspace context
      setWorkspaceContext(wsType, wsId)

      logger.info('[useCreateAndOpenWorkflow] Creating workflow', {
        workspaceType: wsType,
        workspaceId: wsId,
        hasPrompt: !!options.prompt,
      })

      // Create workflow via store
      const { createWorkflow } = useWorkflowStore.getState()
      const workflow = await createWorkflow('New Workflow', '', undefined)
      const flowId = workflow.id

      if (!flowId) {
        throw new Error('No workflow ID returned')
      }

      logger.info('[useCreateAndOpenWorkflow] Workflow created', { flowId })

      // Build the URL - always open AI panel for new workflows
      let url = `/workflows/builder/${flowId}?openPanel=true`
      if (options.prompt) {
        url += `&prompt=${encodeURIComponent(options.prompt)}`
      }

      // Navigate to builder
      router.push(url)

      return { flowId }
    } catch (err: any) {
      const message = err?.message || 'Failed to create workflow'
      const isAuthIssue = SESSION_TIMEOUT_PATTERN.test(message)
      logger.error('[useCreateAndOpenWorkflow] Error', {
        error: message,
        isAuthIssue,
        workspaceType: options.workspaceType || workspaceContext?.type || 'personal',
      })
      setError(message)

      toast({
        variant: 'destructive',
        title: "Couldn't create workflow",
        description: isAuthIssue
          ? 'Your session may have expired. Please refresh and try again.'
          : 'Please refresh and try again.',
      })

      throw err
    } finally {
      setIsCreating(false)
    }
  }, [router, setWorkspaceContext, workspaceContext])

  return {
    createAndOpen,
    isCreating,
    error,
  }
}
