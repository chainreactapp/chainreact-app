"use client"

import { useEffect, useState } from "react"
import { useIntegrationStore } from "@/stores/integrationStore"
import { useAuthStore } from "@/stores/authStore"
import { Button } from "@/components/ui/button"
import { ProfessionalSearch } from "@/components/ui/professional-search"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent } from "@/components/ui/card"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { CheckCircle2, Plus, ExternalLink, MoreVertical, Unplug, RefreshCw, Settings, AlertCircle, Shield, Eye, Home, Users, Building, Share2, Check, ChevronDown, Trash2 } from "lucide-react"
import { cn } from "@/lib/utils"
import { useToast } from "@/hooks/use-toast"
import { logger } from "@/lib/utils/logger"
import { IntegrationService } from "@/services/integration-service"
import { getIntegrationLogoClasses, getIntegrationLogoPath } from "@/lib/integrations/logoStyles"
import { useTheme } from "next-themes"
import { AppsWorkspaceGroupView } from "@/components/apps/AppsWorkspaceGroupView"
import { ShareConnectionDialog } from "@/components/workflows/configuration/ShareConnectionDialog"
import { useWorkspaces } from "@/hooks/useWorkspaces"
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { INTEGRATION_CONFIGS } from "@/lib/integrations/availableIntegrations"
import { AppCategoryFilter, CategoryBadge, APP_CATEGORIES } from "@/components/apps/AppCategoryFilter"
import { isConnectedStatus } from "@/lib/integrations/connectionStatus"

export function AppsContent() {
  // Note: initializeProviders is now handled by PagePreloader for parallel loading
  const { providers, integrations, fetchAllIntegrations, connectIntegration, setLoading, loading: storeLoading, lastFetchTime } = useIntegrationStore()
  const { user } = useAuthStore()
  const { theme } = useTheme()
  const { teams: allTeams, organizations: allOrganizations } = useWorkspaces()
  const [availableSearchQuery, setAvailableSearchQuery] = useState("")
  const [selectedCategory, setSelectedCategory] = useState("all")
  const [showConnectDialog, setShowConnectDialog] = useState(false)
  const [selectedWorkspaceType, setSelectedWorkspaceType] = useState<'personal' | 'team' | 'organization'>('personal')
  const [selectedWorkspaceId, setSelectedWorkspaceId] = useState<string | null>(null)
  const [loading, setLocalLoading] = useState<Record<string, boolean>>({})
  const [shareDialogOpen, setShareDialogOpen] = useState(false)
  const [integrationToShare, setIntegrationToShare] = useState<{ id: string; provider: string; email?: string; displayName?: string } | null>(null)
  const [expandedApp, setExpandedApp] = useState<string | null>(null)
  const { toast } = useToast()

  // Filter to only show workspaces where user can manage apps (owner or admin)
  const teams = allTeams.filter(team =>
    team.user_role === 'owner' || team.user_role === 'admin'
  )
  const organizations = allOrganizations.filter(org =>
    org.user_role === 'owner' || org.user_role === 'admin'
  )

  // Fetch all integrations for grouped view
  // Note: providers (initializeProviders) is now handled by PagePreloader for parallel loading
  useEffect(() => {
    if (user) {
      fetchAllIntegrations()
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps -- fetchAllIntegrations is store method, user is the actual trigger
  }, [user])



  const getConnectionStatus = (providerId: string) => {
    // Check direct connection first
    const directConnection = integrations.find(i => i.provider === providerId)
    if (directConnection) return directConnection

    // Check if this provider shares auth with another provider
    const config = INTEGRATION_CONFIGS[providerId]
    if (config?.sharesAuthWith) {
      const sharedConnection = integrations.find(i => i.provider === config.sharesAuthWith)
      if (sharedConnection && sharedConnection.status === 'connected') {
        // Return a synthetic integration object that indicates shared auth
        return {
          ...sharedConnection,
          provider: providerId,
          _isSharedAuth: true,
          _sharedWith: config.sharesAuthWith,
        }
      }
    }

    return undefined
  }

  // Get all connected accounts for a provider (supports multi-account)
  const getConnectedAccounts = (providerId: string) => {
    return integrations.filter(i => i.provider === providerId && isConnectedStatus(i.status))
  }

  // Format date for display
  const formatConnectedDate = (dateString: string) => {
    const date = new Date(dateString)
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
  }

  const handleConnect = async (providerId: string) => {
    if (!user) {
      toast({
        title: "Authentication Error",
        description: "You must be logged in to connect integrations.",
        variant: "destructive",
      })
      return
    }

    setLocalLoading(prev => ({ ...prev, [providerId]: true }))

    try {
      // Use the store's connectIntegration method which handles optimistic updates
      await connectIntegration(providerId, selectedWorkspaceType, selectedWorkspaceId)

      // Keep modal open so user can connect more apps without reopening
      // The connected app will automatically disappear from the list

      // No toast on success - user requested removal
    } catch (error: any) {
      // Don't show error toast if user cancelled (contains "cancel" in message)
      const isCancellation = error?.message?.toLowerCase().includes('cancel')

      if (!isCancellation) {
        logger.error("Connection error:", error)

        // Get provider display name for error message
        const provider = providers.find(p => p.id === providerId)
        const displayName = provider?.name || providerId

        toast({
          title: "Connection Error",
          description: error?.message || `Failed to connect ${displayName}. Please try again.`,
          variant: "destructive",
        })
      }
    } finally {
      // Always clear loading state immediately when OAuth closes
      setLocalLoading(prev => ({ ...prev, [providerId]: false }))
    }
  }

  const handleDisconnect = async (integrationId: string, providerName: string) => {
    setLocalLoading(prev => ({ ...prev, [integrationId]: true }))

    try {
      // Use IntegrationService which properly includes auth headers
      await IntegrationService.disconnectIntegration(integrationId)

      toast({
        title: "Disconnected",
        description: `${providerName} has been disconnected.`,
      })

      // Refresh integrations list
      fetchAllIntegrations()
    } catch (error: any) {
      logger.error("Failed to disconnect integration:", error)
      toast({
        title: "Error",
        description: error?.message || "An unexpected error occurred.",
        variant: "destructive",
      })
    } finally {
      setLocalLoading(prev => ({ ...prev, [integrationId]: false }))
    }
  }

  const handleReconnect = async (providerId: string) => {
    handleConnect(providerId)
  }

  // Popular apps to show first (most commonly used integrations)
  const POPULAR_APPS = ['gmail', 'slack', 'notion', 'drive', 'twitter', 'discord', 'airtable', 'hubspot']

  // Compute category counts for filter chips
  const categoryCounts = providers.reduce((acc, provider) => {
    if (["ai", "logic", "control"].includes(provider.id)) return acc
    const config = INTEGRATION_CONFIGS[provider.id]
    const category = config?.category || 'other'
    acc[category] = (acc[category] || 0) + 1
    return acc
  }, {} as Record<string, number>)

  // Show all apps (multi-account support) with category filtering
  const allAvailableApps = providers.filter(provider => {
    if (["ai", "logic", "control"].includes(provider.id)) return false
    const matchesSearch = availableSearchQuery === "" ||
      provider.name.toLowerCase().includes(availableSearchQuery.toLowerCase())
    const config = INTEGRATION_CONFIGS[provider.id]
    const matchesCategory = selectedCategory === "all" || config?.category === selectedCategory
    return matchesSearch && matchesCategory
  })

  // Split into popular and other apps
  const popularApps = POPULAR_APPS
    .map(id => allAvailableApps.find(app => app.id === id))
    .filter((app): app is typeof allAvailableApps[0] => app !== undefined)

  const otherApps = allAvailableApps
    .filter(app => !POPULAR_APPS.includes(app.id))
    .sort((a, b) => a.name.localeCompare(b.name))

  const availableApps = [...popularApps, ...otherApps]

  // Filter apps that need attention (expired or need reauthorization)
  const appsNeedingAttention = providers.filter(provider => {
    if (["ai", "logic", "control"].includes(provider.id)) return false
    const connection = getConnectionStatus(provider.id)
    return connection && (connection.status === 'expired' || connection.status === 'needs_reauthorization')
  })

  // Create a list of integrations including synthetic shared auth integrations
  // This is used for the workspace grouped view to show Excel when OneDrive is connected
  const integrationsWithSharedAuth = (() => {
    const connectedIntegrations = integrations.filter(i => isConnectedStatus(i.status))
    const sharedAuthIntegrations: typeof connectedIntegrations = []

    // Find all providers that share auth with connected integrations
    Object.entries(INTEGRATION_CONFIGS).forEach(([providerId, config]) => {
      if (config.sharesAuthWith) {
        // Check if the parent provider is connected
        const parentIntegration = connectedIntegrations.find(i => i.provider === config.sharesAuthWith)
        if (parentIntegration) {
          // Check if we don't already have this integration (avoid duplicates)
          const alreadyExists = connectedIntegrations.some(i => i.provider === providerId)
          if (!alreadyExists) {
            // Create a synthetic integration entry
            sharedAuthIntegrations.push({
              ...parentIntegration,
              id: `shared-${providerId}-${parentIntegration.id}`,
              provider: providerId,
              // @ts-ignore - adding custom property to indicate shared auth
              _isSharedAuth: true,
              _sharedWith: config.sharesAuthWith,
            })
          }
        }
      }
    })

    return [...connectedIntegrations, ...sharedAuthIntegrations]
  })()

  const stats = {
    connected: integrationsWithSharedAuth.length,
    available: availableApps.length,
  }

  // Show loading state while providers or integrations are being fetched
  // PagePreloader handles initializeProviders, so we just check the store state
  // We need to show loading if:
  // 1. Providers aren't loaded yet and we're loading
  // 2. Providers are loaded but initial fetch hasn't completed yet (lastFetchTime is null)
  // Using lastFetchTime ensures we don't show infinite loading for users with no integrations
  const hasInitialFetchCompleted = lastFetchTime !== null
  const isInitialLoading = (providers.length === 0 && storeLoading) ||
    (providers.length > 0 && !hasInitialFetchCompleted && storeLoading)

  if (isInitialLoading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="text-center space-y-4">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary mx-auto"></div>
          <p className="text-sm text-muted-foreground">Loading apps and integrations...</p>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Header Actions */}
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          {stats.connected} connected, {stats.available} available
        </p>

        <Dialog open={showConnectDialog} onOpenChange={setShowConnectDialog}>
          <DialogTrigger asChild>
            <Button>
              <Plus className="w-4 h-4 mr-2" />
              Connect New App
            </Button>
          </DialogTrigger>
          <DialogContent className="sm:max-w-md p-0 gap-0 overflow-hidden">
            {/* Header - centered title, conditional workspace selector */}
            <div className="px-4 py-3 border-b text-center">
              <DialogTitle className="text-base font-semibold">Connect an App</DialogTitle>
              {(teams.length > 0 || organizations.length > 0) && (
                <div className="flex items-center justify-center gap-2 mt-2">
                  <span className="text-xs text-muted-foreground">Add to:</span>
                  <Select
                    value={selectedWorkspaceType === 'personal' ? 'personal' : `${selectedWorkspaceType}-${selectedWorkspaceId}`}
                    onValueChange={(value) => {
                      if (value === 'personal') {
                        setSelectedWorkspaceType('personal')
                        setSelectedWorkspaceId(null)
                      } else {
                        const [type, id] = value.split('-')
                        setSelectedWorkspaceType(type as 'team' | 'organization')
                        setSelectedWorkspaceId(id)
                      }
                    }}
                  >
                    <SelectTrigger className="h-7 text-xs w-auto gap-1 border-0 bg-muted/50 px-2">
                      <SelectValue placeholder="Select workspace" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="personal">
                        <div className="flex items-center gap-1.5">
                          <Home className="w-3 h-3" />
                          <span>Personal</span>
                        </div>
                      </SelectItem>
                      {(teams || []).map(team => (
                        <SelectItem key={team.id} value={`team-${team.id}`}>
                          <div className="flex items-center gap-1.5">
                            <Users className="w-3 h-3" />
                            <span>{team.name}</span>
                          </div>
                        </SelectItem>
                      ))}
                      {(organizations || []).map(org => (
                        <SelectItem key={org.id} value={`organization-${org.id}`}>
                          <div className="flex items-center gap-1.5">
                            <Building className="w-3 h-3" />
                            <span>{org.name}</span>
                          </div>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}
            </div>

            {/* Search */}
            <div className="px-4 py-2 border-b">
              <div className="relative">
                <input
                  type="text"
                  placeholder="Search apps..."
                  value={availableSearchQuery}
                  onChange={(e) => setAvailableSearchQuery(e.target.value)}
                  className="w-full h-9 pl-8 pr-3 text-sm bg-muted/50 border-0 rounded-md focus:outline-none focus:ring-2 focus:ring-primary/20"
                />
                <svg className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                </svg>
              </div>
            </div>

            {/* App List with expandable connected accounts */}
            <div className="overflow-y-auto max-h-[60vh]">
              {availableApps.length === 0 ? (
                <div className="px-4 py-8 text-center">
                  <p className="text-sm text-muted-foreground">No apps found</p>
                </div>
              ) : (
                <div className="divide-y">
                  {/* Sort all apps alphabetically */}
                  {[...availableApps].sort((a, b) => a.name.localeCompare(b.name)).map((provider) => {
                    const connectedAccounts = getConnectedAccounts(provider.id)
                    const isExpanded = expandedApp === provider.id
                    const hasConnections = connectedAccounts.length > 0

                    return (
                      <div key={provider.id}>
                        {/* Main row - clickable */}
                        <button
                          onClick={() => {
                            if (hasConnections) {
                              setExpandedApp(isExpanded ? null : provider.id)
                            } else {
                              handleConnect(provider.id)
                            }
                          }}
                          disabled={loading[provider.id]}
                          className="w-full flex items-center gap-3 px-4 py-2.5 hover:bg-muted/50 transition-colors text-left disabled:opacity-50"
                        >
                          <div className="w-8 h-8 rounded-md border bg-white dark:bg-slate-900 flex items-center justify-center flex-shrink-0">
                            <img
                              src={getIntegrationLogoPath(provider.id, theme)}
                              alt={provider.name}
                              className={getIntegrationLogoClasses(provider.id, "w-5 h-5 object-contain")}
                              onError={(e) => { e.currentTarget.style.display = 'none' }}
                            />
                          </div>
                          <span className="text-sm font-medium flex-1">{provider.name}</span>

                          {/* Connected badge */}
                          {hasConnections && (
                            <span className="text-xs text-green-600 dark:text-green-400 flex items-center gap-1">
                              <Check className="w-3 h-3" />
                              {connectedAccounts.length === 1 ? 'Connected' : `${connectedAccounts.length} connected`}
                            </span>
                          )}

                          {/* Expand chevron for connected apps */}
                          {hasConnections && (
                            <ChevronDown className={cn("w-4 h-4 text-muted-foreground transition-transform", isExpanded && "rotate-180")} />
                          )}

                          {/* Loading spinner */}
                          {loading[provider.id] && (
                            <RefreshCw className="w-4 h-4 animate-spin text-muted-foreground" />
                          )}
                        </button>

                        {/* Expanded accounts section */}
                        {isExpanded && hasConnections && (
                          <div className="px-4 py-2 bg-muted/30 space-y-2">
                            {connectedAccounts.map(account => {
                              // Try to get a meaningful identifier for the account
                              const accountIdentifier = account.email
                                || account.username
                                || account.account_name
                                || account.metadata?.email
                                || account.metadata?.name
                                || account.metadata?.user?.email
                                || `${provider.name} account`

                              return (
                                <div key={account.id} className="flex items-center gap-3 py-1.5 px-2 rounded bg-background/50">
                                  <div className="flex-1 min-w-0">
                                    <p className="text-sm truncate">
                                      {accountIdentifier}
                                    </p>
                                    <p className="text-xs text-muted-foreground">
                                      Connected {formatConnectedDate(account.created_at)}
                                    </p>
                                  </div>
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={(e) => {
                                    e.stopPropagation()
                                    handleDisconnect(account.id, provider.name)
                                  }}
                                  className="h-7 px-2 text-destructive hover:text-destructive hover:bg-destructive/10"
                                >
                                  <Trash2 className="w-3.5 h-3.5" />
                                </Button>
                              </div>
                              )
                            })}

                            {/* Add another account button */}
                            <Button
                              variant="outline"
                              size="sm"
                              className="w-full mt-2"
                              onClick={(e) => {
                                e.stopPropagation()
                                handleConnect(provider.id)
                              }}
                              disabled={loading[provider.id]}
                            >
                              <Plus className="w-3.5 h-3.5 mr-1.5" />
                              Add another account
                              {loading[provider.id] && (
                                <RefreshCw className="w-3.5 h-3.5 ml-1.5 animate-spin" />
                              )}
                            </Button>
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          </DialogContent>
        </Dialog>
      </div>

      {/* Apps Needing Attention */}
      {appsNeedingAttention.length > 0 && (
        <div className="space-y-4">
          <div className="flex items-center gap-2">
            <h3 className="text-lg font-semibold">Needs Attention</h3>
            <Badge variant="destructive">{appsNeedingAttention.length}</Badge>
          </div>
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4 auto-rows-fr items-stretch">
            {appsNeedingAttention.map((provider) => {
              const connection = getConnectionStatus(provider.id)
              const isExpired = connection?.status === 'expired' || connection?.status === 'needs_reauthorization'

              return (
                <Card key={provider.id} className="group h-full hover:shadow-md transition-all border-destructive/50">
                  <CardContent className="p-4 h-full flex flex-col">
                    <div className="flex items-start gap-3 mb-3">
                      {/* App Icon */}
                      <div className="w-10 h-10 rounded-lg border flex items-center justify-center flex-shrink-0 bg-white dark:bg-slate-900">
                        <img
                          src={getIntegrationLogoPath(provider.id, theme)}
                          alt={provider.name}
                          className={getIntegrationLogoClasses(provider.id)}
                          onError={(e) => {
                            e.currentTarget.style.display = 'none'
                          }}
                        />
                      </div>

                      {/* App Info */}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <h3 className="font-semibold text-sm truncate">{provider.name}</h3>
                        </div>
                        <Badge variant="destructive" className="text-xs">
                          Reconnect
                        </Badge>
                      </div>

                      {/* Actions Dropdown */}
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-8 w-8 p-0 opacity-0 group-hover:opacity-100 transition-opacity"
                          >
                            <MoreVertical className="w-4 h-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem
                            onClick={() => handleReconnect(provider.id)}
                            disabled={loading[provider.id]}
                          >
                            <RefreshCw className="w-4 h-4 mr-2" />
                            Reconnect
                          </DropdownMenuItem>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem
                            className="text-destructive"
                            onClick={() => connection && handleDisconnect(connection.id, provider.name)}
                            disabled={loading[connection?.id || '']}
                          >
                            <Unplug className="w-4 h-4 mr-2" />
                            Disconnect
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>

                    {/* Connection Details */}
                    {connection && (
                      <div className="text-xs text-muted-foreground mt-auto">
                        <p>Connected {new Date(connection.created_at).toLocaleDateString()}</p>
                        {connection.expires_at && (
                          <p className="text-destructive">
                            Expired {new Date(connection.expires_at).toLocaleDateString()}
                          </p>
                        )}
                      </div>
                    )}
                  </CardContent>
                </Card>
              )
            })}
          </div>
        </div>
      )}

      {/* Workspace Grouped View - Always On */}
      <AppsWorkspaceGroupView
        integrations={integrationsWithSharedAuth}
        renderAppCard={(integration) => {
            // Check if this is a shared auth integration
            const isSharedAuth = (integration as any)._isSharedAuth
            const sharedWith = (integration as any)._sharedWith
            const provider = providers.find(p => p.id === integration.provider)
            if (!provider) return null

            return (
              <Card className="group h-full hover:shadow-md transition-all">
                <CardContent className="p-4 h-full flex flex-col">
                  <div className="flex items-start gap-3 mb-3">
                    {/* App Icon */}
                    <div className="w-10 h-10 rounded-lg border flex items-center justify-center flex-shrink-0 bg-white dark:bg-slate-900">
                      <img
                        src={getIntegrationLogoPath(provider.id, theme)}
                        alt={provider.name}
                        className={getIntegrationLogoClasses(provider.id)}
                        onError={(e) => {
                          e.currentTarget.style.display = 'none'
                        }}
                      />
                    </div>

                    {/* App Info */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <h3 className="font-semibold text-sm truncate">{provider.name}</h3>
                        <CheckCircle2 className="w-4 h-4 text-green-500 flex-shrink-0" />
                      </div>
                      <div className="flex items-center gap-1 flex-wrap">
                        {/* Shared Auth Badge */}
                        {isSharedAuth && (
                          <TooltipProvider>
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <Badge
                                  variant="outline"
                                  className="text-xs px-1.5 py-0.5 flex items-center gap-0.5 bg-orange-100 dark:bg-orange-900/20 text-orange-800 dark:text-orange-300"
                                >
                                  <CheckCircle2 className="w-3 h-3" />
                                  <span className="hidden sm:inline">via {providers.find(p => p.id === sharedWith)?.name || sharedWith}</span>
                                </Badge>
                              </TooltipTrigger>
                              <TooltipContent>
                                <p>Connected via {providers.find(p => p.id === sharedWith)?.name || sharedWith} - shares the same authentication</p>
                              </TooltipContent>
                            </Tooltip>
                          </TooltipProvider>
                        )}
                        {/* Permission Badge */}
                        {integration?.user_permission && !isSharedAuth && (
                          <TooltipProvider>
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <Badge
                                  variant="outline"
                                  className={`text-xs px-1.5 py-0.5 flex items-center gap-0.5 ${
                                    integration.user_permission === 'admin'
                                      ? 'bg-rose-100 dark:bg-rose-900/20 text-rose-800 dark:text-rose-300'
                                      : integration.user_permission === 'manage'
                                      ? 'bg-orange-100 dark:bg-orange-900/20 text-orange-800 dark:text-orange-300'
                                      : 'bg-gray-100 dark:bg-gray-800 text-gray-800 dark:text-gray-300'
                                  }`}
                                >
                                  {integration.user_permission === 'admin' ? (
                                    <Shield className="w-3 h-3" />
                                  ) : integration.user_permission === 'manage' ? (
                                    <Settings className="w-3 h-3" />
                                  ) : (
                                    <Eye className="w-3 h-3" />
                                  )}
                                  <span className="hidden sm:inline">{integration.user_permission === 'admin' ? 'Admin' : integration.user_permission === 'manage' ? 'Manage' : 'View'}</span>
                                </Badge>
                              </TooltipTrigger>
                              <TooltipContent>
                                <p>{
                                  integration.user_permission === 'admin'
                                    ? 'Full control: connect, disconnect, manage permissions'
                                    : integration.user_permission === 'manage'
                                    ? 'Can reconnect and view details'
                                    : 'Can use in workflows (read-only)'
                                }</p>
                              </TooltipContent>
                            </Tooltip>
                          </TooltipProvider>
                        )}
                      </div>
                    </div>

                    {/* Actions Dropdown - Only show for non-shared auth integrations */}
                    {!isSharedAuth && (
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-8 w-8 p-0 opacity-0 group-hover:opacity-100 transition-opacity"
                        >
                          <MoreVertical className="w-4 h-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem
                          onClick={() => {
                            setIntegrationToShare({
                              id: integration.id,
                              provider: provider.id,
                              email: integration.email,
                              displayName: integration.account_name || integration.email || provider.name
                            })
                            setShareDialogOpen(true)
                          }}
                        >
                          <Share2 className="w-4 h-4 mr-2" />
                          Share
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          onClick={() => handleReconnect(provider.id)}
                          disabled={loading[provider.id]}
                        >
                          <RefreshCw className="w-4 h-4 mr-2" />
                          Reconnect
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem
                          className="text-destructive"
                          onClick={() => handleDisconnect(integration.id, provider.name)}
                          disabled={loading[integration.id]}
                        >
                          <Unplug className="w-4 h-4 mr-2" />
                          Disconnect
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                    )}
                  </div>

                  {/* Connection Details */}
                  {integration && (
                    <div className="text-xs text-muted-foreground space-y-1 mt-auto">
                      {isSharedAuth && (
                        <p className="text-orange-600 dark:text-orange-400">Shares connection with {providers.find(p => p.id === sharedWith)?.name || sharedWith}</p>
                      )}
                      {integration.account_name && <p className="truncate">Account: {integration.account_name}</p>}
                      {integration.email && <p className="truncate">{integration.email}</p>}
                      <p>Connected {new Date(integration.created_at).toLocaleDateString()}</p>
                    </div>
                  )}
                </CardContent>
              </Card>
            )
          }}
        />

      {/* Footer Help */}
      <div className="mt-12 p-6 border rounded-xl bg-muted/30">
        <h3 className="font-semibold mb-2">Need a custom integration?</h3>
        <p className="text-sm text-muted-foreground mb-4">
          Can't find the app you're looking for? Request a new integration or use our API.
        </p>
        <div className="flex gap-3">
          <Button variant="outline" size="sm">
            <ExternalLink className="w-4 h-4 mr-2" />
            Request Integration
          </Button>
          <Button variant="outline" size="sm">
            <ExternalLink className="w-4 h-4 mr-2" />
            View API Docs
          </Button>
        </div>
      </div>

      {/* Share Connection Dialog */}
      {integrationToShare && (
        <ShareConnectionDialog
          open={shareDialogOpen}
          onOpenChange={(open) => {
            setShareDialogOpen(open)
            if (!open) {
              setIntegrationToShare(null)
            }
          }}
          integrationId={integrationToShare.id}
          providerId={integrationToShare.provider}
          providerName={providers.find(p => p.id === integrationToShare.provider)?.name || integrationToShare.provider}
          email={integrationToShare.email}
          displayName={integrationToShare.displayName}
          onShareUpdated={() => {
            toast({
              title: "Sharing updated",
              description: "Your connection sharing settings have been saved.",
            })
            setShareDialogOpen(false)
            setIntegrationToShare(null)
          }}
        />
      )}
    </div>
  )
}
