"use client"

import React, { useMemo, useState, useEffect, useRef } from 'react'
import ConfigurationForm from '../ConfigurationForm'
import { ServiceConnectionSelector } from '../ServiceConnectionSelector'
import { useIntegrationStore } from '@/stores/integrationStore'
import { logger } from '@/lib/utils/logger'
import { getProviderBrandName } from '@/lib/integrations/brandNames'
import { useToast } from '@/hooks/use-toast'
import { AlertCircle } from 'lucide-react'
import { isNodeTypeConnectionExempt, isProviderConnectionExempt } from '../utils/connectionExemptions'
import { isConnectedStatus } from '@/lib/integrations/connectionStatus'
import { INTEGRATION_CONFIGS } from '@/lib/integrations/availableIntegrations'
import { ManyChatGuide } from '@/components/integrations/guides/ManyChatGuide'
import { BeehiivGuide } from '@/components/integrations/guides/BeehiivGuide'

// MODULE-LEVEL CACHE: This survives component remounts during node switching
// When switching between same-provider nodes (e.g., Slack trigger A → B),
// the old SetupTab unmounts and a new one mounts. A component-level ref
// would reset to [], but this module-level cache persists the integrations.
let lastKnownIntegrationsCache: any[] = []

interface SetupTabProps {
  nodeInfo: any
  initialData?: Record<string, any>
  initialDynamicOptions?: Record<string, any[]>
  onSave: (data: Record<string, any>) => void
  onCancel: () => void
  onBack?: () => void
  workflowData?: any
  currentNodeId?: string
  integrationName?: string
  isConnectedToAIAgent?: boolean
  isTemplateEditing?: boolean
  templateDefaults?: Record<string, any>
  isReopen?: boolean
  onAutoFillTestData?: (andTest?: boolean) => void
  isTestingNode?: boolean
}

/**
 * Setup Tab - Main configuration form with connection status
 *
 * Shows:
 * 1. ServiceConnectionSelector - Account/connection status for the integration
 * 2. ConfigurationForm - All field configuration
 */
export function SetupTab(props: SetupTabProps) {
  const { nodeInfo, integrationName, currentNodeId } = props
  const { integrations, fetchIntegrations, connectApiKeyIntegration, loadingStates } = useIntegrationStore()
  const { toast } = useToast()
  const [isConnecting, setIsConnecting] = useState(false)
  const [showApiKeyModal, setShowApiKeyModal] = useState(false)

  // Track if we've already requested integrations to avoid duplicate fetches
  const hasRequestedIntegrationsRef = useRef(false)
  const lastProviderKeyRef = useRef<string | null>(null)

  // CRITICAL FIX: Initialize the module-level cache on mount if it's empty
  // This ensures we populate the cache from the store on first render
  useEffect(() => {
    const storeIntegrations = useIntegrationStore.getState().integrations
    if (storeIntegrations.length > 0 && lastKnownIntegrationsCache.length === 0) {
      lastKnownIntegrationsCache = storeIntegrations
    }
  }, [])

  // Check if integrations are still loading from the store
  const isLoadingIntegrations = loadingStates?.['integrations'] ?? false

  // Ensure integrations are loaded when the component mounts
  // This prevents the "Not connected" flicker when clicking on a node
  // if the integration store hasn't been populated yet
  useEffect(() => {
    // CRITICAL FIX: Only use providerId for the key - switching between same-provider nodes
    // (e.g., Slack trigger A → Slack trigger B) doesn't require re-fetching integrations
    // since integrations are per-provider, not per-node. Including currentNodeId or nodeType
    // caused unnecessary re-fetches that triggered a race condition with modal lifecycle.
    const providerKey = nodeInfo?.providerId || null

    if (providerKey && lastProviderKeyRef.current !== providerKey) {
      hasRequestedIntegrationsRef.current = false
      lastProviderKeyRef.current = providerKey
    }

    if (nodeInfo?.providerId && !hasRequestedIntegrationsRef.current) {
      hasRequestedIntegrationsRef.current = true
      // Read current integrations from store directly to avoid dependency loop
      // Using getState() instead of the reactive 'integrations' variable prevents
      // this effect from re-running every time integrations update
      const currentIntegrations = useIntegrationStore.getState().integrations
      const providerIntegrations = currentIntegrations.filter(
        int => int.provider === nodeInfo.providerId
      )
      const shouldForce = currentIntegrations.length === 0 || providerIntegrations.length === 0
      // Force refresh if the store is empty to avoid stale "Not connected" state
      fetchIntegrations(shouldForce).catch(() => {
        // Silently ignore errors - the UI will show "Not connected" which is acceptable
      })
    }
  }, [nodeInfo?.providerId, fetchIntegrations])

  // Listen for reconnection events to refresh integration store
  React.useEffect(() => {
    const handleReconnectionEvent = async (event: CustomEvent) => {
      if (event.detail?.provider === nodeInfo?.providerId) {
        // Refresh integrations from the store
        await fetchIntegrations(true)
        // Clear connecting state
        setIsConnecting(false)
      }
    }

    window.addEventListener('integration-reconnected' as any, handleReconnectionEvent as any)
    return () => window.removeEventListener('integration-reconnected' as any, handleReconnectionEvent as any)
  }, [nodeInfo?.providerId, fetchIntegrations])


  // Determine if this node requires an integration connection
  const requiresConnection = useMemo(() => {
    if (!nodeInfo) return false
    if (isNodeTypeConnectionExempt(nodeInfo.type)) {
      return false
    }
    if (!nodeInfo.providerId) return false
    return !isProviderConnectionExempt(nodeInfo.providerId)
  }, [nodeInfo?.providerId, nodeInfo?.type])

  // Get ALL connections for this provider (not just one)
  const connections = useMemo(() => {
    if (!requiresConnection || !nodeInfo?.providerId) return []

    // CRITICAL FIX: Multi-level fallback for integration data
    // Level 1: Reactive integrations from Zustand hook
    // Level 2: Synchronous getState() from Zustand store
    // Level 3: Module-level cache (survives component remounts during node switching)
    const storeState = useIntegrationStore.getState()
    let effectiveIntegrations = integrations.length > 0
      ? integrations
      : storeState.integrations.length > 0
        ? storeState.integrations
        : lastKnownIntegrationsCache

    // Update the module-level cache with the latest valid integrations
    // This ensures we always have a fallback even if the store gets cleared
    if (integrations.length > 0) {
      lastKnownIntegrationsCache = integrations
    } else if (storeState.integrations.length > 0) {
      lastKnownIntegrationsCache = storeState.integrations
    }

    // Get all integrations that match this provider
    const providerIntegrations = effectiveIntegrations.filter(
      int => int.provider === nodeInfo.providerId
    )

    const isErrorStatus = (status?: string) => {
      if (!status) return false
      const normalized = status.toLowerCase()
      return (
        normalized === 'expired' ||
        normalized === 'needs_reauthorization' ||
        normalized === 'unauthorized' ||
        normalized === 'error'
      )
    }

    const isPendingStatus = (status?: string) => {
      if (!status) return false
      const normalized = status.toLowerCase()
      return normalized === 'pending' || normalized === 'refreshing'
    }

    // Map to Connection format
    return providerIntegrations.map(integration => {
      // Determine UI status based on integration status
      let uiStatus: 'connected' | 'disconnected' | 'error' | 'pending' = 'disconnected'

      if (isConnectedStatus(integration.status)) {
        uiStatus = 'connected'
      } else if (isPendingStatus(integration.status)) {
        uiStatus = 'pending'
      } else if (isErrorStatus(integration.status)) {
        // Token expired or needs reauth -> show as error so user can reconnect
        uiStatus = 'error'
      }

      const mappedConnection = {
        id: integration.id,
        provider: integration.provider,
        email: integration.email,
        username: integration.username,
        accountName: integration.account_name,
        avatar_url: integration.avatar_url,
        status: uiStatus,
        lastChecked: integration.last_checked ? new Date(integration.last_checked) : undefined,
        // Use disconnect_reason for error message, fallback to generic error
        error: integration.disconnect_reason || integration.error,
        workspace_type: integration.workspace_type,
        workspace_id: integration.workspace_id,
        created_at: integration.created_at,
      }

      return mappedConnection
    })
  }, [requiresConnection, nodeInfo?.providerId, integrations])

  // Get current/primary connection (first connected one)
  const connection = useMemo(() => {
    return connections.find(c => c.status === 'connected') || connections[0] || undefined
  }, [connections])

  // OAuth popup handler - Executes immediately without blocking on other operations
  const handleConnect = (isReconnect = false) => {
    if (!nodeInfo?.providerId) return

    // Check if this is an API Key integration
    const providerConfig = INTEGRATION_CONFIGS[nodeInfo.providerId]
    if (providerConfig?.authType === 'apiKey') {
      // For API key integrations, show the modal
      setShowApiKeyModal(true)
      setIsConnecting(false)
      return
    }

    // Immediately set connecting state
    setIsConnecting(true)

    // Execute OAuth flow asynchronously without blocking
    // This ensures the popup opens immediately, even if other parts of the form are loading
    Promise.resolve().then(async () => {
      try {
        // Generate OAuth URL
        const requestBody: any = { provider: nodeInfo.providerId }

        // For reconnections, include the reconnect flag and integration ID
        if (isReconnect && connection?.id) {
          requestBody.reconnect = true
          requestBody.integrationId = connection.id
        }

        const response = await fetch('/api/integrations/auth/generate-url', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(requestBody)
        })

        if (!response.ok) {
          throw new Error('Failed to generate OAuth URL')
        }

        const { authUrl } = await response.json()

        // Open OAuth popup immediately
        const width = 600
        const height = 700
        const left = window.screenX + (window.outerWidth - width) / 2
        const top = window.screenY + (window.outerHeight - height) / 2

        const popup = window.open(
          authUrl,
          'oauth',
          `width=${width},height=${height},left=${left},top=${top}`
        )

        // Cleanup function (defined early for use in handleMessage)
        let broadcastChannel: BroadcastChannel | null = null
        let hasHandledOAuthCompletion = false

        const cleanup = () => {
          window.removeEventListener('message', handleMessage)
          broadcastChannel?.close()
          setIsConnecting(false)
        }

        // Listen for OAuth completion via both postMessage and BroadcastChannel
        const handleMessage = async (event: MessageEvent) => {
          // Verify message is from our OAuth callback
          if (event.data?.type === 'oauth-complete') {
            if (hasHandledOAuthCompletion) {
              return
            }
            hasHandledOAuthCompletion = true
            cleanup()

            if (event.data.success) {
              // Refresh integrations to get the new connection
              // The UI will automatically update to show connected state
              await fetchIntegrations(true)
              // No success toast - the popup already showed beautiful visual feedback
              // and the UI state updates immediately to show the connection
            } else {
              // Only show error toast - helps user understand what went wrong
              toast({
                title: "Connection Failed",
                description: event.data.error || "Failed to connect account. Please try again.",
                variant: "destructive",
              })
            }

            popup?.close()
          }
        }

        window.addEventListener('message', handleMessage)

        // Also listen via BroadcastChannel (more reliable for same-origin)
        try {
          broadcastChannel = new BroadcastChannel('oauth_channel')
          broadcastChannel.onmessage = handleMessage
        } catch (e) {
          // BroadcastChannel not supported
        }

        // Check if popup was blocked
        if (!popup || popup.closed) {
          cleanup()
          toast({
            title: "Popup Blocked",
            description: "Please allow popups for this site and try again.",
            variant: "destructive",
          })
          return
        }

        // Handle popup closed without completion
        const checkClosed = setInterval(() => {
          if (popup?.closed) {
            clearInterval(checkClosed)
            const shouldRefresh = !hasHandledOAuthCompletion
            if (shouldRefresh) {
              hasHandledOAuthCompletion = true
            }
            cleanup()
            if (shouldRefresh) {
              fetchIntegrations(true)
            }
          }
        }, 500)

      } catch (error: any) {
        toast({
          title: "Connection Error",
          description: error.message || "Failed to initiate OAuth flow.",
          variant: "destructive",
        })
        setIsConnecting(false)
      }
    })
  }

  const handleReconnect = () => {
    // Use same OAuth flow for reconnection, but pass reconnect flag
    handleConnect(true)
  }

  const handleChangeAccount = (connectionId: string) => {
    // Update the selected connection
    // This will be handled by ServiceConnectionSelector
  }

  const handleDeleteConnection = async (connectionId: string) => {
    // PR-AUTH-5: cached token; missing → server returns 401, surfaced via the
    // existing !response.ok / !data.success branch below.
    const { getAuthHeader } = await import('@/lib/auth/getAuthHeader')

    // Call DELETE API
    const response = await fetch(`/api/integrations/${connectionId}`, {
      method: 'DELETE',
      headers: {
        ...(await getAuthHeader()),
      },
    })

    const data = await response.json()

    if (!response.ok || !data.success) {
      toast({
        title: "Delete Failed",
        description: data.error || "Failed to remove account. Please try again.",
        variant: "destructive",
      })
      throw new Error(data.error || 'Failed to delete connection')
    }

    // Refresh integrations to update UI
    await fetchIntegrations(true)

    toast({
      title: "Account Removed",
      description: "The account has been disconnected and all permissions have been revoked.",
    })
  }

  // Get provider display name with proper branding
  const providerName = nodeInfo?.providerId
    ? getProviderBrandName(nodeInfo.providerId)
    : (integrationName || nodeInfo?.category || 'Service')

  // Check if connection has an error
  const hasConnectionError = requiresConnection && connection?.status === 'error'

  // Determine which API Key guide to show
  const ApiKeyGuideComponent = nodeInfo?.providerId === 'manychat'
    ? ManyChatGuide
    : nodeInfo?.providerId === 'beehiiv'
    ? BeehiivGuide
    : null

  // Show loading state when integrations are being fetched for a provider with no cached connections
  // This prevents flash of "Not connected" during workspace switches AND when changing providers
  if (requiresConnection && isLoadingIntegrations && connections.length === 0) {
    return (
      <div className="flex flex-col h-full">
        <div className="px-6 pt-6 pb-4 border-b border-border">
          <div className="flex items-center gap-3 p-4 rounded-lg bg-muted/50">
            <div className="animate-spin rounded-full h-5 w-5 border-2 border-primary border-t-transparent"></div>
            <span className="text-sm text-muted-foreground">Loading {providerName} connections...</span>
          </div>
        </div>
        <div className="flex-1 overflow-hidden p-6">
          <div className="animate-pulse space-y-4">
            <div className="h-10 bg-muted rounded"></div>
            <div className="h-10 bg-muted rounded"></div>
          </div>
        </div>
      </div>
    )
  }

  return (
    <>
      <div className="flex flex-col h-full">
        {/* Connection Status Section */}
        {requiresConnection && nodeInfo?.providerId && (
          <div className="px-6 pt-6 pb-4 border-b border-border">
            <ServiceConnectionSelector
              providerId={nodeInfo.providerId}
              providerName={providerName}
              connections={connections}
              selectedConnection={connection}
              onConnect={handleConnect}
              onReconnect={handleReconnect}
              onSelectConnection={handleChangeAccount}
              onDeleteConnection={handleDeleteConnection}
              isLoading={isConnecting || isLoadingIntegrations}
              autoFetch={false}
            />
          </div>
        )}

        {/* Configuration Form or Error Blocker */}
        <div className="flex-1 overflow-hidden">
          {hasConnectionError ? (
            <div className="flex items-center justify-center h-full p-6">
              <div className="text-center max-w-md space-y-3">
                <AlertCircle className="w-12 h-12 mx-auto text-red-500" />
                <h3 className="text-lg font-semibold text-foreground">Connection Required</h3>
                <p className="text-sm text-muted-foreground">
                  Please reconnect your {providerName} account above to configure this action.
                  Your account connection has expired or encountered an error.
                </p>
              </div>
            </div>
          ) : (
            <ConfigurationForm {...props} />
          )}
        </div>
      </div>

      {/* API Key Connection Modal */}
      {ApiKeyGuideComponent && (
        <ApiKeyGuideComponent
          open={showApiKeyModal}
          onOpenChange={setShowApiKeyModal}
          onConnect={async (apiKey: string) => {
            try {
              await connectApiKeyIntegration(nodeInfo.providerId, apiKey)
              setShowApiKeyModal(false)
              // Refresh integrations to show the new connection
              await fetchIntegrations(true)
              toast({
                title: "Connected Successfully",
                description: `Your ${providerName} account has been connected.`,
              })
            } catch (error: any) {
              // Error is already handled by the guide component
              throw error
            }
          }}
        />
      )}
    </>
  )
}

