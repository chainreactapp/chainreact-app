import React, { useMemo, useCallback, useEffect, useState } from 'react'
import { ALL_NODE_COMPONENTS, NodeComponent } from '@/lib/workflows/nodes'
import { INTEGRATION_CONFIGS } from '@/lib/integrations/availableIntegrations'
import { useIntegrationStore } from '@/stores/integrationStore'
import { useAuthStore } from '@/stores/authStore'
import { isConnectedStatus, isIntegrationRequired } from '@/lib/integrations/connectionStatus'

import { logger } from '@/lib/utils/logger'
import { isProfileAdmin } from '@/lib/types/admin'

interface IntegrationInfo {
  id: string
  name: string
  description: string
  category: string
  color: string
  triggers: NodeComponent[]
  actions: NodeComponent[]
}

export function useIntegrationSelection() {
  const { getConnectedProviders, fetchIntegrations, integrations: storeIntegrations, loading } = useIntegrationStore()
  const { profile } = useAuthStore()
  
  // Fetch integrations once on mount if store is empty
  useEffect(() => {
    // Use a ref to track if we've already initiated a fetch
    let didFetch = false;
    
    const loadIntegrations = async () => {
      if (!didFetch && !loading && (!storeIntegrations || storeIntegrations.length === 0)) {
        didFetch = true;
        await fetchIntegrations(true); // Force fetch to ensure fresh data
      }
    };
    
    loadIntegrations();
  }, []) // Only run once on mount

  const getIntegrationsFromNodes = useCallback((): IntegrationInfo[] => {
    const integrationMap: Record<string, IntegrationInfo> = {}
    
    // Add AI Agent as a separate integration first
    integrationMap['ai'] = {
      id: 'ai',
      name: 'AI Agent',
      description: 'Intelligent automation with AI-powered decision making and task execution',
      category: 'ai',
      color: '#8B5CF6',
      triggers: [],
      actions: [],
    }
    
    // Add Core integration for system triggers
    integrationMap['core'] = {
      id: 'core',
      name: 'Core',
      description: 'System-level triggers and actions',
      category: 'system',
      color: '#6B7280',
      triggers: [],
      actions: [],
    }
    
    // Add Logic & Control integration
    integrationMap['logic'] = {
      id: 'logic',
      name: 'Logic & Control',
      description: 'Control flow and logic operations',
      category: 'system',
      color: '#6B7280',
      triggers: [],
      actions: [],
    }
    
    // Add ALL integrations from configs, including those without nodes (Coming Soon)
    for (const integrationId in INTEGRATION_CONFIGS) {
      const config = INTEGRATION_CONFIGS[integrationId]
      if (config) {
        integrationMap[integrationId] = {
          id: config.id,
          name: config.name,
          description: config.description,
          category: config.category,
          color: config.color,
          triggers: [],
          actions: [],
        }
      }
    }
    
    // Also add any missing "coming soon" integrations that might not be in INTEGRATION_CONFIGS
    const additionalComingSoonIntegrations = [
      { id: 'beehiiv', name: 'beehiiv', description: 'Newsletter platform for creators', category: 'marketing', color: '#000000' },
    ]
    
    additionalComingSoonIntegrations.forEach(integration => {
      if (!integrationMap[integration.id]) {
        integrationMap[integration.id] = {
          ...integration,
          triggers: [],
          actions: [],
        }
      }
    })
    
    // Process all node components
    ALL_NODE_COMPONENTS.forEach(node => {
      const providerId = node.providerId || node.integration

      if (providerId === 'ai') {
        if (node.isTrigger) {
          integrationMap['ai'].triggers.push(node)
        } else {
          integrationMap['ai'].actions.push(node)
        }
      } else if (providerId && integrationMap[providerId]) {
        if (node.isTrigger) {
          integrationMap[providerId].triggers.push(node)
        } else {
          integrationMap[providerId].actions.push(node)
        }
      } else if (!providerId) {
        // Handle nodes without a providerId - these go to Core
        // This includes manual, schedule, and webhook triggers
        if (node.isTrigger) {
          // Core triggers: manual, schedule, webhook
          if (['manual', 'schedule', 'webhook'].includes(node.type)) {
            integrationMap['core'].triggers.push(node)
          }
        } else {
          // Core actions (if any)
          integrationMap['core'].actions.push(node)
        }
      }
    })
    
    // Custom sort: Core/Logic first, then AI Agent, then alphabetical
    const allIntegrations = Object.values(integrationMap)
    const result = allIntegrations.sort((a, b) => {
      // Core always comes first
      if (a.id === 'core') return -1
      if (b.id === 'core') return 1

      // Logic comes second
      if (a.id === 'logic') return -1
      if (b.id === 'logic') return 1

      // AI Agent comes third
      if (a.id === 'ai') return -1
      if (b.id === 'ai') return 1

      // Everything else is alphabetical
      return a.name.localeCompare(b.name)
    })
    return result
  }, [])

  const availableIntegrations = useMemo(() => {
    const integrations = getIntegrationsFromNodes()
    return integrations
  }, [getIntegrationsFromNodes])

  const isIntegrationConnected = useCallback((integrationId: string): boolean => {
    // Built-in providers (Manual Trigger, HITL, Logic, AI Agent, etc.)
    // never need a connection — short-circuit to true. Source of truth
    // for "what's a built-in" lives in lib/integrations/connectionStatus.
    if (!isIntegrationRequired(integrationId)) {
      return true
    }

    // Check for Microsoft services - each service needs its own connection
    if (integrationId.startsWith('microsoft-') || integrationId === 'onedrive') {
      let checkIds = [integrationId]
      if (integrationId === 'microsoft-onenote') {
        checkIds.push('onenote')
      } else if (integrationId === 'microsoft-outlook') {
        checkIds.push('outlook')
      } else if (integrationId === 'microsoft-teams') {
        checkIds.push('teams')
      }
      return checkIds.some(id =>
        storeIntegrations.some(i => i.provider === id && isConnectedStatus(i.status))
      )
    }

    // For all other integrations (including Google services), check exact database match
    // Don't use the "all Google services share auth" logic - check actual DB records
    return storeIntegrations.some(i => i.provider === integrationId && isConnectedStatus(i.status))
  }, [storeIntegrations])

  const filterIntegrations = useCallback((
    integrations: IntegrationInfo[],
    searchQuery: string,
    filterCategory: string,
    showConnectedOnly: boolean
  ) => {
    return integrations.filter(integration => {
      const searchMatch = !searchQuery || 
        integration.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        integration.description.toLowerCase().includes(searchQuery.toLowerCase())
      
      const categoryMatch = filterCategory === 'all' || integration.category === filterCategory
      
      const connectionMatch = !showConnectedOnly || isIntegrationConnected(integration.id)
      
      return searchMatch && categoryMatch && connectionMatch
    })
  }, [isIntegrationConnected])

  const getDisplayedTriggers = useCallback((
    selectedIntegration: IntegrationInfo | null,
    searchQuery: string
  ) => {
    if (!selectedIntegration) return []

    // Don't filter triggers by search query - the search is for finding integrations,
    // not for filtering the triggers within a selected integration.
    // Once an integration is selected, show ALL its triggers.
    return selectedIntegration.triggers.filter(trigger => {
      if (!trigger) return false
      return true
    })
  }, [])

  const getDisplayedActions = useCallback((
    selectedIntegration: IntegrationInfo | null,
    searchQuery: string
  ) => {
    if (!selectedIntegration) return []

    // Don't filter actions by search query - the search is for finding integrations,
    // not for filtering the actions within a selected integration.
    // Once an integration is selected, show ALL its actions.
    const filtered = selectedIntegration.actions.filter(action => {
      if (!action) return false

      // Hide actions marked with hideInActionSelection
      if (action.hideInActionSelection) {
        logger.info(`Hiding action: ${action.title || action.type}`)
        return false
      }

      return true
    })

    logger.info(`[useIntegrationSelection] Filtered ${selectedIntegration.name} actions:`, {
      total: selectedIntegration.actions.length,
      filtered: filtered.length,
      actions: filtered.map(a => a.title || a.type)
    })

    return filtered
  }, [])

  const renderLogo = useCallback((integrationId: string, name?: string) => {
    // Return an img element pointing to the SVG file
    return React.createElement('img', {
      src: `/integrations/${integrationId}.svg`,
      alt: `${name || integrationId} logo`,
      className: 'w-8 h-8 object-contain',
      onError: (e: any) => {
        // Hide the image if it fails to load
        e.currentTarget.style.display = 'none'
      }
    })
  }, [])

  const categories = useMemo(() => {
    const allCategories = availableIntegrations.map(int => int.category)
    return ['all', ...Array.from(new Set(allCategories))]
  }, [availableIntegrations])

  const comingSoonIntegrations = useMemo(() => {
    const baseComingSoon = [
      'beehiiv',
      'blackbaud',
      'github',
      'stripe',
      'twitter',
      'facebook',
      'webhook',
    ]

    // Add HubSpot and Mailchimp to coming soon for non-admin and non-beta users
    const userRole = profile?.role?.toLowerCase()
    const isAdmin = isProfileAdmin(profile)
    const isBetaTester = userRole === 'beta-pro'

    if (!isAdmin && !isBetaTester) {
      baseComingSoon.push('hubspot')
      baseComingSoon.push('mailchimp')
    }

    return new Set(baseComingSoon)
  }, [profile?.role])

  // Method to manually refresh integrations
  const refreshIntegrations = useCallback(async () => {
    await fetchIntegrations(true) // Force refresh from server
  }, [fetchIntegrations])

  return {
    availableIntegrations,
    isIntegrationConnected,
    filterIntegrations,
    getDisplayedTriggers,
    getDisplayedActions,
    renderLogo,
    categories,
    comingSoonIntegrations,
    integrations: storeIntegrations,
    loadingIntegrations: loading,
    refreshIntegrations,
  }
}
