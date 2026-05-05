"use client"

import { useState, useEffect, useRef } from "react"
import { useAuthStore } from "@/stores/authStore"
import { useDebugStore, setDebugAdmin } from "@/stores/debugStore"
import { useIntegrationStore } from "@/stores/integrationStore"
import { useWorkspaceContext } from "@/hooks/useWorkspaceContext"
import { Button } from "@/components/ui/button"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Badge } from "@/components/ui/badge"
import { Bug, Copy, Check, Trash2, Download, X, Minimize2, Maximize2 } from "lucide-react"
import { useToast } from "@/hooks/use-toast"
import { isProfileAdmin } from "@/lib/types/admin"
import { isConnectedStatus } from "@/lib/integrations/connectionStatus"

/**
 * Global admin-only floating debug panel
 * Persists across all pages in the app
 * Only shows for users with admin capabilities in user_profiles.admin_capabilities
 *
 * Features:
 * - Floating panel that stays on top while navigating
 * - Live event logging as user interacts with app
 * - Minimizable and closable
 * - Export capabilities
 * - Real-time state snapshots
 */
export function GlobalAdminDebugPanel() {
  const { user, profile, phase } = useAuthStore()
  const { events, clearEvents } = useDebugStore()
  const { integrations, providers, workspaceType, workspaceId } = useIntegrationStore()
  const { workspaceContext } = useWorkspaceContext()
  const { toast } = useToast()
  const [copied, setCopied] = useState(false)
  const [isOpen, setIsOpen] = useState(false)
  const [isMinimized, setIsMinimized] = useState(false)
  const [categoryFilter, setCategoryFilter] = useState<string>('all')
  const logsEndRef = useRef<HTMLDivElement>(null)

  // Get unique categories from events
  const categories = Array.from(new Set(events.map(e => e.category))).sort()

  // Filter events by category
  const filteredEvents = categoryFilter === 'all'
    ? events
    : events.filter(e => e.category === categoryFilter)

  const profileIsAdmin = isProfileAdmin(profile)

  // Enable debug logging for admin users
  useEffect(() => {
    if (profileIsAdmin) {
      setDebugAdmin(true)
    }
  }, [profileIsAdmin])

  // Auto-scroll to bottom when new events arrive
  useEffect(() => {
    if (isOpen && !isMinimized) {
      logsEndRef.current?.scrollIntoView({ behavior: 'smooth' })
    }
  }, [filteredEvents.length, isOpen, isMinimized])

  // Only show for authenticated admin users
  // Wait for auth to initialize to avoid showing panel during auth loading
  if ((phase !== 'ready' && phase !== 'degraded') || !user || !profileIsAdmin) {
    return null
  }

  // Check if we're on /test/nodes page to position on left instead of right
  const isTestNodesPage = typeof window !== 'undefined' && window.location.pathname === '/test/nodes'

  // Hide debug panel on home screen (landing page)
  const isHomePage = typeof window !== 'undefined' && (window.location.pathname === '/' || window.location.pathname === '')

  // Don't show panel on home page
  if (isHomePage) {
    return null
  }

  // Build real-time snapshot data
  const snapshotData = {
    "Current Page": {
      url: typeof window !== 'undefined' ? window.location.pathname : 'N/A',
      timestamp: new Date().toISOString(),
    },
    "User Profile": {
      id: profile?.id,
      email: profile?.email,
      admin: isProfileAdmin(profile),
      full_name: profile?.full_name,
    },
    "Workspace Context": {
      type: workspaceContext?.type,
      id: workspaceContext?.id,
      name: workspaceContext?.name,
      isPersonal: workspaceContext?.isPersonal,
    },
    "Integration Stats": {
      total: integrations.length,
      connected: integrations.filter(i => isConnectedStatus(i.status)).length,
      expired: integrations.filter(i => i.status === 'expired' || i.status === 'needs_reauthorization').length,
      withPermissions: integrations.filter(i => i.user_permission).length,
      withoutPermissions: integrations.filter(i => !i.user_permission).length,
    },
    "Permission Breakdown": {
      admin: integrations.filter(i => i.user_permission === 'admin').length,
      manage: integrations.filter(i => i.user_permission === 'manage').length,
      use: integrations.filter(i => i.user_permission === 'use').length,
      null: integrations.filter(i => !i.user_permission).length,
    },
    "Store State": {
      workspaceType,
      workspaceId,
      providersCount: providers.length,
      integrationsCount: integrations.length,
    },
    "Sample Integrations (First 3)": integrations.slice(0, 3).map(i => ({
      provider: i.provider,
      status: i.status,
      workspace_type: i.workspace_type,
      workspace_id: i.workspace_id,
      connected_by: i.connected_by,
      user_permission: i.user_permission,
    })),
  }

  const copyToClipboard = (content: string, description: string = "Debug data has been copied") => {
    navigator.clipboard.writeText(content)
    setCopied(true)
    toast({
      title: "Copied to clipboard",
      description,
    })
    setTimeout(() => setCopied(false), 2000)
  }

  const copyEvent = (event: DebugEvent) => {
    const eventText = `[${new Date(event.timestamp).toLocaleTimeString()}] [${event.type}] [${event.category}] ${event.message}${event.data ? '\n' + JSON.stringify(event.data, null, 2) : ''}${event.duration ? `\nDuration: ${event.duration}ms` : ''}`
    copyToClipboard(eventText, "Event copied to clipboard")
  }

  const copyAllLogs = () => {
    const allLogsText = events.map(event =>
      `[${new Date(event.timestamp).toLocaleTimeString()}] [${event.type}] [${event.category}] ${event.message}${event.data ? '\n' + JSON.stringify(event.data, null, 2) : ''}${event.duration ? `\nDuration: ${event.duration}ms` : ''}`
    ).join('\n\n---\n\n')
    copyToClipboard(allLogsText, `${events.length} events copied to clipboard`)
  }

  const exportLogs = () => {
    const logsJson = JSON.stringify(events, null, 2)
    const blob = new Blob([logsJson], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `debug-logs-${new Date().toISOString()}.json`
    a.click()
    URL.revokeObjectURL(url)
    toast({
      title: "Logs exported",
      description: "Debug logs downloaded as JSON",
    })
  }

  const exportSnapshot = () => {
    const snapshotJson = JSON.stringify(snapshotData, null, 2)
    const blob = new Blob([snapshotJson], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `debug-snapshot-${new Date().toISOString()}.json`
    a.click()
    URL.revokeObjectURL(url)
    toast({
      title: "Snapshot exported",
      description: "Debug snapshot downloaded as JSON",
    })
  }

  const getEventColor = (type: string) => {
    switch (type) {
      case 'api_call': return 'bg-orange-100 dark:bg-orange-900/20 text-orange-800 dark:text-orange-300'
      case 'api_response': return 'bg-green-100 dark:bg-green-900/20 text-green-800 dark:text-green-300'
      case 'api_error': return 'bg-red-100 dark:bg-red-900/20 text-red-800 dark:text-red-300'
      case 'state_change': return 'bg-rose-100 dark:bg-rose-900/20 text-rose-800 dark:text-rose-300'
      case 'user_action': return 'bg-yellow-100 dark:bg-yellow-900/20 text-yellow-800 dark:text-yellow-300'
      case 'error': return 'bg-red-100 dark:bg-red-900/20 text-red-800 dark:text-red-300'
      case 'warning': return 'bg-orange-100 dark:bg-orange-900/20 text-orange-800 dark:text-orange-300'
      default: return 'bg-gray-100 dark:bg-gray-800 text-gray-800 dark:text-gray-300'
    }
  }

  return (
    <>
      {/* Toggle Button */}
      {!isOpen && (
        <Button
          variant="outline"
          size="sm"
          onClick={() => setIsOpen(true)}
          className={`fixed bottom-4 z-30 shadow-lg ${isTestNodesPage ? 'left-4' : 'right-4'}`}
        >
          <Bug className="w-4 h-4 mr-2" />
          Debug
          {events.length > 0 && (
            <Badge variant="secondary" className="ml-2">
              {events.length}
            </Badge>
          )}
        </Button>
      )}

      {/* Floating Panel */}
      {isOpen && (
        <div
          className={`fixed bottom-4 z-30 bg-white dark:bg-slate-900 border rounded-lg shadow-2xl flex flex-col ${isTestNodesPage ? 'left-4' : 'right-4'}`}
          style={{
            width: isMinimized ? '320px' : (isTestNodesPage ? '500px' : '900px'),
            height: isMinimized ? 'auto' : (isTestNodesPage ? '500px' : '650px'),
            maxHeight: isTestNodesPage ? '70vh' : '650px',
          }}
        >
          {/* Header */}
          <div className="flex items-center justify-between p-3 border-b bg-slate-50 dark:bg-slate-800 rounded-t-lg">
            <div className="flex items-center gap-2">
              <Bug className="w-4 h-4" />
              <span className="font-semibold text-sm">Admin Debug Panel</span>
              {events.length > 0 && (
                <Badge variant="secondary" className="text-xs">
                  {events.length} events
                </Badge>
              )}
            </div>
            <div className="flex items-center gap-1">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setIsMinimized(!isMinimized)}
                className="h-8 w-8 p-0"
                title={isMinimized ? "Maximize" : "Minimize"}
              >
                {isMinimized ? (
                  <Maximize2 className="w-4 h-4" />
                ) : (
                  <Minimize2 className="w-4 h-4" />
                )}
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setIsOpen(false)}
                className="h-8 w-8 p-0"
                title="Close"
              >
                <X className="w-4 h-4" />
              </Button>
            </div>
          </div>

          {/* Content - Only show when not minimized */}
          {!isMinimized && (
            <>
              <div className="text-xs text-muted-foreground px-3 pt-2 pb-1">
                Global admin panel • Persists across all pages • Navigate freely to see live events
              </div>

              <Tabs defaultValue="logs" className="flex-1 flex flex-col overflow-hidden px-3">
                <TabsList className="grid w-full grid-cols-2">
                  <TabsTrigger value="logs" className="text-xs">
                    Live Logs
                    <Badge variant="secondary" className="ml-2 text-xs">
                      {categoryFilter === 'all' ? events.length : `${filteredEvents.length}/${events.length}`}
                    </Badge>
                  </TabsTrigger>
                  <TabsTrigger value="snapshot" className="text-xs">Snapshot</TabsTrigger>
                </TabsList>

                {/* Live Logs Tab */}
                <TabsContent value="logs" className="flex-1 flex flex-col overflow-hidden mt-2">
                  <div className="flex justify-between items-center mb-2">
                    <div className="flex items-center gap-2">
                      <p className="text-xs text-muted-foreground">
                        Filter:
                      </p>
                      <select
                        value={categoryFilter}
                        onChange={(e) => setCategoryFilter(e.target.value)}
                        className="h-7 text-xs border rounded px-2 bg-background"
                      >
                        <option value="all">All Categories</option>
                        {categories.map(cat => (
                          <option key={cat} value={cat}>{cat}</option>
                        ))}
                      </select>
                    </div>
                    <div className="flex gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={copyAllLogs}
                        disabled={events.length === 0}
                        className="h-7 text-xs"
                      >
                        <Copy className="w-3 h-3 mr-1" />
                        Copy All
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={exportLogs}
                        disabled={events.length === 0}
                        className="h-7 text-xs"
                      >
                        <Download className="w-3 h-3 mr-1" />
                        Export
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={clearEvents}
                        disabled={events.length === 0}
                        className="h-7 text-xs"
                      >
                        <Trash2 className="w-3 h-3 mr-1" />
                        Clear
                      </Button>
                    </div>
                  </div>

                  <div className="flex-1 overflow-auto border rounded-lg bg-slate-950 p-3 font-mono text-xs">
                    {filteredEvents.length === 0 ? (
                      <div className="text-slate-400 text-center py-8 text-xs">
                        {events.length === 0
                          ? 'No events captured yet. Navigate the app to see live logs.'
                          : `No events in category "${categoryFilter}"`
                        }
                      </div>
                    ) : (
                      <div className="space-y-2">
                        {filteredEvents.map((event) => (
                          <div
                            key={event.id}
                            className="border-l-2 border-slate-700 pl-2 py-1.5 hover:bg-slate-900/50 transition-colors group relative"
                          >
                            <div className="flex items-start gap-2 mb-0.5">
                              <span className="text-slate-500 text-[9px] font-normal min-w-[70px]">
                                {new Date(event.timestamp).toLocaleTimeString()}
                              </span>
                              <Badge
                                variant="outline"
                                className={`text-[9px] px-1 py-0 ${getEventColor(event.type)}`}
                              >
                                {event.type}
                              </Badge>
                              <span className="text-slate-400 text-[9px]">
                                [{event.category}]
                              </span>
                              {/* Copy button - shows on hover */}
                              <button
                                onClick={() => copyEvent(event)}
                                className="ml-auto opacity-0 group-hover:opacity-100 transition-opacity text-slate-500 hover:text-slate-300"
                                title="Copy this event"
                              >
                                <Copy className="w-3 h-3" />
                              </button>
                            </div>
                            <div className="text-slate-200 text-[10px] ml-[72px]">
                              {event.message}
                            </div>
                            {event.data && (
                              <details className="ml-[72px] mt-0.5">
                                <summary className="text-slate-500 cursor-pointer hover:text-slate-400 text-[9px]">
                                  View data
                                </summary>
                                <pre className="text-slate-400 text-[9px] mt-1 pl-2 border-l border-slate-700 overflow-x-auto">
                                  {JSON.stringify(event.data, null, 2)}
                                </pre>
                              </details>
                            )}
                            {event.duration && (
                              <div className="text-slate-500 text-[9px] ml-[72px] mt-0.5">
                                ⏱ {event.duration}ms
                              </div>
                            )}
                          </div>
                        ))}
                        <div ref={logsEndRef} />
                      </div>
                    )}
                  </div>
                </TabsContent>

                {/* Snapshot Tab */}
                <TabsContent value="snapshot" className="flex-1 overflow-auto mt-2">
                  <div className="flex justify-between items-center mb-2">
                    <p className="text-xs text-muted-foreground">
                      Real-time state snapshot • Updates automatically
                    </p>
                    <div className="flex gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={exportSnapshot}
                        className="h-7 text-xs"
                      >
                        <Download className="w-3 h-3 mr-1" />
                        Export
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => copyToClipboard(JSON.stringify(snapshotData, null, 2))}
                        className="h-7 text-xs"
                      >
                        {copied ? (
                          <>
                            <Check className="w-3 h-3 mr-1" />
                            Copied
                          </>
                        ) : (
                          <>
                            <Copy className="w-3 h-3 mr-1" />
                            Copy
                          </>
                        )}
                      </Button>
                    </div>
                  </div>

                  <div className="space-y-3 max-h-[480px] overflow-auto pb-2">
                    {Object.entries(snapshotData).map(([key, value]) => (
                      <div key={key} className="border rounded-lg p-3">
                        <h3 className="font-semibold text-xs mb-1.5 text-orange-600 dark:text-orange-400">
                          {key}
                        </h3>
                        <pre className="bg-slate-100 dark:bg-slate-900 p-2 rounded text-[10px] overflow-x-auto">
                          {typeof value === 'object'
                            ? JSON.stringify(value, null, 2)
                            : String(value)}
                        </pre>
                      </div>
                    ))}
                  </div>
                </TabsContent>
              </Tabs>

              <div className="border-t p-2 text-[10px] text-gray-500">
                Admin-only • Persists across navigation • Regular users don't see this
              </div>
            </>
          )}
        </div>
      )}
    </>
  )
}
