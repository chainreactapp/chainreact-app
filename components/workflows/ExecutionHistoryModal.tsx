"use client"

import React, { useState, useEffect } from 'react'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Button } from "@/components/ui/button"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import {
  Clock,
  CheckCircle2,
  XCircle,
  AlertCircle,
  Terminal,
  Eye,
  Download,
  Trash2,
  Copy,
  Filter,
  RefreshCw,
  RotateCcw,
  ChevronRight,
  ChevronDown,
  PlayCircle,
  TestTube,
  Activity,
  Zap,
  FileText,
  Code2,
  Mail,
  MessageSquare,
  Bot,
  Calendar,
  Database,
  Globe,
  Bell,
  Settings,
  Image as ImageIcon
} from 'lucide-react'
import { useToast } from '@/hooks/use-toast'
import { cn } from '@/lib/utils'
import { format } from 'date-fns'
import { integrationIcons } from '@/lib/integrations/integration-icons'
import { getIntegrationLogoClasses } from '@/lib/integrations/logoStyles'
import Image from 'next/image'
import { ClassifiedErrorCard } from './ClassifiedErrorCard'
import type { PersistedErrorClassification } from '@/lib/workflows/errors/classifyExecutionFailure'

import { logger } from '@/lib/utils/logger'

interface ExecutionHistoryEntry {
  id: string
  workflow_id: string
  user_id: string
  status: 'running' | 'completed' | 'failed' | 'cancelled'
  test_mode: boolean
  started_at: string
  completed_at?: string
  error_message?: string
  error_classification?: PersistedErrorClassification | null
  trigger_data?: any
  final_output?: any
}

// Provider slugs whose actions move money / fulfill orders. Triggers a
// heightened retry warning so users don't double-charge by retrying.
const PAYMENT_IMPACTING_PROVIDERS = ["stripe", "shopify", "square", "paypal"]
function isPaymentImpactingNodeType(nodeType: string | null | undefined): boolean {
  if (!nodeType) return false
  const lower = nodeType.toLowerCase()
  return PAYMENT_IMPACTING_PROVIDERS.some((p) => lower.startsWith(`${p}_`))
}

interface ExecutionStep {
  id: string
  execution_id: string
  node_id: string
  node_type: string
  node_name?: string
  step_number: number
  status: 'pending' | 'running' | 'completed' | 'failed' | 'skipped'
  started_at?: string
  completed_at?: string
  duration_ms?: number
  input_data?: any
  output_data?: any
  error_message?: string
  error_details?: any
  test_mode_preview?: any
}

interface ExecutionHistoryModalProps {
  open: boolean
  onClose: () => void
  workflowId: string
  workflowName?: string
}

export function ExecutionHistoryModal({
  open,
  onClose,
  workflowId,
  workflowName = "Workflow"
}: ExecutionHistoryModalProps) {
  const [history, setHistory] = useState<ExecutionHistoryEntry[]>([])
  const [selectedExecution, setSelectedExecution] = useState<ExecutionHistoryEntry | null>(null)
  const [executionSteps, setExecutionSteps] = useState<ExecutionStep[]>([])
  const [expandedSteps, setExpandedSteps] = useState<Set<string>>(new Set())
  const [filter, setFilter] = useState<'all' | 'completed' | 'failed' | 'test'>('all')
  const [view, setView] = useState<'list' | 'details'>('list')
  const [loading, setLoading] = useState(false)
  const [stepsLoading, setStepsLoading] = useState(false)
  const [retryConfirmOpen, setRetryConfirmOpen] = useState(false)
  const [retrying, setRetrying] = useState(false)
  const { toast } = useToast()

  const hasPaymentImpactingStep = executionSteps.some((s) =>
    isPaymentImpactingNodeType(s.node_type)
  )

  const handleRetry = async () => {
    if (!selectedExecution) return
    setRetrying(true)
    try {
      const response = await fetch(
        `/api/executions/${selectedExecution.id}/retry`,
        { method: "POST", headers: { "Content-Type": "application/json" } }
      )
      const body = await response.json().catch(() => ({}))
      if (!response.ok) {
        toast({
          title: "Retry failed",
          description:
            body?.error ||
            body?.message ||
            "The workflow could not be retried. Please try again.",
          variant: "destructive",
        })
        return
      }
      toast({
        title: "Workflow retry started",
        description: "A new execution has been queued.",
      })
      setRetryConfirmOpen(false)
      // Refresh list so the new run shows up
      await loadHistory()
    } catch (error) {
      logger.error("Error retrying execution:", error)
      toast({
        title: "Retry failed",
        description: "Could not reach the server. Please try again.",
        variant: "destructive",
      })
    } finally {
      setRetrying(false)
    }
  }

  // Load history when modal opens
  useEffect(() => {
    if (open) {
      loadHistory()
    }
  }, [open, workflowId])

  const loadHistory = async () => {
    setLoading(true)
    try {
      const response = await fetch(`/api/workflows/${workflowId}/history`)
      if (!response.ok) throw new Error('Failed to load history')

      const data = await response.json()
      setHistory(data.history || [])
    } catch (error) {
      logger.error('Error loading history:', error)
      toast({
        title: "Error",
        description: "Failed to load execution history",
        variant: "destructive"
      })
    } finally {
      setLoading(false)
    }
  }

  const loadExecutionSteps = async (executionId: string) => {
    setStepsLoading(true)
    try {
      const response = await fetch(`/api/workflows/history/${executionId}/steps`)
      if (!response.ok) throw new Error('Failed to load execution steps')

      const data = await response.json()
      setExecutionSteps(data.steps || [])
    } catch (error) {
      logger.error('Error loading execution steps:', error)
      toast({
        title: "Error",
        description: "Failed to load execution steps",
        variant: "destructive"
      })
    } finally {
      setStepsLoading(false)
    }
  }

  const handleSelectExecution = async (execution: ExecutionHistoryEntry) => {
    setSelectedExecution(execution)
    setView('details')
    await loadExecutionSteps(execution.id)
  }

  const handleClearHistory = async () => {
    try {
      const response = await fetch(`/api/workflows/${workflowId}/history`, {
        method: 'DELETE'
      })

      if (!response.ok) throw new Error('Failed to clear history')

      setHistory([])
      setSelectedExecution(null)
      setExecutionSteps([])
      toast({
        title: "History cleared",
        description: "Execution history has been cleared"
      })
    } catch (error) {
      logger.error('Error clearing history:', error)
      toast({
        title: "Error",
        description: "Failed to clear execution history",
        variant: "destructive"
      })
    }
  }

  const handleCopyExecution = (execution: ExecutionHistoryEntry) => {
    const content = JSON.stringify(execution, null, 2)
    navigator.clipboard.writeText(content)
    toast({
      title: "Copied to clipboard",
      description: "Execution data has been copied"
    })
  }

  const handleDownloadHistory = () => {
    const content = JSON.stringify(history, null, 2)
    const blob = new Blob([content], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${workflowName.replace(/\s+/g, '-')}-execution-history-${new Date().toISOString()}.json`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)

    toast({
      title: "History downloaded",
      description: "Execution history has been downloaded"
    })
  }

  const toggleStepExpanded = (stepId: string) => {
    const newExpanded = new Set(expandedSteps)
    if (newExpanded.has(stepId)) {
      newExpanded.delete(stepId)
    } else {
      newExpanded.add(stepId)
    }
    setExpandedSteps(newExpanded)
  }

  const filteredHistory = history.filter(execution => {
    if (filter === 'all') return true
    if (filter === 'completed') return execution.status === 'completed'
    if (filter === 'failed') return execution.status === 'failed'
    if (filter === 'test') return execution.test_mode
    return true
  })

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'completed':
        return <CheckCircle2 className="h-4 w-4 text-green-500" />
      case 'failed':
        return <XCircle className="h-4 w-4 text-red-500" />
      case 'running':
        return <RefreshCw className="h-4 w-4 text-blue-500 animate-spin" />
      case 'cancelled':
        return <AlertCircle className="h-4 w-4 text-yellow-500" />
      case 'skipped':
        return <AlertCircle className="h-4 w-4 text-gray-400" />
      default:
        return <Clock className="h-4 w-4 text-gray-400" />
    }
  }

  const getStatusBadge = (status: string, testMode?: boolean) => {
    return (
      <div className="flex items-center gap-2">
        <Badge
          variant={
            status === 'completed' ? 'default' :
            status === 'failed' ? 'destructive' :
            status === 'running' ? 'secondary' :
            'outline'
          }
        >
          {status}
        </Badge>
        {testMode && (
          <Badge variant="outline" className="text-blue-600 border-blue-600">
            <TestTube className="h-3 w-3 mr-1" />
            Test
          </Badge>
        )}
      </div>
    )
  }

  const formatDuration = (ms?: number) => {
    if (!ms) return '-'
    if (ms < 1000) return `${ms}ms`
    if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`
    return `${Math.floor(ms / 60000)}m ${Math.floor((ms % 60000) / 1000)}s`
  }

  // Get integration icon based on node type
  const getIntegrationIcon = (nodeType: string) => {
    // Extract provider from node type (e.g., 'gmail_action_send' -> 'gmail')
    const provider = nodeType.split('_')[0]

    // Check if we have an SVG icon for this provider
    if (integrationIcons[provider]) {
      return (
        <div className="relative w-5 h-5">
          <Image
            src={integrationIcons[provider]}
            alt={provider}
            width={20}
            height={20}
            className={getIntegrationLogoClasses(provider, "w-5 h-5 object-contain")}
          />
        </div>
      )
    }

    // Fallback to Lucide icons based on type
    if (nodeType.includes('gmail')) return <Mail className="h-5 w-5 text-red-500" />
    if (nodeType.includes('discord')) return <MessageSquare className="h-5 w-5 text-indigo-500" />
    if (nodeType.includes('slack')) return <MessageSquare className="h-5 w-5 text-purple-500" />
    if (nodeType.includes('ai') || nodeType.includes('agent')) return <Bot className="h-5 w-5 text-green-500" />
    if (nodeType.includes('calendar')) return <Calendar className="h-5 w-5 text-blue-500" />
    if (nodeType.includes('notion')) return <FileText className="h-5 w-5 text-gray-700" />
    if (nodeType.includes('database')) return <Database className="h-5 w-5 text-orange-500" />
    if (nodeType.includes('webhook')) return <Globe className="h-5 w-5 text-cyan-500" />
    if (nodeType.includes('trigger')) return <Bell className="h-5 w-5 text-yellow-500" />
    if (nodeType.includes('action')) return <Zap className="h-5 w-5 text-green-500" />
    if (nodeType.includes('logic')) return <Settings className="h-5 w-5 text-gray-500" />
    return <Settings className="h-5 w-5 text-gray-400" />
  }

  // Format node name for display
  const formatNodeName = (nodeName?: string, nodeType?: string) => {
    if (nodeName) return nodeName

    // Convert node_type to readable format
    if (!nodeType) return 'Unknown Step'

    // Split by underscore and capitalize
    const parts = nodeType.split('_')
    const provider = parts[0]
    const action = parts.slice(1).join(' ')

    // Capitalize first letter of each word
    const capitalize = (str: string) => str.charAt(0).toUpperCase() + str.slice(1)

    return `${capitalize(provider)} - ${action.split(' ').map(capitalize).join(' ')}`
  }

  // Calculate summary statistics
  const stats = {
    total: history.length,
    completed: history.filter(e => e.status === 'completed').length,
    failed: history.filter(e => e.status === 'failed').length,
    running: history.filter(e => e.status === 'running').length,
    test: history.filter(e => e.test_mode).length,
    avgDuration: history
      .filter(e => e.completed_at)
      .reduce((acc, e) => {
        const duration = new Date(e.completed_at!).getTime() - new Date(e.started_at).getTime()
        return acc + duration
      }, 0) / (history.filter(e => e.completed_at).length || 1)
  }

  return (
    <Dialog open={open} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-7xl h-[85vh] max-h-[85vh] p-0 my-auto">
        <DialogHeader className="px-6 py-4 border-b bg-gradient-to-r from-gray-50 to-white dark:from-gray-900 dark:to-gray-950">
          <div className="flex items-start justify-between">
            <div className="flex-1">
              <DialogTitle className="text-2xl font-semibold bg-gradient-to-r from-gray-900 to-gray-600 dark:from-white dark:to-gray-400 bg-clip-text text-transparent">
                Execution History
              </DialogTitle>
              <DialogDescription className="text-sm mt-1">
                {workflowName}
              </DialogDescription>

              {/* Summary Statistics */}
              <div className="grid grid-cols-5 gap-3 mt-4">
                <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-3">
                  <div className="flex items-center gap-2 mb-1">
                    <Activity className="h-3.5 w-3.5 text-gray-600 dark:text-gray-400" />
                    <span className="text-xs font-medium text-gray-600 dark:text-gray-400">Total</span>
                  </div>
                  <div className="text-2xl font-bold text-gray-900 dark:text-white">{stats.total}</div>
                </div>

                <div className="bg-white dark:bg-gray-800 rounded-lg border border-green-200 dark:border-green-800 p-3">
                  <div className="flex items-center gap-2 mb-1">
                    <CheckCircle2 className="h-3.5 w-3.5 text-green-600 dark:text-green-400" />
                    <span className="text-xs font-medium text-green-600 dark:text-green-400">Completed</span>
                  </div>
                  <div className="text-2xl font-bold text-green-700 dark:text-green-300">{stats.completed}</div>
                  {stats.total > 0 && (
                    <div className="text-xs text-green-600 dark:text-green-400 mt-1">
                      {((stats.completed / stats.total) * 100).toFixed(0)}% success
                    </div>
                  )}
                </div>

                <div className="bg-white dark:bg-gray-800 rounded-lg border border-red-200 dark:border-red-800 p-3">
                  <div className="flex items-center gap-2 mb-1">
                    <XCircle className="h-3.5 w-3.5 text-red-600 dark:text-red-400" />
                    <span className="text-xs font-medium text-red-600 dark:text-red-400">Failed</span>
                  </div>
                  <div className="text-2xl font-bold text-red-700 dark:text-red-300">{stats.failed}</div>
                  {stats.total > 0 && stats.failed > 0 && (
                    <div className="text-xs text-red-600 dark:text-red-400 mt-1">
                      {((stats.failed / stats.total) * 100).toFixed(0)}% error rate
                    </div>
                  )}
                </div>

                <div className="bg-white dark:bg-gray-800 rounded-lg border border-blue-200 dark:border-blue-800 p-3">
                  <div className="flex items-center gap-2 mb-1">
                    <Clock className="h-3.5 w-3.5 text-blue-600 dark:text-blue-400" />
                    <span className="text-xs font-medium text-blue-600 dark:text-blue-400">Avg Duration</span>
                  </div>
                  <div className="text-2xl font-bold text-blue-700 dark:text-blue-300">
                    {formatDuration(stats.avgDuration)}
                  </div>
                </div>

                <div className="bg-white dark:bg-gray-800 rounded-lg border border-purple-200 dark:border-purple-800 p-3">
                  <div className="flex items-center gap-2 mb-1">
                    <TestTube className="h-3.5 w-3.5 text-purple-600 dark:text-purple-400" />
                    <span className="text-xs font-medium text-purple-600 dark:text-purple-400">Test Runs</span>
                  </div>
                  <div className="text-2xl font-bold text-purple-700 dark:text-purple-300">{stats.test}</div>
                </div>
              </div>
            </div>

            <div className="flex items-center gap-2 ml-6">
              <Button
                size="sm"
                variant="outline"
                onClick={() => loadHistory()}
                disabled={loading}
                className="h-9"
              >
                <RefreshCw className={cn("h-4 w-4 mr-2", loading && "animate-spin")} />
                Refresh
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={handleDownloadHistory}
                disabled={history.length === 0}
                className="h-9"
              >
                <Download className="h-4 w-4 mr-2" />
                Export
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={handleClearHistory}
                disabled={history.length === 0}
                className="h-9 text-red-600 hover:text-red-700 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-950"
              >
                <Trash2 className="h-4 w-4 mr-2" />
                Clear
              </Button>
            </div>
          </div>
        </DialogHeader>

        <div className="flex-1 overflow-hidden" style={{ height: 'calc(100% - 240px)' }}>
          <Tabs value={view} onValueChange={(v) => setView(v as 'list' | 'details')} className="h-full flex flex-col">
            <div className="px-6 py-3 border-b bg-gray-50 dark:bg-gray-900">
              <div className="flex items-center justify-between">
                <TabsList className="bg-white dark:bg-gray-800">
                  <TabsTrigger value="list" className="gap-2">
                    <Activity className="h-4 w-4" />
                    All Executions
                  </TabsTrigger>
                  <TabsTrigger value="details" disabled={!selectedExecution} className="gap-2">
                    <Zap className="h-4 w-4" />
                    Execution Details
                  </TabsTrigger>
                </TabsList>

                <div className="flex items-center gap-2">
                  <Filter className="h-4 w-4 text-gray-500 mr-1" />
                  <Button
                    size="sm"
                    variant={filter === 'all' ? 'default' : 'outline'}
                    onClick={() => setFilter('all')}
                    className="h-8"
                  >
                    All ({history.length})
                  </Button>
                  <Button
                    size="sm"
                    variant={filter === 'completed' ? 'default' : 'outline'}
                    onClick={() => setFilter('completed')}
                    className="h-8"
                  >
                    Completed ({stats.completed})
                  </Button>
                  <Button
                    size="sm"
                    variant={filter === 'failed' ? 'default' : 'outline'}
                    onClick={() => setFilter('failed')}
                    className="h-8"
                  >
                    Failed ({stats.failed})
                  </Button>
                  <Button
                    size="sm"
                    variant={filter === 'test' ? 'default' : 'outline'}
                    onClick={() => setFilter('test')}
                    className="h-8"
                  >
                    Test ({stats.test})
                  </Button>
                </div>
              </div>
            </div>

            <TabsContent value="list" className="flex-1 m-0 overflow-hidden">
              <ScrollArea className="h-full px-6 py-4">
                {loading ? (
                  <div className="flex flex-col items-center justify-center py-12">
                    <RefreshCw className="h-8 w-8 animate-spin text-gray-400 mb-3" />
                    <p className="text-sm text-gray-500">Loading execution history...</p>
                  </div>
                ) : filteredHistory.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-12">
                    <Activity className="h-12 w-12 text-gray-300 dark:text-gray-700 mb-3" />
                    <p className="text-gray-500 dark:text-gray-300 font-medium">No execution history found</p>
                    <p className="text-sm text-gray-400 dark:text-gray-400 mt-1">
                      {filter !== 'all' ? 'Try changing your filter' : 'Run your workflow to see execution history'}
                    </p>
                  </div>
                ) : (
                  <div className="space-y-2">
                    {filteredHistory.map((execution) => {
                      const duration = execution.completed_at
                        ? new Date(execution.completed_at).getTime() - new Date(execution.started_at).getTime()
                        : null

                      return (
                        <Card
                          key={execution.id}
                          className="cursor-pointer hover:shadow-md hover:border-gray-400 dark:hover:border-gray-600 transition-all group"
                          onClick={() => handleSelectExecution(execution)}
                        >
                          <CardContent className="p-4">
                            <div className="flex items-center justify-between gap-4">
                              {/* Status Icon & ID */}
                              <div className="flex items-center gap-3 min-w-0">
                                <div className="flex-shrink-0">
                                  {getStatusIcon(execution.status)}
                                </div>
                                <div className="min-w-0 flex-1">
                                  <div className="flex items-center gap-2 mb-1">
                                    <span className="font-mono text-xs text-gray-500 dark:text-gray-400 truncate">
                                      {execution.id.slice(0, 8)}
                                    </span>
                                    {getStatusBadge(execution.status, execution.test_mode)}
                                  </div>
                                  <div className="text-sm text-gray-600 dark:text-gray-200">
                                    {format(new Date(execution.started_at), 'MMM d, yyyy • HH:mm:ss')}
                                  </div>
                                </div>
                              </div>

                              {/* Metrics */}
                              <div className="flex items-center gap-6 flex-shrink-0">
                                {duration !== null && (
                                  <div className="text-center">
                                    <div className="text-xs text-gray-500 dark:text-gray-400 mb-0.5">Duration</div>
                                    <div className="text-sm font-semibold text-gray-900 dark:text-white">
                                      {formatDuration(duration)}
                                    </div>
                                  </div>
                                )}

                                {execution.status === 'running' && (
                                  <div className="text-center">
                                    <div className="text-xs text-blue-500 mb-0.5">Running</div>
                                    <div className="text-sm font-semibold text-blue-600 dark:text-blue-400">
                                      {formatDuration(Date.now() - new Date(execution.started_at).getTime())}
                                    </div>
                                  </div>
                                )}
                              </div>

                              {/* Actions */}
                              <div className="flex items-center gap-2 flex-shrink-0">
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  onClick={(e) => {
                                    e.stopPropagation()
                                    handleCopyExecution(execution)
                                  }}
                                  className="h-8 w-8 p-0 opacity-0 group-hover:opacity-100 transition-opacity"
                                >
                                  <Copy className="h-4 w-4" />
                                </Button>
                                <ChevronRight className="h-5 w-5 text-gray-400 group-hover:text-gray-600 dark:group-hover:text-gray-300 transition-colors" />
                              </div>
                            </div>

                            {(execution.error_classification || execution.error_message) && (
                              <div className="mt-3" onClick={(e) => e.stopPropagation()}>
                                <ClassifiedErrorCard
                                  classification={execution.error_classification}
                                  rawErrorMessage={execution.error_message}
                                  workflowId={execution.workflow_id}
                                  variant="compact"
                                />
                              </div>
                            )}
                          </CardContent>
                        </Card>
                      )
                    })}
                  </div>
                )}
              </ScrollArea>
            </TabsContent>

            <TabsContent value="details" className="flex-1 m-0 overflow-hidden">
              <ScrollArea className="h-full px-6 py-4">
                {selectedExecution && (
                  <div className="space-y-4">
                    {/* Execution Summary Card */}
                    <Card className="border-2">
                      <CardHeader className="bg-gradient-to-r from-gray-50 to-white dark:from-gray-900 dark:to-gray-950 pb-4">
                        <div className="flex items-center justify-between">
                          <CardTitle className="text-lg font-semibold">Execution Overview</CardTitle>
                          <div className="flex items-center gap-2">
                            {selectedExecution.status === 'failed' && (
                              <Button
                                size="sm"
                                variant="default"
                                onClick={() => setRetryConfirmOpen(true)}
                              >
                                <RotateCcw className="h-4 w-4 mr-2" />
                                Retry execution
                              </Button>
                            )}
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => handleCopyExecution(selectedExecution)}
                            >
                              <Copy className="h-4 w-4 mr-2" />
                              Copy Data
                            </Button>
                          </div>
                        </div>
                      </CardHeader>
                      <CardContent className="pt-4">
                        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                          <div className="space-y-1">
                            <div className="text-xs text-gray-500 dark:text-gray-400 font-medium">Execution ID</div>
                            <div className="font-mono text-sm bg-gray-100 dark:bg-gray-800 px-2 py-1 rounded border">
                              {selectedExecution.id}
                            </div>
                          </div>

                          <div className="space-y-1">
                            <div className="text-xs text-gray-500 dark:text-gray-400 font-medium">Status</div>
                            <div>{getStatusBadge(selectedExecution.status, selectedExecution.test_mode)}</div>
                          </div>

                          <div className="space-y-1">
                            <div className="text-xs text-gray-500 dark:text-gray-400 font-medium">Started At</div>
                            <div className="text-sm font-medium">
                              {format(new Date(selectedExecution.started_at), 'MMM d, yyyy')}
                            </div>
                            <div className="text-xs text-gray-600 dark:text-gray-200">
                              {format(new Date(selectedExecution.started_at), 'HH:mm:ss')}
                            </div>
                          </div>

                          {selectedExecution.completed_at && (
                            <div className="space-y-1">
                              <div className="text-xs text-gray-500 dark:text-gray-400 font-medium">Duration</div>
                              <div className="text-lg font-bold text-blue-600 dark:text-blue-400">
                                {formatDuration(
                                  new Date(selectedExecution.completed_at).getTime() -
                                  new Date(selectedExecution.started_at).getTime()
                                )}
                              </div>
                            </div>
                          )}
                        </div>

                        {(selectedExecution.error_classification || selectedExecution.error_message) && (
                          <div className="mt-4">
                            <ClassifiedErrorCard
                              classification={selectedExecution.error_classification}
                              rawErrorMessage={selectedExecution.error_message}
                              workflowId={selectedExecution.workflow_id}
                              variant="full"
                            />
                          </div>
                        )}
                      </CardContent>
                    </Card>

                    {/* Execution Steps */}
                    <Card className="border-2">
                      <CardHeader className="bg-gradient-to-r from-gray-50 to-white dark:from-gray-900 dark:to-gray-950">
                        <CardTitle className="text-lg font-semibold flex items-center gap-2">
                          <Zap className="h-5 w-5" />
                          Execution Steps ({executionSteps.length})
                        </CardTitle>
                      </CardHeader>
                      <CardContent className="pt-4">
                        {stepsLoading ? (
                          <div className="flex flex-col items-center justify-center py-12">
                            <RefreshCw className="h-8 w-8 animate-spin text-gray-400 mb-3" />
                            <p className="text-sm text-gray-500">Loading execution steps...</p>
                          </div>
                        ) : executionSteps.length === 0 ? (
                          <div className="flex flex-col items-center justify-center py-12">
                            <Code2 className="h-12 w-12 text-gray-300 dark:text-gray-700 mb-3" />
                            <p className="text-gray-500 dark:text-gray-300 font-medium">No execution steps recorded</p>
                          </div>
                        ) : (
                          <div className="space-y-2">
                            {executionSteps.map((step, index) => (
                              <div
                                key={step.id}
                                className="border-2 rounded-lg overflow-hidden hover:border-gray-400 dark:hover:border-gray-600 transition-colors"
                              >
                                <div
                                  className="flex items-center justify-between p-4 bg-gradient-to-r from-gray-50 to-white dark:from-gray-800 dark:to-gray-900 cursor-pointer hover:from-gray-100 hover:to-gray-50 dark:hover:from-gray-700 dark:hover:to-gray-800 transition-all"
                                  onClick={() => toggleStepExpanded(step.id)}
                                >
                                  <div className="flex items-center gap-4 flex-1 min-w-0">
                                    <div className="flex items-center gap-3">
                                      <div className="w-8 h-8 rounded-full bg-white dark:bg-gray-700 border-2 border-gray-300 dark:border-gray-600 flex items-center justify-center">
                                        <span className="text-xs font-bold text-gray-700 dark:text-gray-300">
                                          {step.step_number}
                                        </span>
                                      </div>
                                      <div className="flex-shrink-0">
                                        {getIntegrationIcon(step.node_type)}
                                      </div>
                                      <div className="flex-shrink-0">
                                        {getStatusIcon(step.status)}
                                      </div>
                                    </div>

                                    <div className="flex-1 min-w-0">
                                      <div className="font-semibold text-gray-900 dark:text-gray-100 truncate">
                                        {formatNodeName(step.node_name, step.node_type)}
                                      </div>
                                      <div className="flex items-center gap-3 mt-0.5">
                                        <span className="text-xs text-gray-500 dark:text-gray-400">
                                          {formatDuration(step.duration_ms)}
                                        </span>
                                        {step.started_at && (
                                          <span className="text-xs text-gray-400 dark:text-gray-400">
                                            {format(new Date(step.started_at), 'HH:mm:ss')}
                                          </span>
                                        )}
                                      </div>
                                    </div>
                                  </div>

                                  <div className="flex items-center gap-3 flex-shrink-0">
                                    {step.test_mode_preview && (
                                      <Badge variant="outline" className="text-blue-600 dark:text-blue-400 border-blue-600 dark:border-blue-400">
                                        <TestTube className="h-3 w-3 mr-1" />
                                        Test Mode
                                      </Badge>
                                    )}
                                    {step.error_message && (
                                      <Badge variant="outline" className="text-red-600 dark:text-red-400 border-red-600 dark:border-red-400">
                                        <AlertCircle className="h-3 w-3 mr-1" />
                                        Error
                                      </Badge>
                                    )}
                                    {expandedSteps.has(step.id) ? (
                                      <ChevronDown className="h-5 w-5 text-gray-600 dark:text-gray-400" />
                                    ) : (
                                      <ChevronRight className="h-5 w-5 text-gray-600 dark:text-gray-400" />
                                    )}
                                  </div>
                                </div>

                                {expandedSteps.has(step.id) && (
                                  <div className="p-4 border-t-2 bg-white dark:bg-gray-950">
                                    {/* Display result message if available */}
                                    {step.output_data?.message && (
                                      <div className={cn(
                                        "mb-4 p-4 rounded-lg border-2",
                                        step.status === 'completed'
                                          ? "bg-green-50 dark:bg-green-900/20 border-green-300 dark:border-green-700"
                                          : "bg-blue-50 dark:bg-blue-900/20 border-blue-300 dark:border-blue-700"
                                      )}>
                                        <div className="flex items-start gap-3">
                                          <CheckCircle2 className={cn(
                                            "h-5 w-5 mt-0.5 flex-shrink-0",
                                            step.status === 'completed'
                                              ? "text-green-600 dark:text-green-400"
                                              : "text-blue-600 dark:text-blue-400"
                                          )} />
                                          <div className="flex-1">
                                            <div className={cn(
                                              "font-semibold text-sm mb-1",
                                              step.status === 'completed'
                                                ? "text-green-900 dark:text-green-100"
                                                : "text-blue-900 dark:text-blue-100"
                                            )}>
                                              Result
                                            </div>
                                            <div className={cn(
                                              "text-sm whitespace-pre-wrap",
                                              step.status === 'completed'
                                                ? "text-green-800 dark:text-green-200"
                                                : "text-blue-800 dark:text-blue-200"
                                            )}>
                                              {step.output_data.message}
                                            </div>
                                          </div>
                                        </div>
                                      </div>
                                    )}

                                    <Tabs defaultValue="output" className="w-full">
                                      <TabsList className="grid w-full grid-cols-4 bg-gray-100 dark:bg-gray-800">
                                        <TabsTrigger value="input" className="gap-2">
                                          <Code2 className="h-3.5 w-3.5" />
                                          Input
                                        </TabsTrigger>
                                        <TabsTrigger value="output" className="gap-2">
                                          <Terminal className="h-3.5 w-3.5" />
                                          Output
                                        </TabsTrigger>
                                        {step.test_mode_preview && (
                                          <TabsTrigger value="preview" className="gap-2">
                                            <Eye className="h-3.5 w-3.5" />
                                            Preview
                                          </TabsTrigger>
                                        )}
                                        {step.error_message && (
                                          <TabsTrigger value="error" className="gap-2">
                                            <AlertCircle className="h-3.5 w-3.5" />
                                            Error
                                          </TabsTrigger>
                                        )}
                                      </TabsList>

                                      <TabsContent value="input" className="mt-4">
                                        <pre className="text-xs bg-gray-50 dark:bg-gray-900 text-gray-900 dark:text-gray-100 p-4 rounded-lg overflow-auto max-h-96 border-2 border-gray-200 dark:border-gray-700 font-mono">
                                          {JSON.stringify(step.input_data, null, 2)}
                                        </pre>
                                      </TabsContent>

                                      <TabsContent value="output" className="mt-4">
                                        <pre className="text-xs bg-gray-50 dark:bg-gray-900 text-gray-900 dark:text-gray-100 p-4 rounded-lg overflow-auto max-h-96 border-2 border-gray-200 dark:border-gray-700 font-mono">
                                          {JSON.stringify(step.output_data, null, 2)}
                                        </pre>
                                      </TabsContent>

                                      {step.test_mode_preview && (
                                        <TabsContent value="preview" className="mt-4">
                                          <div className="mb-3 flex items-center gap-2 text-sm font-medium text-blue-700 dark:text-blue-300">
                                            <Eye className="h-4 w-4" />
                                            What would have been sent in production:
                                          </div>
                                          <pre className="text-xs bg-blue-50 dark:bg-blue-950 text-blue-900 dark:text-blue-100 p-4 rounded-lg overflow-auto max-h-96 border-2 border-blue-300 dark:border-blue-700 font-mono">
                                            {JSON.stringify(step.test_mode_preview, null, 2)}
                                          </pre>
                                        </TabsContent>
                                      )}

                                      {step.error_message && (
                                        <TabsContent value="error" className="mt-4">
                                          <div className="p-4 bg-red-50 dark:bg-red-950 border-2 border-red-300 dark:border-red-700 rounded-lg">
                                            <div className="flex items-start gap-3 mb-3">
                                              <XCircle className="h-5 w-5 text-red-600 dark:text-red-400 mt-0.5 flex-shrink-0" />
                                              <div className="flex-1">
                                                <div className="font-semibold text-sm text-red-900 dark:text-red-100 mb-1">
                                                  Error Message
                                                </div>
                                                <div className="text-sm text-red-700 dark:text-red-300">
                                                  {step.error_message}
                                                </div>
                                              </div>
                                            </div>
                                            {step.error_details && (
                                              <>
                                                <div className="text-xs font-medium text-red-900 dark:text-red-100 mb-2">
                                                  Error Details:
                                                </div>
                                                <pre className="text-xs bg-white dark:bg-red-900/20 text-red-900 dark:text-red-100 p-3 rounded overflow-auto max-h-80 border border-red-300 dark:border-red-700 font-mono">
                                                  {JSON.stringify(step.error_details, null, 2)}
                                                </pre>
                                              </>
                                            )}
                                          </div>
                                        </TabsContent>
                                      )}
                                    </Tabs>
                                  </div>
                                )}
                              </div>
                            ))}
                          </div>
                        )}
                      </CardContent>
                    </Card>
                  </div>
                )}
              </ScrollArea>
            </TabsContent>
          </Tabs>
        </div>
      </DialogContent>

      <AlertDialog open={retryConfirmOpen} onOpenChange={setRetryConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Retry this execution?</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-3">
                <p>
                  Retry reruns the workflow from the beginning using the original
                  trigger data. Any actions that already succeeded may run again.
                </p>
                {hasPaymentImpactingStep && (
                  <div className="rounded-md border-2 border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-900/20 p-3 text-amber-900 dark:text-amber-100 text-sm">
                    <div className="flex items-start gap-2">
                      <AlertCircle className="h-4 w-4 mt-0.5 flex-shrink-0" />
                      <div>
                        <strong className="font-semibold">Payment-impacting actions detected.</strong>{" "}
                        This workflow includes Stripe / Shopify / payment steps.
                        Retrying may charge customers, create duplicate orders,
                        or fire other irreversible side effects.
                      </div>
                    </div>
                  </div>
                )}
                <p className="text-xs text-muted-foreground">
                  A new execution session will be created and counted toward your
                  task usage. The original failed execution is not modified.
                </p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={retrying}>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleRetry} disabled={retrying}>
              {retrying ? (
                <>
                  <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
                  Retrying...
                </>
              ) : (
                <>
                  <RotateCcw className="h-4 w-4 mr-2" />
                  Retry execution
                </>
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Dialog>
  )
}
