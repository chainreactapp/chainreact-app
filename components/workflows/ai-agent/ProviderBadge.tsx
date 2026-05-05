import React, { useState, useRef, useEffect, useMemo, useCallback } from 'react'
import { Button } from '@/components/ui/button'
import { ChevronDown, Check, ArrowRight, AlertCircle, Loader2 } from 'lucide-react'
import type { ProviderOption } from '@/lib/workflows/ai-agent/providerDisambiguation'
import { useIntegrationStore } from '@/stores/integrationStore'
import { isConnectedStatus } from '@/lib/integrations/connectionStatus'

/**
 * Maps provider IDs to their actual icon filenames
 */
function getProviderIconPath(providerId: string): string {
  const iconMap: Record<string, string> = {
    'outlook': 'microsoft-outlook',
    'yahoo-mail': 'yahoo-mail',
  }
  return `/integrations/${iconMap[providerId] || providerId}.svg`
}

type ConnectionState = 'idle' | 'connecting' | 'just_connected'

/** Timeout (ms) to reset connecting state if OAuth never completes */
const CONNECTING_TIMEOUT_MS = 30_000
/** Duration (ms) to show "Connected!" success state */
const SUCCESS_DISPLAY_MS = 1_500

interface ProviderBadgeProps {
  categoryName: string // "Email", "Calendar"
  selectedProvider: ProviderOption
  allProviders: ProviderOption[]
  onProviderChange: (providerId: string) => void
  onConnect: (providerId: string) => void
  /** If true, forces the selected provider to show as disconnected even if store shows connected */
  forceExpired?: boolean
  /** If true, shows a loading state while validating the connection */
  isValidating?: boolean
}

export function ProviderBadge({
  categoryName,
  selectedProvider,
  allProviders,
  onProviderChange,
  onConnect,
  forceExpired = false,
  isValidating = false
}: ProviderBadgeProps) {
  const [showDropdown, setShowDropdown] = useState(false)
  const dropdownRef = useRef<HTMLDivElement>(null)
  const [, forceUpdate] = useState({})

  // Local transient connection state - store data remains source of truth
  const [connectionState, setConnectionState] = useState<ConnectionState>('idle')
  const connectingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const successTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Get live integration status from the store
  const { integrations, fetchIntegrations, getIntegrationByProvider } = useIntegrationStore()

  // Clean up all timers on unmount
  useEffect(() => {
    return () => {
      if (connectingTimeoutRef.current) clearTimeout(connectingTimeoutRef.current)
      if (successTimeoutRef.current) clearTimeout(successTimeoutRef.current)
    }
  }, [])

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setShowDropdown(false)
      }
    }

    if (showDropdown) {
      document.addEventListener('mousedown', handleClickOutside)
      return () => document.removeEventListener('mousedown', handleClickOutside)
    }
  }, [showDropdown])

  // Fetch integrations on mount to ensure we have latest status
  useEffect(() => {
    fetchIntegrations(true)
  }, [fetchIntegrations])

  // Listen for integration connected events to update status in real-time
  useEffect(() => {
    const handleIntegrationConnected = async (event: CustomEvent) => {
      // Force refresh integrations to get latest status
      await fetchIntegrations(true)
      // Force re-render to pick up new status
      forceUpdate({})

      // If this provider just connected, show success feedback
      const detail = event.detail
      const connectedId = detail?.providerId || detail?.provider
      if (connectedId === selectedProvider.id || !connectedId) {
        // Clear connecting timeout
        if (connectingTimeoutRef.current) {
          clearTimeout(connectingTimeoutRef.current)
          connectingTimeoutRef.current = null
        }

        setConnectionState('just_connected')
        successTimeoutRef.current = setTimeout(() => {
          setConnectionState('idle')
          successTimeoutRef.current = null
        }, SUCCESS_DISPLAY_MS)
      }
    }

    window.addEventListener('integration-connected', handleIntegrationConnected as unknown as EventListener)
    return () => {
      window.removeEventListener('integration-connected', handleIntegrationConnected as unknown as EventListener)
    }
  }, [fetchIntegrations, selectedProvider.id])

  // Compute live connection status for all providers
  const providersWithLiveStatus = useMemo(() => {
    return allProviders.map(provider => {
      const integration = getIntegrationByProvider(provider.id)
      return {
        ...provider,
        isConnected: isConnectedStatus(integration?.status)
      }
    })
  }, [allProviders, integrations, getIntegrationByProvider])

  // Get the live selected provider status
  const liveSelectedProvider = providersWithLiveStatus.find(p => p.id === selectedProvider.id) || {
    ...selectedProvider,
    isConnected: isConnectedStatus(getIntegrationByProvider(selectedProvider.id)?.status)
  }

  const otherProviders = providersWithLiveStatus.filter(p => p.id !== selectedProvider.id)

  // If forceExpired is true, treat as disconnected even if store shows connected
  const isDisconnected = forceExpired || !liveSelectedProvider.isConnected

  // Handle connect/reconnect click with local state tracking
  const handleConnectClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation()
    setConnectionState('connecting')

    // Set timeout to reset if OAuth never completes
    connectingTimeoutRef.current = setTimeout(() => {
      setConnectionState('idle')
      connectingTimeoutRef.current = null
    }, CONNECTING_TIMEOUT_MS)

    try {
      onConnect(selectedProvider.id)
    } catch {
      // Reset on sync error - async errors handled by WorkflowBuilderV2
      setConnectionState('idle')
      if (connectingTimeoutRef.current) {
        clearTimeout(connectingTimeoutRef.current)
        connectingTimeoutRef.current = null
      }
    }
  }, [onConnect, selectedProvider.id])

  // Determine what CTA text to show
  const isExpired = forceExpired
  const ctaVerb = isExpired ? 'Reconnect' : 'Connect'

  // Show loading state while validating
  if (isValidating) {
    return (
      <div className="relative inline-block w-full" ref={dropdownRef}>
        <div className="w-full flex items-center gap-3 px-4 py-3 bg-muted/50 border-2 border-border rounded-lg shadow-sm">
          <img
            src={getProviderIconPath(selectedProvider.id)}
            alt={selectedProvider.displayName}
            width={28}
            height={28}
            className="shrink-0 opacity-50"
          />
          <div className="flex-1 min-w-0">
            <div className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">{categoryName} Provider</div>
            <div className="font-semibold text-sm text-foreground">{selectedProvider.displayName}</div>
          </div>
          <div className="flex items-center gap-2 text-muted-foreground shrink-0">
            <Loader2 className="w-4 h-4 animate-spin" />
            <span className="text-xs font-medium">Checking...</span>
          </div>
        </div>
      </div>
    )
  }

  // Show connecting state
  if (connectionState === 'connecting' && isDisconnected) {
    return (
      <div className="relative inline-block w-full" ref={dropdownRef}>
        <div className="w-full bg-blue-50 dark:bg-blue-900/20 border-2 border-blue-300 dark:border-blue-700 rounded-lg shadow-sm overflow-hidden">
          <div className="flex items-center gap-3 px-4 py-3">
            <img
              src={getProviderIconPath(selectedProvider.id)}
              alt={selectedProvider.displayName}
              width={28}
              height={28}
              className="shrink-0"
            />
            <div className="flex-1 min-w-0">
              <div className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">{categoryName} Provider</div>
              <div className="font-semibold text-sm text-foreground">{selectedProvider.displayName}</div>
            </div>
            <div className="flex items-center gap-2 text-blue-600 dark:text-blue-400 shrink-0">
              <Loader2 className="w-4 h-4 animate-spin" />
              <span className="text-xs font-medium">Connecting...</span>
            </div>
          </div>
        </div>
      </div>
    )
  }

  // Show just-connected success state
  if (connectionState === 'just_connected') {
    return (
      <div className="relative inline-block w-full" ref={dropdownRef}>
        <div className="w-full bg-green-50 dark:bg-green-900/20 border-2 border-green-300 dark:border-green-700 rounded-lg shadow-sm overflow-hidden">
          <div className="flex items-center gap-3 px-4 py-3">
            <img
              src={getProviderIconPath(selectedProvider.id)}
              alt={selectedProvider.displayName}
              width={28}
              height={28}
              className="shrink-0"
            />
            <div className="flex-1 min-w-0">
              <div className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">{categoryName} Provider</div>
              <div className="font-semibold text-sm text-foreground">{selectedProvider.displayName}</div>
            </div>
            <div className="flex items-center gap-2 text-green-600 dark:text-green-400 shrink-0">
              <Check className="w-4 h-4" strokeWidth={2.5} />
              <span className="text-xs font-semibold">Connected!</span>
            </div>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="relative inline-block w-full" ref={dropdownRef}>
      {/* Main badge - different layout for connected vs disconnected */}
      {isDisconnected ? (
        // Disconnected/expired state: Two-row layout with prominent Connect/Reconnect CTA
        <div className="w-full bg-amber-50 dark:bg-amber-900/20 border-2 border-amber-300 dark:border-amber-700 rounded-lg shadow-sm overflow-hidden">
          {/* Top row: Provider info + change button */}
          <div
            className="flex items-center gap-3 px-4 py-2.5 cursor-pointer hover:bg-amber-100/50 dark:hover:bg-amber-900/30 transition-colors"
            onClick={() => setShowDropdown(!showDropdown)}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault()
                setShowDropdown(!showDropdown)
              }
            }}
          >
            <img
              src={getProviderIconPath(selectedProvider.id)}
              alt={selectedProvider.displayName}
              width={24}
              height={24}
              className="shrink-0 opacity-70"
            />
            <div className="flex-1 min-w-0">
              <div className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">{categoryName} Provider</div>
              <div className="font-semibold text-sm text-foreground">{selectedProvider.displayName}</div>
              {isExpired && (
                <div className="text-[10px] font-medium text-amber-600 dark:text-amber-400">Connection expired</div>
              )}
            </div>
            <div className="flex items-center gap-1 text-muted-foreground hover:text-foreground transition-colors shrink-0">
              <span className="text-xs font-medium">Change</span>
              <ChevronDown className={`w-3.5 h-3.5 transition-transform ${showDropdown ? 'rotate-180' : ''}`} />
            </div>
          </div>
          {/* Bottom row: Connect/Reconnect CTA */}
          <div className="px-4 py-2.5 bg-amber-100/50 dark:bg-amber-900/30 border-t border-amber-200 dark:border-amber-800">
            <Button
              size="sm"
              onClick={handleConnectClick}
              className="w-full h-8 text-sm font-medium"
            >
              {ctaVerb} {selectedProvider.displayName}
            </Button>
          </div>
        </div>
      ) : (
        // Connected state: Single row layout
        <div
          className="group w-full flex items-center gap-3 px-4 py-3 bg-primary/5 hover:bg-primary/10 border-2 border-primary/20 hover:border-primary/30 rounded-lg transition-all duration-200 shadow-sm hover:shadow-md cursor-pointer"
          onClick={() => setShowDropdown(!showDropdown)}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault()
              setShowDropdown(!showDropdown)
            }
          }}
        >
          <img
            src={getProviderIconPath(selectedProvider.id)}
            alt={selectedProvider.displayName}
            width={28}
            height={28}
            className="shrink-0"
          />
          <div className="flex-1 text-left min-w-0">
            <div className="text-xs font-medium text-muted-foreground uppercase tracking-wide">{categoryName} Provider</div>
            <div className="font-semibold text-sm text-foreground">{selectedProvider.displayName}</div>
          </div>
          <div className="flex items-center gap-1.5 text-muted-foreground hover:text-foreground transition-colors shrink-0">
            <span className="text-xs font-medium uppercase tracking-wide">Change</span>
            <ChevronDown className={`w-4 h-4 transition-transform ${showDropdown ? 'rotate-180' : ''}`} />
          </div>
        </div>
      )}

      {/* Dropdown */}
      {showDropdown && (
        <div className="absolute top-full left-0 mt-2 w-full bg-popover border-2 border-border rounded-lg shadow-xl z-50 p-3">
          <div className="space-y-2">
            {/* Connected providers section */}
            {otherProviders.filter(p => p.isConnected).length > 0 && (
              <div className="space-y-2">
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide px-2">Connected</p>
                {/* Current selection */}
                <button
                  className="w-full group relative px-3 py-2.5 bg-primary/10 hover:bg-primary/15 rounded-lg flex items-center gap-3 text-left border border-primary/20 transition-colors"
                  onClick={() => setShowDropdown(false)}
                >
                  <img
                    src={getProviderIconPath(selectedProvider.id)}
                    alt={selectedProvider.displayName}
                    width={22}
                    height={22}
                    className="shrink-0"
                  />
                  <span className="text-sm font-semibold flex-1">{selectedProvider.displayName}</span>
                  <Check className="w-4 h-4 text-primary" strokeWidth={2.5} />
                </button>

                {/* Other connected providers */}
                {otherProviders.filter(p => p.isConnected).map(provider => (
                  <button
                    key={provider.id}
                    className="w-full group px-3 py-2.5 hover:bg-muted rounded-lg flex items-center gap-3 text-left transition-colors"
                    onClick={() => {
                      onProviderChange(provider.id)
                      setShowDropdown(false)
                    }}
                  >
                    <img
                      src={getProviderIconPath(provider.id)}
                      alt={provider.displayName}
                      width={22}
                      height={22}
                      className="shrink-0"
                    />
                    <span className="text-sm font-medium flex-1">{provider.displayName}</span>
                    <Check className="w-3.5 h-3.5 text-green-600 dark:text-green-400" strokeWidth={2.5} />
                  </button>
                ))}
              </div>
            )}

            {/* Divider if there are unconnected providers */}
            {otherProviders.some(p => !p.isConnected) && otherProviders.some(p => p.isConnected) && (
              <div className="border-t border-border my-2" />
            )}

            {/* Unconnected providers */}
            {otherProviders.filter(p => !p.isConnected).length > 0 && (
              <div className="space-y-2">
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide px-2">Available</p>
                {otherProviders.filter(p => !p.isConnected).map(provider => (
                  <button
                    key={provider.id}
                    className="w-full group px-3 py-2.5 hover:bg-muted/50 rounded-lg flex items-center gap-3 text-left border border-dashed border-border hover:border-primary transition-all"
                    onClick={() => {
                      // Change provider first, then user can connect via the badge's Connect button
                      onProviderChange(provider.id)
                      setShowDropdown(false)
                    }}
                  >
                    <img
                      src={getProviderIconPath(provider.id)}
                      alt={provider.displayName}
                      width={22}
                      height={22}
                      className="shrink-0 opacity-60 group-hover:opacity-100 transition-opacity"
                    />
                    <span className="text-sm font-medium flex-1">{provider.displayName}</span>
                    <div className="flex items-center gap-1.5 text-primary">
                      <span className="text-xs font-semibold uppercase tracking-wide">Connect</span>
                      <ArrowRight className="w-3.5 h-3.5" />
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
