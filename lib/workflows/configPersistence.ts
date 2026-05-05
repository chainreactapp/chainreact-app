"use client"

import { createClient } from "@/utils/supabase/client"
import { logger } from '@/lib/utils/logger'
import { safeLocalStorageSet } from '@/lib/utils/storage-cleanup'

/**
 * Configuration persistence utility for workflow node configurations
 * Uses the normalized workflow_nodes table as single source of truth
 */

// PR-AUTH-7: cached user lookup. Lazy-imports authStore so this module
// stays tree-shakeable from non-React contexts.
async function getCachedUser(): Promise<{ id: string } | null> {
  const { useAuthStore } = await import("@/stores/authStore")
  return useAuthStore.getState().user ?? null
}

/**
 * Save node configuration to the workflow_nodes table
 * @param workflowId The ID of the workflow
 * @param nodeId The ID of the node
 * @param nodeType The type of the node (unused, kept for API compatibility)
 * @param config The configuration data to save
 * @param dynamicOptions Optional dynamic options to save alongside configuration
 */
export const saveNodeConfig = async (
  workflowId: string,
  nodeId: string,
  nodeType: string,
  config: Record<string, any>,
  dynamicOptions?: Record<string, any[]>
): Promise<void> => {
  if (typeof window === "undefined") return

  logger.info(`🔄 [ConfigPersistence] Saving config for node ${nodeId} in workflow ${workflowId}`)

  try {
    const supabase = createClient()

    // Get the current user
    // PR-AUTH-7: cached user from auth store.
    const user = await getCachedUser()

    if (!user) {
      logger.error(`❌ [ConfigPersistence] User not authenticated, cannot save config for node ${nodeId}`)
      throw new Error('User not authenticated')
    }

    // Prepare the full config with savedConfig metadata
    const fullConfig = {
      ...config,
      _savedConfig: {
        dynamicOptions,
        timestamp: Date.now()
      }
    }

    // Update the workflow_nodes table directly
    const { data, error: updateError } = await supabase
      .from('workflow_nodes')
      .update({
        config: fullConfig,
        updated_at: new Date().toISOString()
      })
      .eq('id', nodeId)
      .eq('workflow_id', workflowId)
      .select('id')
      .single()

    if (updateError) {
      // Node might not exist yet - store in localStorage as fallback
      if (updateError.code === 'PGRST116') {
        logger.warn(`⚠️ [ConfigPersistence] Node ${nodeId} not found in workflow_nodes - storing in localStorage as fallback`)
        const fallbackKey = `workflow_${workflowId}_node_${nodeId}_config`
        safeLocalStorageSet(fallbackKey, { config: fullConfig, timestamp: Date.now() })
        return
      }
      logger.error(`❌ [ConfigPersistence] Failed to update node config:`, updateError)
      throw updateError
    }

    if (!data) {
      // No rows matched - node doesn't exist
      logger.warn(`⚠️ [ConfigPersistence] Node ${nodeId} not found in workflow_nodes (no rows updated)`)
      const fallbackKey = `workflow_${workflowId}_node_${nodeId}_config`
      safeLocalStorageSet(fallbackKey, { config: fullConfig, timestamp: Date.now() })
      return
    }

    logger.info(`✅ [ConfigPersistence] Successfully saved configuration for node ${nodeId}`)
  } catch (error) {
    logger.error(`❌ [ConfigPersistence] Failed to save configuration for node ${nodeId}:`, error)
    throw error
  }
}


/**
 * Interface for the saved node configuration data
 */
export interface SavedNodeConfig {
  config: Record<string, any>
  dynamicOptions?: Record<string, any[]>
  timestamp: number
}

/**
 * Clear node configuration - resets config to empty object
 * @param workflowId The ID of the workflow
 * @param nodeId The ID of the node
 * @param nodeType The type of the node (unused)
 */
export const clearNodeConfig = async (
  workflowId: string,
  nodeId: string,
  nodeType: string
): Promise<void> => {
  if (typeof window === "undefined") return

  logger.info(`🗑️ [ConfigPersistence] Clearing saved configuration for node ${nodeId}`)

  // Clear any localStorage fallback data
  const fallbackKey = `workflow_${workflowId}_node_${nodeId}_config`
  localStorage.removeItem(fallbackKey)

  try {
    const supabase = createClient()

    // Get the current user
    // PR-AUTH-7: cached user from auth store.
    const user = await getCachedUser()

    if (!user) {
      logger.error(`❌ [ConfigPersistence] User not authenticated, cannot clear config for node ${nodeId}`)
      return
    }

    // Clear the config in workflow_nodes
    const { error: updateError } = await supabase
      .from('workflow_nodes')
      .update({
        config: {},
        updated_at: new Date().toISOString()
      })
      .eq('id', nodeId)
      .eq('workflow_id', workflowId)

    if (updateError) {
      logger.error(`❌ [ConfigPersistence] Failed to clear config for node ${nodeId}:`, updateError)
      return
    }

    logger.info(`✅ [ConfigPersistence] Successfully cleared configuration for node ${nodeId}`)
  } catch (error) {
    logger.error(`❌ [ConfigPersistence] Failed to clear configuration for node ${nodeId}:`, error)
  }
}

/**
 * Load node configuration from the workflow_nodes table
 * @param workflowId The ID of the workflow
 * @param nodeId The ID of the node
 * @param nodeType The type of the node (unused)
 * @returns The saved configuration data, or null if not found
 */
export const loadNodeConfig = async (
  workflowId: string,
  nodeId: string,
  nodeType: string
): Promise<SavedNodeConfig | null> => {
  if (typeof window === "undefined") return null

  logger.info(`🔍 [ConfigPersistence] Loading config for node ${nodeId} in workflow ${workflowId}`)

  try {
    const supabase = createClient()

    // Get the current user
    // PR-AUTH-7: cached user from auth store.
    const user = await getCachedUser()

    if (!user) {
      logger.info(`🔍 [ConfigPersistence] User not authenticated, cannot load config for node ${nodeId}`)
      return null
    }

    // Load from workflow_nodes table
    const { data: node, error: nodeError } = await supabase
      .from('workflow_nodes')
      .select('config')
      .eq('id', nodeId)
      .eq('workflow_id', workflowId)
      .single()

    if (nodeError || !node) {
      logger.info(`🔍 [ConfigPersistence] Node not found in workflow_nodes for ${nodeId}`)

      // Check localStorage fallback
      const fallbackKey = `workflow_${workflowId}_node_${nodeId}_config`
      const fallbackData = localStorage.getItem(fallbackKey)
      if (fallbackData) {
        try {
          const parsed = JSON.parse(fallbackData)
          logger.info(`💾 [ConfigPersistence] Loaded config from localStorage fallback for node ${nodeId}`)
          localStorage.removeItem(fallbackKey)
          return parsed as SavedNodeConfig
        } catch (e) {
          logger.error(`❌ [ConfigPersistence] Failed to parse fallback config for node ${nodeId}:`, e)
        }
      }
      return null
    }

    const config = node.config || {}

    // Extract savedConfig metadata if present
    const savedConfigMeta = config._savedConfig
    const { _savedConfig, ...cleanConfig } = config

    if (Object.keys(cleanConfig).length === 0) {
      logger.info(`🔍 [ConfigPersistence] No saved configuration found for node ${nodeId}`)
      return null
    }

    logger.info(`✅ [ConfigPersistence] Successfully loaded config for node ${nodeId}`)
    return {
      config: cleanConfig,
      dynamicOptions: savedConfigMeta?.dynamicOptions,
      timestamp: savedConfigMeta?.timestamp || Date.now()
    }
  } catch (error) {
    logger.error(`❌ [ConfigPersistence] Failed to load configuration for node ${nodeId}:`, error)
    return null
  }
}


/**
 * Clear all saved configurations for a workflow
 * @param workflowId The ID of the workflow
 */
export const clearWorkflowConfigs = async (workflowId: string): Promise<void> => {
  if (typeof window === "undefined") return

  logger.info(`🗑️ [ConfigPersistence] Clearing all configurations for workflow ${workflowId}`)

  try {
    const supabase = createClient()

    // Get the current user
    // PR-AUTH-7: cached user from auth store.
    const user = await getCachedUser()

    if (!user) {
      logger.error(`❌ [ConfigPersistence] User not authenticated, cannot clear workflow configs`)
      return
    }

    // Clear config on all nodes for this workflow
    const { error: updateError } = await supabase
      .from('workflow_nodes')
      .update({
        config: {},
        updated_at: new Date().toISOString()
      })
      .eq('workflow_id', workflowId)

    if (updateError) {
      logger.error(`❌ [ConfigPersistence] Failed to clear workflow configurations:`, updateError)
      return
    }

    logger.info(`✅ [ConfigPersistence] Successfully cleared all configurations for workflow ${workflowId}`)
  } catch (error) {
    logger.error(`❌ [ConfigPersistence] Failed to clear workflow configurations:`, error)
  }
}

/**
 * Get all saved configurations for a workflow
 * @param workflowId The ID of the workflow
 * @returns An object mapping node IDs to their saved configurations
 */
export const getAllWorkflowConfigs = async (workflowId: string): Promise<Record<string, SavedNodeConfig>> => {
  if (typeof window === "undefined") return {}

  logger.info(`🔍 [ConfigPersistence] Getting all configurations for workflow ${workflowId}`)

  try {
    const supabase = createClient()

    // Get the current user
    // PR-AUTH-7: cached user from auth store.
    const user = await getCachedUser()

    if (!user) {
      logger.info(`🔍 [ConfigPersistence] User not authenticated, cannot get workflow configs`)
      return {}
    }

    // Get all nodes for this workflow
    const { data: nodes, error: nodesError } = await supabase
      .from('workflow_nodes')
      .select('id, config')
      .eq('workflow_id', workflowId)

    if (nodesError || !nodes) {
      logger.info(`🔍 [ConfigPersistence] No nodes found for workflow ${workflowId}`)
      return {}
    }

    // Extract saved configurations from all nodes
    const configs: Record<string, SavedNodeConfig> = {}

    nodes.forEach((node: any) => {
      if (node.id && node.config && Object.keys(node.config).length > 0) {
        const { _savedConfig, ...cleanConfig } = node.config
        if (Object.keys(cleanConfig).length > 0) {
          configs[node.id] = {
            config: cleanConfig,
            dynamicOptions: _savedConfig?.dynamicOptions,
            timestamp: _savedConfig?.timestamp || Date.now()
          }
        }
      }
    })

    logger.info(`✅ [ConfigPersistence] Found ${Object.keys(configs).length} saved configurations for workflow ${workflowId}`)
    return configs
  } catch (error) {
    logger.error(`❌ [ConfigPersistence] Failed to get workflow configurations:`, error)
    return {}
  }
}

/**
 * Check if a node has a saved configuration
 * @param workflowId The ID of the workflow
 * @param nodeId The ID of the node
 * @returns True if the node has a saved configuration, false otherwise
 */
export const hasNodeConfig = async (workflowId: string, nodeId: string): Promise<boolean> => {
  if (typeof window === "undefined") return false

  logger.info(`🔍 [ConfigPersistence] Checking if node ${nodeId} has saved config`)

  try {
    const savedConfig = await loadNodeConfig(workflowId, nodeId, '')
    const hasConfig = !!savedConfig
    logger.info(`🔍 [ConfigPersistence] Node ${nodeId} has saved config: ${hasConfig}`)
    return hasConfig
  } catch (error) {
    logger.error(`❌ [ConfigPersistence] Failed to check for node configuration:`, error)
    return false
  }
}
