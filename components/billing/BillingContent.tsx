"use client"

import { useEffect, useState, useCallback, useRef } from "react"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import {
  Receipt,
  RefreshCw,
  ChevronDown,
  Zap,
  Bot,
  RotateCcw,
  ArrowRight,
  Loader2,
  Inbox,
  AlertCircle,
  Filter,
} from "lucide-react"
import { fetchWithTimeout } from "@/lib/utils/fetch-with-timeout"
import { logger } from "@/lib/utils/logger"

interface BillingEvent {
  id: string
  createdAt: string
  eventType: string
  source: string
  tasksCharged: number
  balanceAfter: number
  tasksLimit: number
  workflowId: string | null
  workflowName: string | null
  executionId: string | null
  isRetry: boolean
  originalExecutionId: string | null
  nodeBreakdown: Record<string, number> | null
  metadata: {
    flatCost: number | null
    chargedCost: number | null
    loopExpansionEnabled: boolean | null
    loopDetails: any[]
    mode: string | null
  }
}

interface BillingContentProps {
  isModal?: boolean
}

const SOURCE_OPTIONS = [
  { value: "", label: "All sources" },
  { value: "execution", label: "Executions" },
  { value: "retry", label: "Retries" },
  { value: "ai_creation", label: "AI Creation" },
  { value: "reset", label: "Resets" },
]

function getSourceIcon(source: string) {
  switch (source) {
    case "execution": return <Zap className="w-3.5 h-3.5" />
    case "ai_creation": return <Bot className="w-3.5 h-3.5" />
    case "retry": return <RotateCcw className="w-3.5 h-3.5" />
    case "reset": return <RefreshCw className="w-3.5 h-3.5" />
    default: return <Receipt className="w-3.5 h-3.5" />
  }
}

function getSourceBadge(source: string) {
  const styles: Record<string, string> = {
    execution: "bg-blue-100 text-blue-700 border-blue-200 dark:bg-blue-500/20 dark:text-blue-400 dark:border-blue-500/30",
    ai_creation: "bg-purple-100 text-purple-700 border-purple-200 dark:bg-purple-500/20 dark:text-purple-400 dark:border-purple-500/30",
    retry: "bg-amber-100 text-amber-700 border-amber-200 dark:bg-amber-500/20 dark:text-amber-400 dark:border-amber-500/30",
    reset: "bg-green-100 text-green-700 border-green-200 dark:bg-green-500/20 dark:text-green-400 dark:border-green-500/30",
  }
  const labels: Record<string, string> = {
    execution: "Execution",
    ai_creation: "AI Creation",
    retry: "Retry",
    reset: "Reset",
  }
  return (
    <Badge variant="outline" className={`text-xs ${styles[source] || "bg-gray-100 text-gray-700 border-gray-200 dark:bg-gray-800 dark:text-gray-400 dark:border-gray-700"}`}>
      <span className="flex items-center gap-1">
        {getSourceIcon(source)}
        {labels[source] || source}
      </span>
    </Badge>
  )
}

function formatDate(dateStr: string) {
  const date = new Date(dateStr)
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  })
}

function formatTime(dateStr: string) {
  const date = new Date(dateStr)
  return date.toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  })
}

export default function BillingContent({ isModal = false }: BillingContentProps) {
  const [events, setEvents] = useState<BillingEvent[]>([])
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [nextCursor, setNextCursor] = useState<string | null>(null)
  const [hasMore, setHasMore] = useState(false)
  const [sourceFilter, setSourceFilter] = useState("")
  const hasFetchedRef = useRef(false)

  const fetchHistory = useCallback(async (cursor?: string | null, append = false) => {
    try {
      if (!append) setLoading(true)
      else setLoadingMore(true)
      setError(null)

      const params = new URLSearchParams()
      params.set("limit", "25")
      if (cursor) params.set("cursor", cursor)
      if (sourceFilter) params.set("source", sourceFilter)

      const response = await fetchWithTimeout(`/api/billing/task-history?${params.toString()}`)
      if (!response.ok) throw new Error("Failed to fetch payment history")

      const data = await response.json()

      if (append) {
        setEvents(prev => [...prev, ...data.events])
      } else {
        setEvents(data.events)
      }
      setNextCursor(data.nextCursor)
      setHasMore(data.hasMore)
    } catch (err: any) {
      logger.error("[PaymentHistory] Fetch error:", err)
      setError(err.message || "Failed to load payment history")
    } finally {
      setLoading(false)
      setLoadingMore(false)
    }
  }, [sourceFilter])

  useEffect(() => {
    if (!hasFetchedRef.current) {
      hasFetchedRef.current = true
      fetchHistory()
    }
  }, [fetchHistory])

  // Re-fetch when filter changes (skip initial)
  const isFirstRender = useRef(true)
  useEffect(() => {
    if (isFirstRender.current) {
      isFirstRender.current = false
      return
    }
    hasFetchedRef.current = true
    fetchHistory()
  }, [sourceFilter, fetchHistory])

  if (isModal) return null

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900 dark:text-gray-100">Payments</h1>
          <p className="text-sm text-gray-500 dark:text-gray-200 mt-1">
            Task usage history and billing events
          </p>
        </div>
        <Button
          onClick={() => fetchHistory()}
          variant="outline"
          size="sm"
          disabled={loading}
          className="gap-2"
        >
          <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
          Refresh
        </Button>
      </div>

      {/* Filter */}
      <div className="flex items-center gap-3">
        <div className="flex items-center gap-2 text-sm text-gray-500 dark:text-gray-400">
          <Filter className="w-4 h-4" />
          Filter:
        </div>
        <select
          value={sourceFilter}
          onChange={(e) => setSourceFilter(e.target.value)}
          aria-label="Filter payments by source"
          className="text-sm border border-gray-200 dark:border-gray-700 rounded-lg px-3 py-1.5 bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-orange-500"
        >
          {SOURCE_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>{opt.label}</option>
          ))}
        </select>
      </div>

      {/* Error State */}
      {error && (
        <Card className="bg-red-50 dark:bg-red-950/20 border-red-200 dark:border-red-900/50">
          <CardContent className="pt-6 flex items-center gap-3">
            <AlertCircle className="w-5 h-5 text-red-500 shrink-0" />
            <span className="text-sm text-red-700 dark:text-red-400">{error}</span>
            <Button onClick={() => fetchHistory()} variant="outline" size="sm" className="ml-auto shrink-0">
              Retry
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Loading State */}
      {loading && !error && (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="w-6 h-6 animate-spin text-orange-500" />
        </div>
      )}

      {/* Payment History Table */}
      {!loading && !error && (
        <div className="bg-white dark:bg-gray-900/50 rounded-xl border border-gray-200 dark:border-gray-700/50 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-200 dark:border-gray-700">
                  <th className="text-left px-5 py-3 text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Date</th>
                  <th className="text-left px-5 py-3 text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Source</th>
                  <th className="text-left px-5 py-3 text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Workflow</th>
                  <th className="text-right px-5 py-3 text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Tasks</th>
                  <th className="text-right px-5 py-3 text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Balance</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                {events.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="px-5 py-12 text-center">
                      <Inbox className="w-10 h-10 text-gray-300 dark:text-gray-600 mx-auto mb-3" />
                      <p className="text-sm font-medium text-gray-900 dark:text-gray-100 mb-1">No payment history yet</p>
                      <p className="text-xs text-gray-500 dark:text-gray-200">
                        {sourceFilter ? "No events match this filter. Try a different source." : "Run a workflow to see your task usage here."}
                      </p>
                    </td>
                  </tr>
                ) : (
                  events.map((event) => (
                    <tr key={event.id} className="hover:bg-gray-50 dark:hover:bg-gray-800/30 transition-colors">
                      <td className="px-5 py-3.5">
                        <div className="text-gray-900 dark:text-gray-100">{formatDate(event.createdAt)}</div>
                        <div className="text-xs text-gray-500 dark:text-gray-400">{formatTime(event.createdAt)}</div>
                      </td>
                      <td className="px-5 py-3.5">
                        <div className="flex items-center gap-2">
                          {getSourceBadge(event.source)}
                          {event.isRetry && (
                            <span className="text-[10px] text-amber-600 dark:text-amber-400 font-medium">RETRY</span>
                          )}
                        </div>
                      </td>
                      <td className="px-5 py-3.5">
                        {event.workflowName ? (
                          <span className="text-gray-900 dark:text-gray-100 truncate block max-w-[200px]" title={event.workflowName}>
                            {event.workflowName}
                          </span>
                        ) : (
                          <span className="text-gray-400 dark:text-gray-600">-</span>
                        )}
                      </td>
                      <td className="px-5 py-3.5 text-right">
                        <span className={`font-medium ${
                          event.source === "reset"
                            ? "text-green-600 dark:text-green-400"
                            : "text-gray-900 dark:text-gray-100"
                        }`}>
                          {event.source === "reset" ? "" : "-"}{event.tasksCharged}
                        </span>
                      </td>
                      <td className="px-5 py-3.5 text-right">
                        <span className="text-gray-500 dark:text-gray-200">
                          {event.balanceAfter?.toLocaleString() ?? "-"} / {event.tasksLimit?.toLocaleString() ?? "-"}
                        </span>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          {/* Load More */}
          {hasMore && (
            <div className="border-t border-gray-200 dark:border-gray-700 px-5 py-3 text-center">
              <Button
                onClick={() => fetchHistory(nextCursor, true)}
                variant="ghost"
                size="sm"
                disabled={loadingMore}
                className="gap-2 text-gray-600 dark:text-gray-400"
              >
                {loadingMore ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <ChevronDown className="w-4 h-4" />
                )}
                Load more
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
