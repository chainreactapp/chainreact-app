"use client"

/**
 * ServiceConnectionSelector Component
 *
 * Professional service/account connection selector with:
 * - Combobox dropdown with rich connection details
 * - Connection status indicator
 * - Account details (email/username)
 * - Workspace type badges (Personal/Team/Organization)
 * - Provider branding
 * - Quick actions (Connect, Add Another Account)
 * - Connection health monitoring
 */

import React, { useState, useEffect, useCallback } from 'react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { StaticIntegrationLogo } from '@/components/ui/static-integration-logo'
import { Combobox, ComboboxOption } from '@/components/ui/combobox'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { CheckCircle, AlertCircle, RefreshCw, ExternalLink, Plus, Users, Building2, User, X, Share2, UserCheck, UsersIcon } from 'lucide-react'
import { cn } from '@/lib/utils'
import { fetchWithTimeout } from '@/lib/utils/fetch-with-timeout'
import { logger } from '@/lib/utils/logger'
import { getAuthHeader } from '@/lib/auth/getAuthHeader'
import { isConnectedStatus } from "@/lib/integrations/connectionStatus"

interface Connection {
  id: string
  provider: string
  email?: string
  username?: string
  accountName?: string
  account_name?: string
  avatar_url?: string
  status: 'connected' | 'disconnected' | 'error' | 'refreshing' | 'pending'
  lastChecked?: Date
  error?: string
  workspace_type?: 'personal' | 'team' | 'organization'
  workspace_id?: string | null
  user_permission?: 'use' | 'manage' | 'admin'
  created_at?: string
  expires_at?: string | null
  // Sharing-related fields (from all-connections API)
  is_owner?: boolean
  is_shared?: boolean
  access_type?: 'owned' | 'shared_direct' | 'shared_team' | 'shared_org' | 'workspace'
  sharing_scope?: 'private' | 'team' | 'organization'
  connected_by?: string
}

interface ServiceConnectionSelectorProps {
  /** Integration/provider ID (e.g., 'gmail', 'slack') */
  providerId: string
  /** Human-readable provider name */
  providerName: string
  /** All available connections for this provider */
  connections?: Connection[]
  /** Currently selected connection */
  selectedConnection?: Connection
  /** Callback when user selects a different connection */
  onSelectConnection?: (connectionId: string) => void
  /** Callback when user wants to connect new account */
  onConnect?: () => void
  /** Callback when user wants to reconnect */
  onReconnect?: () => void
  /** Callback when user wants to delete a connection */
  onDeleteConnection?: (connectionId: string) => void
  /** Whether the component is in a loading state */
  isLoading?: boolean
  /** Custom className */
  className?: string
  /** Auto-fetch all connections for this provider */
  autoFetch?: boolean
}

export function ServiceConnectionSelector({
  providerId,
  providerName,
  connections: propConnections,
  selectedConnection: propSelectedConnection,
  onSelectConnection,
  onConnect,
  onReconnect,
  onDeleteConnection,
  isLoading = false,
  className,
  autoFetch = true,
}: ServiceConnectionSelectorProps) {
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [fetchedConnections, setFetchedConnections] = useState<Connection[]>([])
  const [isFetching, setIsFetching] = useState(false)
  const [fetchError, setFetchError] = useState<string | null>(null)
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false)
  const [connectionToDelete, setConnectionToDelete] = useState<Connection | null>(null)
  const [deletedConnectionIds, setDeletedConnectionIds] = useState<Set<string>>(new Set())

  // Use prop connections if provided, otherwise use fetched connections
  // Filter out optimistically deleted connections
  const allConnections = propConnections || fetchedConnections
  const connections = allConnections.filter(conn => !deletedConnectionIds.has(conn.id))
  const selectedConnection = propSelectedConnection || (connections.length > 0 ? connections[0] : undefined)

  // Memoized fetch function to prevent infinite loops
  const fetchAllConnections = useCallback(async () => {
    setIsFetching(true)
    setFetchError(null)

    try {
      logger.info('[ServiceConnectionSelector] Fetching all connections', { providerId })

      // PR-AUTH-5: cached token; missing → server returns 401, handled below.
      const response = await fetchWithTimeout(
        `/api/integrations/all-connections?provider=${encodeURIComponent(providerId)}`,
        {
          headers: {
            'Content-Type': 'application/json',
            ...(await getAuthHeader()),
          },
        },
        8000
      )

      if (!response.ok) {
        throw new Error(`Failed to fetch connections: ${response.statusText}`)
      }

      const data = await response.json()
      const fetchedConns = data.connections || []

      logger.info('[ServiceConnectionSelector] Fetched connections', {
        providerId,
        count: fetchedConns.length
      })

      setFetchedConnections(fetchedConns)
    } catch (error: any) {
      logger.error('[ServiceConnectionSelector] Error fetching connections', {
        error: error.message,
        providerId
      })
      setFetchError(error.message)
    } finally {
      setIsFetching(false)
    }
  }, [providerId])

  // Fetch all connections for this provider on mount
  useEffect(() => {
    if (autoFetch && !propConnections && providerId) {
      fetchAllConnections()
    }
  }, [providerId, autoFetch, propConnections, fetchAllConnections])

  const connection = selectedConnection
  const hasMultipleConnections = connections.length > 1
  const connectedConnections = connections.filter(c => isConnectedStatus(c.status))
  const hasConnectedAccounts = connectedConnections.length > 0

  const isConnected = connection?.status === 'connected'
  const hasError = connection?.status === 'error' || connection?.status === 'disconnected'
  const needsReconnection = connection && (connection.status === 'error' || connection.status === 'disconnected')
  const isDisconnected = !connection || connections.length === 0

  const handleRefresh = async () => {
    if (!onReconnect) return
    setIsRefreshing(true)
    try {
      await onReconnect()
      // Note: We don't set isRefreshing = false here
      // The window focus and reconnection event listeners will handle refreshing
      // and clearing the spinner after the OAuth completes
    } catch (error: any) {
      logger.error('[ServiceConnectionSelector] Reconnection failed', { error: error.message })
      setIsRefreshing(false)
    }
  }


  // Listen for integration reconnection events
  useEffect(() => {
    const handleReconnectionEvent = async (event: CustomEvent) => {
      logger.info('[ServiceConnectionSelector] Reconnection event received', {
        eventProvider: event.detail?.provider,
        componentProviderId: providerId,
        matches: event.detail?.provider === providerId,
        isCurrentlyRefreshing: isRefreshing
      })

      if (event.detail?.provider === providerId) {
        logger.info('[ServiceConnectionSelector] Provider matches, refreshing connections')
        try {
          await fetchAllConnections()
          logger.info('[ServiceConnectionSelector] Connections refreshed successfully')
        } catch (error: any) {
          logger.error('[ServiceConnectionSelector] Failed to refresh connections', { error: error.message })
        } finally {
          // Always clear spinner, even if fetch fails
          setIsRefreshing(false)
          logger.info('[ServiceConnectionSelector] Cleared refreshing state')
        }
      }
    }

    window.addEventListener('integration-reconnected' as any, handleReconnectionEvent as any)
    return () => window.removeEventListener('integration-reconnected' as any, handleReconnectionEvent as any)
  }, [providerId, fetchAllConnections, isRefreshing])

  // Get account display text
  const getAccountDisplay = (conn?: Connection) => {
    if (!conn) return null
    return conn.email || conn.username || conn.accountName || conn.account_name || 'Connected Account'
  }

  // Get workspace type icon
  const getWorkspaceIcon = (workspaceType?: string) => {
    switch (workspaceType) {
      case 'personal':
        return <User className="w-3.5 h-3.5" />
      case 'team':
        return <Users className="w-3.5 h-3.5" />
      case 'organization':
        return <Building2 className="w-3.5 h-3.5" />
      default:
        return <User className="w-3.5 h-3.5" />
    }
  }

  // Get workspace type label
  const getWorkspaceLabel = (workspaceType?: string) => {
    switch (workspaceType) {
      case 'personal':
        return 'Personal'
      case 'team':
        return 'Team'
      case 'organization':
        return 'Organization'
      default:
        return 'Personal'
    }
  }

  // Get status badge color
  const getStatusBadgeClass = (status?: string) => {
    switch (status) {
      case 'connected':
        return 'bg-green-50 text-green-700 border-green-200 dark:bg-green-950/50 dark:text-green-400 dark:border-green-800/50'
      case 'error':
      case 'disconnected':
        return 'bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950/50 dark:text-amber-400 dark:border-amber-800/50'
      case 'pending':
        return 'bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-950/50 dark:text-blue-400 dark:border-blue-800/50'
      default:
        return 'bg-gray-50 text-gray-700 border-gray-200 dark:bg-gray-950/50 dark:text-gray-400 dark:border-gray-800/50'
    }
  }

  // Get initials from account name or email
  const getInitials = (conn: Connection): string => {
    const display = getAccountDisplay(conn)
    if (!display) return '?'

    // If it's an email, get first letter of username
    if (display.includes('@')) {
      return display.charAt(0).toUpperCase()
    }

    // If it's a name, get first letters of first and last name
    const parts = display.split(' ')
    if (parts.length >= 2) {
      return (parts[0].charAt(0) + parts[1].charAt(0)).toUpperCase()
    }

    return display.charAt(0).toUpperCase()
  }

  // Generate consistent color for each account based on email
  const getAvatarColor = (conn: Connection): string => {
    const display = getAccountDisplay(conn) || ''
    const colors = [
      'bg-blue-100 text-blue-700 dark:bg-blue-950/50 dark:text-blue-300',
      'bg-purple-100 text-purple-700 dark:bg-purple-950/50 dark:text-purple-300',
      'bg-pink-100 text-pink-700 dark:bg-pink-950/50 dark:text-pink-300',
      'bg-green-100 text-green-700 dark:bg-green-950/50 dark:text-green-300',
      'bg-orange-100 text-orange-700 dark:bg-orange-950/50 dark:text-orange-300',
      'bg-cyan-100 text-cyan-700 dark:bg-cyan-950/50 dark:text-cyan-300',
      'bg-rose-100 text-rose-700 dark:bg-rose-950/50 dark:text-rose-300',
      'bg-indigo-100 text-indigo-700 dark:bg-indigo-950/50 dark:text-indigo-300',
    ]

    // Simple hash function to consistently assign colors
    let hash = 0
    for (let i = 0; i < display.length; i++) {
      hash = display.charCodeAt(i) + ((hash << 5) - hash)
    }

    return colors[Math.abs(hash) % colors.length]
  }

  // Get sharing badge info
  const getSharingBadgeInfo = (conn: Connection): { icon: React.ReactNode; label: string; className: string } | null => {
    // Only show for shared connections (not owned by current user)
    if (conn.is_owner || !conn.is_shared) {
      return null
    }

    switch (conn.access_type) {
      case 'shared_direct':
        return {
          icon: <UserCheck className="w-3 h-3" />,
          label: 'Shared',
          className: 'bg-violet-50 text-violet-700 border-violet-200 dark:bg-violet-950/50 dark:text-violet-400 dark:border-violet-800/50'
        }
      case 'shared_team':
        return {
          icon: <UsersIcon className="w-3 h-3" />,
          label: 'Team',
          className: 'bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-950/50 dark:text-blue-400 dark:border-blue-800/50'
        }
      case 'shared_org':
        return {
          icon: <Building2 className="w-3 h-3" />,
          label: 'Org',
          className: 'bg-indigo-50 text-indigo-700 border-indigo-200 dark:bg-indigo-950/50 dark:text-indigo-400 dark:border-indigo-800/50'
        }
      default:
        return null
    }
  }

  // Handle delete confirmation
  const handleDeleteClick = (conn: Connection, e: React.MouseEvent) => {
    e.stopPropagation() // Prevent option selection
    setConnectionToDelete(conn)
    setDeleteDialogOpen(true)
  }

  const handleConfirmDelete = async () => {
    if (!connectionToDelete || !onDeleteConnection) return

    const connectionId = connectionToDelete.id

    // Optimistic update: Immediately remove from UI
    setDeletedConnectionIds(prev => new Set([...prev, connectionId]))
    setDeleteDialogOpen(false)
    setConnectionToDelete(null)

    try {
      // Call the delete handler (runs in background)
      await onDeleteConnection(connectionId)

      logger.info('[ServiceConnectionSelector] Account deleted successfully', {
        connectionId,
        provider: providerId
      })

      // Optionally re-fetch connections after deletion to sync
      if (autoFetch && !propConnections) {
        setTimeout(() => fetchAllConnections(), 500)
      }
    } catch (error: any) {
      // On error, restore the connection in UI
      logger.error('[ServiceConnectionSelector] Failed to delete account', {
        error: error.message,
        connectionId
      })

      setDeletedConnectionIds(prev => {
        const newSet = new Set(prev)
        newSet.delete(connectionId)
        return newSet
      })

      setFetchError(`Failed to delete account: ${error.message}`)
    }
  }

  // Format options for Combobox (without delete button to avoid nested button issue)
  const comboboxOptions: ComboboxOption[] = connections.map((conn) => {
    return {
    value: conn.id,
    label: (
      <div className="flex items-center gap-2 py-1 w-full">
        {/* Profile Picture / Initials */}
        {conn.avatar_url ? (
          <img
            src={conn.avatar_url}
            alt={getAccountDisplay(conn) || 'Account avatar'}
            className="w-5 h-5 rounded flex-shrink-0 object-cover"
            onError={(e) => {
              // Fallback to initials if image fails to load
              const target = e.target as HTMLImageElement
              target.style.display = 'none'
              if (target.nextSibling) {
                (target.nextSibling as HTMLElement).style.display = 'flex'
              }
            }}
          />
        ) : null}
        <div className={cn(
          "w-5 h-5 rounded flex items-center justify-center text-[9px] font-semibold flex-shrink-0",
          getAvatarColor(conn),
          conn.avatar_url && "hidden"
        )}>
          {getInitials(conn)}
        </div>

        <span className="font-medium text-sm truncate flex-1">
          {getAccountDisplay(conn)}
        </span>

        {/* Sharing Badge - Show if connection is shared with user */}
        {(() => {
          const sharingBadge = getSharingBadgeInfo(conn)
          if (sharingBadge) {
            return (
              <Badge
                variant="outline"
                className={cn(
                  "text-[9px] h-4 px-1.5 font-medium border flex-shrink-0 flex items-center gap-0.5",
                  sharingBadge.className
                )}
              >
                {sharingBadge.icon}
                <span>{sharingBadge.label}</span>
              </Badge>
            )
          }
          return null
        })()}

        {/* Workspace Type - Icon + Text (Minimal) - Only show for owned connections */}
        {(conn.is_owner || !conn.is_shared) && (
          <div className="flex items-center gap-1 text-muted-foreground/70 flex-shrink-0">
            {getWorkspaceIcon(conn.workspace_type)}
            <span className="text-[10px] font-medium">
              {getWorkspaceLabel(conn.workspace_type)}
            </span>
          </div>
        )}

        {conn.status !== 'connected' && (
          <Badge
            variant="outline"
            className={cn(
              "text-[9px] h-4 px-1.5 font-medium border flex-shrink-0",
              getStatusBadgeClass(conn.status)
            )}
          >
            {conn.status === 'error' ? 'Disconnected' :
             conn.status === 'pending' ? 'Pending' : 'Disconnected'}
          </Badge>
        )}

        {/* Delete button inside dropdown option - Only show for owned connections */}
        {onDeleteConnection && (conn.is_owner !== false) && (
          <div
            onClick={(e) => {
              e.preventDefault()
              e.stopPropagation()
              handleDeleteClick(conn, e)
            }}
            className="flex-shrink-0 w-4 h-4 flex items-center justify-center rounded hover:bg-destructive/10 hover:text-destructive transition-colors cursor-pointer"
            title="Remove this account"
            role="button"
            tabIndex={0}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault()
                e.stopPropagation()
                handleDeleteClick(conn, e as any)
              }
            }}
          >
            <X className="w-3 h-3" />
          </div>
        )}
      </div>
    ),
    searchValue: `${getAccountDisplay(conn)} ${getWorkspaceLabel(conn.workspace_type)} ${conn.status} ${conn.is_shared ? 'shared' : 'owned'} ${conn.access_type || ''}`
    }
  })

  return (
    <div className={cn("space-y-2", className)}>
      {/* Unified State - Show account selector for all states except no connections */}
      {!isDisconnected && (
        <div className="space-y-2">
          {/* Integration Label */}
          <div className="flex items-center gap-2">
            <StaticIntegrationLogo
              providerId={providerId}
              providerName={providerName}
              className="w-5 h-5 flex-shrink-0"
            />
            <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
              {providerName} Account
            </span>
          </div>

          {/* Account Selector + Actions */}
          <div className="flex items-center gap-2">
            <div className="flex-1 min-w-0">
              <Combobox
                value={connection?.id || ''}
                onChange={(value) => onSelectConnection?.(value)}
                options={comboboxOptions}
                placeholder="Select account..."
                disabled={isFetching || connections.length === 0}
                loading={isFetching}
                disableSearch={connections.length <= 5}
                hideClearButton={true}
              />
            </div>

            {/* Smart button: Reconnect if selected account needs it, otherwise Refresh */}
            {onReconnect && (
              <Button
                variant={needsReconnection ? "default" : "outline"}
                size="sm"
                onClick={handleRefresh}
                disabled={isRefreshing}
                className={cn(
                  "flex-shrink-0 h-9 px-3 gap-1.5",
                  needsReconnection && "bg-amber-600 hover:bg-amber-700 dark:bg-amber-600 dark:hover:bg-amber-700"
                )}
                title={needsReconnection ? "Reconnect this account" : "Refresh connection"}
              >
                {isRefreshing ? (
                  <>
                    <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                    <span className="text-xs font-medium">
                      {needsReconnection ? "Reconnecting" : "Refreshing"}
                    </span>
                  </>
                ) : needsReconnection ? (
                  <>
                    <ExternalLink className="w-3.5 h-3.5" />
                    <span className="text-xs font-medium">Reconnect</span>
                  </>
                ) : (
                  <RefreshCw className="w-4 h-4" />
                )}
              </Button>
            )}

            {/* Always show Add Account button */}
            {onConnect && (
              <Button
                variant="outline"
                size="icon"
                onClick={onConnect}
                disabled={isLoading}
                className="flex-shrink-0 h-9 w-9"
                title="Add another account"
              >
                {isLoading ? (
                  <RefreshCw className="w-4 h-4 animate-spin" />
                ) : (
                  <Plus className="w-4 h-4" />
                )}
              </Button>
            )}
          </div>

          {/* Subtle status indicator for accounts that need attention */}
          {needsReconnection && (
            <div className="flex items-center gap-2 px-3 py-2 rounded-md bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800/50">
              <AlertCircle className="w-3.5 h-3.5 text-amber-600 dark:text-amber-400 flex-shrink-0" />
              <span className="text-xs text-amber-900 dark:text-amber-100">
                This account is disconnected. Please reconnect to continue using this workflow.
              </span>
            </div>
          )}
        </div>
      )}

      {/* Loading State - Show when loading integrations but no connections found yet */}
      {isDisconnected && isLoading && (
        <div className="flex items-center gap-2">
          <StaticIntegrationLogo
            providerId={providerId}
            providerName={providerName}
            className="w-6 h-6 flex-shrink-0 opacity-60"
          />
          <div className="flex-1 flex items-center gap-2 text-xs text-muted-foreground">
            <RefreshCw className="w-3.5 h-3.5 animate-spin" />
            Loading connection status...
          </div>
        </div>
      )}

      {/* No Connections State - Only show when truly no accounts exist and not loading */}
      {isDisconnected && !isLoading && (
        <div className="flex items-center gap-2">
          <StaticIntegrationLogo
            providerId={providerId}
            providerName={providerName}
            className="w-6 h-6 flex-shrink-0 opacity-40"
          />
          <div className="flex-1 text-xs text-muted-foreground">
            Not connected
          </div>
          {onConnect && (
            <Button
              variant="default"
              size="sm"
              onClick={onConnect}
              disabled={isLoading}
              className="flex-shrink-0 h-9"
            >
              <ExternalLink className="w-3.5 h-3.5 mr-1.5" />
              Connect
            </Button>
          )}
        </div>
      )}

      {/* Fetch Error */}
      {fetchError && (
        <Alert variant="destructive" className="py-2">
          <AlertCircle className="h-3.5 w-3.5" />
          <AlertDescription className="text-xs">
            {fetchError}
          </AlertDescription>
        </Alert>
      )}

      {/* Delete Confirmation Dialog */}
      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove Account?</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2">
                <div>
                  Are you sure you want to remove <span className="font-semibold">{getAccountDisplay(connectionToDelete || undefined)}</span>?
                </div>
                <div className="text-xs text-muted-foreground">
                  This will:
                </div>
                <ul className="text-xs text-muted-foreground list-disc list-inside space-y-1 pl-2">
                  <li>Disconnect this account from all workflows</li>
                  <li>Revoke all permissions granted to ChainReact</li>
                  <li>Require you to re-authorize from scratch if reconnecting</li>
                </ul>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleConfirmDelete}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Remove Account
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

/**
 * Format date to human-readable format
 */
function formatDate(dateString: string): string {
  const date = new Date(dateString)
  const now = new Date()
  const diffMs = now.getTime() - date.getTime()
  const diffMins = Math.floor(diffMs / 60000)
  const diffHours = Math.floor(diffMs / 3600000)
  const diffDays = Math.floor(diffMs / 86400000)

  if (diffMins < 1) return 'just now'
  if (diffMins < 60) return `${diffMins}m ago`
  if (diffHours < 24) return `${diffHours}h ago`
  if (diffDays < 7) return `${diffDays}d ago`
  return date.toLocaleDateString()
}

/**
 * Usage Example:
 *
 * <ServiceConnectionSelector
 *   providerId="gmail"
 *   providerName="Gmail"
 *   autoFetch={true}
 *   onSelectConnection={(connectionId) => console.log('Selected:', connectionId)}
 *   onConnect={() => initiateOAuth()}
 *   onReconnect={() => refreshConnection()}
 *   onDeleteConnection={(connectionId) => handleDelete(connectionId)}
 * />
 *
 * Features:
 * - Unified design across all connection states (connected/disconnected/error)
 * - Always shows account selector when accounts exist (allows switching even when disconnected)
 * - Smart button behavior: "Reconnect" for expired/error accounts, "Refresh" for active accounts
 * - Always shows "Add Account" button for connecting additional accounts
 * - Status badges in dropdown show connection health (Connected/Error/Disconnected/Pending)
 * - Subtle amber warning below selector when selected account needs attention
 * - Rich dropdown: Email, avatar, workspace type (Personal/Team/Org), delete option
 * - Auto-fetches all available connections for the provider
 * - Multi-connection support with easy switching between accounts
 * - Ultra-compact design optimized for space efficiency
 */
