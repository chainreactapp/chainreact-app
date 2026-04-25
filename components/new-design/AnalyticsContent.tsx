"use client"

import { useEffect, useState, useCallback } from "react"
import { Card, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  TrendingUp,
  TrendingDown,
  Zap,
  CheckCircle2,
  XCircle,
  Clock,
  Activity,
  AlertCircle,
  RefreshCw,
  BarChart3,
  Workflow,
  Calendar,
  Download,
} from "lucide-react"
import { useAnalyticsStore } from "@/stores/analyticsStore"
import { formatDistanceToNow } from "date-fns"
import Link from "next/link"

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatDuration(ms: number | null): string {
  if (ms === null || ms === undefined) return "-"
  if (ms < 1000) return `${ms}ms`
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`
  return `${(ms / 60000).toFixed(1)}m`
}

function exportToCSV(filename: string, headers: string[], rows: string[][]) {
  const csvContent = [
    headers.join(","),
    ...rows.map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(",")),
  ].join("\n")
  const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" })
  const url = URL.createObjectURL(blob)
  const link = document.createElement("a")
  link.href = url
  link.download = `${filename}.csv`
  link.click()
  URL.revokeObjectURL(url)
}

type AnalyticsTab = "overview" | "executions" | "workflows" | "failures"

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function MetricTile({
  label,
  value,
  icon: Icon,
  trend,
  color,
  loading,
}: {
  label: string
  value: string | number
  icon: React.ElementType
  trend?: { direction: "up" | "down" | "neutral"; text: string }
  color: string
  loading?: boolean
}) {
  if (loading) {
    return (
      <div className="flex items-center gap-4 p-4 rounded-xl border bg-card">
        <Skeleton className="w-11 h-11 rounded-xl" />
        <div className="space-y-1.5 flex-1">
          <Skeleton className="h-3 w-20" />
          <Skeleton className="h-7 w-16" />
        </div>
      </div>
    )
  }

  const trendColor =
    trend?.direction === "up"
      ? "text-green-600 dark:text-green-400"
      : trend?.direction === "down"
        ? "text-red-600 dark:text-red-400"
        : "text-muted-foreground"

  return (
    <div className="flex items-center gap-4 p-4 rounded-xl border bg-card hover:shadow-md transition-all duration-200">
      <div className={`w-11 h-11 rounded-xl ${color} flex items-center justify-center flex-shrink-0`}>
        <Icon className="w-5 h-5 text-white" />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">{label}</p>
        <div className="flex items-baseline gap-2">
          <span className="text-2xl font-bold tracking-tight">{value}</span>
          {trend && (
            <span className={`text-xs font-medium flex items-center gap-0.5 ${trendColor}`}>
              {trend.direction === "up" ? <TrendingUp className="w-3 h-3" /> : trend.direction === "down" ? <TrendingDown className="w-3 h-3" /> : null}
              {trend.text}
            </span>
          )}
        </div>
      </div>
    </div>
  )
}

function BarChart({
  data,
  valueKey,
  labelKey,
  secondaryKey,
  loading,
  emptyMessage = "No data available",
  barColor = "bg-primary",
  secondaryColor = "bg-red-500",
  showLegend,
  legendLabels,
  height = "h-[240px]",
}: {
  data: any[]
  valueKey: string
  labelKey: string
  secondaryKey?: string
  loading?: boolean
  emptyMessage?: string
  barColor?: string
  secondaryColor?: string
  showLegend?: boolean
  legendLabels?: { primary: string; secondary: string }
  height?: string
}) {
  if (loading) {
    return (
      <div className={`flex items-end gap-2 ${height}`}>
        {Array.from({ length: 7 }).map((_, i) => (
          <div key={i} className="flex-1 flex flex-col justify-end h-full">
            <Skeleton className="w-full" style={{ height: `${30 + Math.random() * 50}%` }} />
          </div>
        ))}
      </div>
    )
  }

  if (data.length === 0) {
    return (
      <div className={`flex flex-col items-center justify-center ${height} text-muted-foreground`}>
        <BarChart3 className="w-10 h-10 mb-2 opacity-30" />
        <p className="text-sm">{emptyMessage}</p>
      </div>
    )
  }

  const maxVal = Math.max(
    ...data.map((d) => {
      const primary = Number(d[valueKey]) || 0
      const secondary = secondaryKey ? Number(d[secondaryKey]) || 0 : 0
      return primary + secondary
    }),
    1,
  )

  return (
    <div>
      <div className={`flex items-end gap-1.5 ${height}`}>
        {data.map((item, i) => {
          const primary = Number(item[valueKey]) || 0
          const secondary = secondaryKey ? Number(item[secondaryKey]) || 0 : 0
          const primaryPct = (primary / maxVal) * 100
          const secondaryPct = (secondary / maxVal) * 100
          const label = item[labelKey] || ""

          return (
            <div key={i} className="flex-1 flex flex-col items-center gap-1 h-full justify-end min-w-0 group">
              <span className="text-[10px] font-medium text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity tabular-nums">
                {secondaryKey ? `${primary} / ${secondary}` : primary}
              </span>
              <div className="w-full flex flex-col justify-end flex-1 rounded-t overflow-hidden bg-muted/30">
                {secondaryKey && secondary > 0 && (
                  <div
                    className={`w-full ${secondaryColor} opacity-80 transition-all duration-500`}
                    style={{ height: `${secondaryPct}%`, minHeight: secondary > 0 ? "2px" : "0" }}
                  />
                )}
                {primary > 0 && (
                  <div
                    className={`w-full ${barColor} opacity-90 transition-all duration-500`}
                    style={{ height: `${primaryPct}%`, minHeight: "2px" }}
                  />
                )}
              </div>
              <span className="text-[10px] text-muted-foreground truncate w-full text-center">{label}</span>
            </div>
          )
        })}
      </div>
      {showLegend && legendLabels && (
        <div className="flex items-center justify-center gap-5 mt-3 text-xs text-muted-foreground">
          <div className="flex items-center gap-1.5">
            <div className={`w-2.5 h-2.5 rounded-sm ${barColor}`} />
            {legendLabels.primary}
          </div>
          <div className="flex items-center gap-1.5">
            <div className={`w-2.5 h-2.5 rounded-sm ${secondaryColor}`} />
            {legendLabels.secondary}
          </div>
        </div>
      )}
    </div>
  )
}

function HorizontalBarList({
  items,
  loading,
  emptyMessage = "No data",
  max = 5,
}: {
  items: { label: string; value: number; href?: string; badge?: string }[]
  loading?: boolean
  emptyMessage?: string
  max?: number
}) {
  if (loading) {
    return (
      <div className="space-y-3">
        {Array.from({ length: max }).map((_, i) => (
          <div key={i} className="flex items-center gap-3">
            <Skeleton className="h-4 flex-1" />
            <Skeleton className="h-4 w-12" />
          </div>
        ))}
      </div>
    )
  }

  if (items.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center min-h-[120px]">
        <p className="text-sm text-muted-foreground text-center">{emptyMessage}</p>
      </div>
    )
  }

  const maxValue = Math.max(...items.map((i) => i.value), 1)

  return (
    <div className="space-y-2.5">
      {items.slice(0, max).map((item, i) => {
        const pct = (item.value / maxValue) * 100
        return (
          <div key={i} className="group">
            <div className="flex items-center justify-between mb-1">
              <div className="flex items-center gap-2 flex-1 min-w-0">
                <span className="text-xs font-medium text-muted-foreground w-4">{i + 1}</span>
                {item.href ? (
                  <Link href={item.href} className="text-sm font-medium truncate hover:text-primary transition-colors">
                    {item.label}
                  </Link>
                ) : (
                  <span className="text-sm font-medium truncate">{item.label}</span>
                )}
              </div>
              <div className="flex items-center gap-2 flex-shrink-0">
                {item.badge && (
                  <Badge variant="outline" className="text-[10px] px-1.5 py-0">
                    {item.badge}
                  </Badge>
                )}
                <span className="text-sm font-semibold tabular-nums">{item.value}</span>
              </div>
            </div>
            <div className="h-1.5 rounded-full bg-muted overflow-hidden">
              <div
                className="h-full rounded-full bg-primary/70 transition-all duration-700"
                style={{ width: `${pct}%` }}
              />
            </div>
          </div>
        )
      })}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Tab Views
// ---------------------------------------------------------------------------

function OverviewView({
  overview,
  dailyStats,
  statusBreakdown,
  loading,
}: {
  overview: any
  dailyStats: any[]
  statusBreakdown: any[]
  loading: boolean
}) {
  const chartData = dailyStats.slice(-7).map((d) => ({
    ...d,
    successful: Math.max(0, Math.min(Number(d.executions) || 0, Number(d.successful ?? d.completed ?? d.success) || 0)),
    failed: Math.max(0, Number(d.failed ?? d.errors ?? d.error) || 0),
    label: d.dayName || d.date || "",
  }))

  return (
    <div className="h-full flex flex-col gap-5">
      {/* Metrics row */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <div className="animate-fade-in-up" style={{ animationDelay: "0ms", animationFillMode: "both" }}>
          <MetricTile label="Total Runs" value={overview?.total?.toLocaleString() || "0"} icon={Zap} color="bg-blue-500" loading={loading} />
        </div>
        <div className="animate-fade-in-up" style={{ animationDelay: "50ms", animationFillMode: "both" }}>
          <MetricTile
            label="Success Rate"
            value={`${overview?.successRate || 0}%`}
            icon={CheckCircle2}
            color="bg-green-500"
            loading={loading}
            trend={
              overview?.successRate
                ? {
                    direction: overview.successRate >= 90 ? "up" : overview.successRate >= 70 ? "neutral" : "down",
                    text: overview.successRate >= 90 ? "Healthy" : overview.successRate >= 70 ? "Fair" : "Low",
                  }
                : undefined
            }
          />
        </div>
        <div className="animate-fade-in-up" style={{ animationDelay: "100ms", animationFillMode: "both" }}>
          <MetricTile label="Failed Runs" value={overview?.failed?.toLocaleString() || "0"} icon={XCircle} color="bg-red-500" loading={loading} />
        </div>
        <div className="animate-fade-in-up" style={{ animationDelay: "150ms", animationFillMode: "both" }}>
          <MetricTile label="Avg. Duration" value={formatDuration(overview?.avgExecutionTimeMs || 0)} icon={Clock} color="bg-purple-500" loading={loading} />
        </div>
      </div>

      {/* Chart row */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 flex-1 min-h-0">
        <Card className="lg:col-span-2 flex flex-col animate-fade-in-up" style={{ animationDelay: "200ms", animationFillMode: "both" }}>
          <div className="px-5 pt-4 pb-2 flex items-center justify-between">
            <div>
              <h3 className="text-sm font-semibold">Daily Executions</h3>
              <p className="text-xs text-muted-foreground">Successful vs failed runs over the last 7 days</p>
            </div>
          </div>
          <CardContent className="flex-1 min-h-0 pb-4">
            <BarChart
              data={chartData}
              valueKey="successful"
              secondaryKey="failed"
              labelKey="label"
              loading={loading}
              emptyMessage="Run some workflows to see execution data"
              barColor="bg-green-500"
              secondaryColor="bg-red-500"
              showLegend
              legendLabels={{ primary: "Successful", secondary: "Failed" }}
              height="h-[200px]"
            />
          </CardContent>
        </Card>

        <Card className="flex flex-col animate-fade-in-up" style={{ animationDelay: "250ms", animationFillMode: "both" }}>
          <div className="px-5 pt-4 pb-2">
            <h3 className="text-sm font-semibold">Status Distribution</h3>
            <p className="text-xs text-muted-foreground">Breakdown of all execution outcomes</p>
          </div>
          <CardContent className="flex-1 pb-4 flex flex-col">
            {loading ? (
              <Skeleton className="h-full w-full rounded-lg" />
            ) : statusBreakdown.length === 0 ? (
              <div className="flex-1 flex items-center justify-center">
                <p className="text-sm text-muted-foreground">No data yet</p>
              </div>
            ) : (
              <div className="flex flex-col flex-1 gap-4">
                {/* Progress bar */}
                <div className="h-3 rounded-full overflow-hidden bg-muted flex flex-shrink-0">
                  {statusBreakdown.map((item) => {
                    const total = statusBreakdown.reduce((s, i) => s + (i.value || 0), 0)
                    const pct = total > 0 ? (item.value / total) * 100 : 0
                    const color =
                      item.key === "completed" ? "bg-green-500" : item.key === "failed" ? "bg-red-500" : item.key === "running" ? "bg-blue-500" : "bg-slate-400"
                    return <div key={item.key} className={color} style={{ width: `${pct}%` }} />
                  })}
                </div>
                {/* Legend — distribute evenly to fill remaining height */}
                <div className="flex flex-col flex-1 justify-between">
                  {statusBreakdown.map((item) => {
                    const total = statusBreakdown.reduce((s, i) => s + (i.value || 0), 0)
                    const pct = total > 0 ? ((item.value / total) * 100).toFixed(0) : "0"
                    const dotColor =
                      item.key === "completed" ? "bg-green-500" : item.key === "failed" ? "bg-red-500" : item.key === "running" ? "bg-blue-500" : "bg-slate-400"
                    return (
                      <div key={item.key} className="flex items-center justify-between text-sm">
                        <div className="flex items-center gap-2">
                          <div className={`w-2.5 h-2.5 rounded-full ${dotColor}`} />
                          <span className="text-muted-foreground">{item.label}</span>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="font-semibold tabular-nums">{item.value}</span>
                          <span className="text-muted-foreground text-xs w-8 text-right">{pct}%</span>
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}

function ExecutionsView({
  recentExecutions,
  loading,
}: {
  recentExecutions: any[]
  loading: boolean
}) {
  const getStatusStyles = (status: string) => {
    switch (status) {
      case "completed":
        return { dot: "bg-green-500", badge: "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400", label: "Success" }
      case "failed":
        return { dot: "bg-red-500", badge: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400", label: "Failed" }
      case "running":
        return { dot: "bg-blue-500 animate-pulse", badge: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400", label: "Running" }
      case "cancelled":
        return { dot: "bg-gray-400", badge: "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-400", label: "Cancelled" }
      default:
        return { dot: "bg-gray-400", badge: "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300", label: status }
    }
  }

  return (
    <div className="h-full flex flex-col">
      <div className="mb-4">
        <h3 className="text-sm font-semibold">Recent Workflow Executions</h3>
        <p className="text-xs text-muted-foreground">{recentExecutions.length} executions in this period</p>
      </div>

      {loading ? (
        <div className="space-y-3 flex-1">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="flex items-center gap-3 p-3 rounded-lg border">
              <Skeleton className="w-2 h-2 rounded-full" />
              <Skeleton className="h-4 flex-1" />
              <Skeleton className="h-5 w-16" />
              <Skeleton className="h-5 w-20" />
            </div>
          ))}
        </div>
      ) : recentExecutions.length === 0 ? (
        <div className="flex-1 flex flex-col">
          {/* Table header */}
          <div className="flex items-center gap-3 px-3 py-2 border-b text-xs font-medium text-muted-foreground uppercase tracking-wider">
            <div className="w-2" />
            <div className="flex-1">Workflow</div>
            <div className="w-20 text-right">Duration</div>
            <div className="w-20 text-center">Status</div>
          </div>
          {/* Empty state message — directly below headers */}
          <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
            <Activity className="w-10 h-10 mb-2 opacity-30" />
            <p className="font-medium text-sm">No executions yet</p>
            <p className="text-xs">Run a workflow to see execution history</p>
          </div>
        </div>
      ) : (
        <div className="flex-1 flex flex-col overflow-hidden">
          {/* Table header */}
          <div className="flex items-center gap-3 px-3 py-2 border-b text-xs font-medium text-muted-foreground uppercase tracking-wider flex-shrink-0">
            <div className="w-2" />
            <div className="flex-1">Workflow</div>
            <div className="w-20 text-right">Duration</div>
            <div className="w-20 text-center">Status</div>
          </div>
          {/* Rows */}
          <div className="flex-1 overflow-y-auto space-y-0 pr-1">
            {recentExecutions.slice(0, 15).map((exec, i) => {
              const styles = getStatusStyles(exec.status)
              return (
                <div
                  key={exec.id}
                  className="flex items-center gap-3 px-3 py-3 border-b hover:bg-muted/50 transition-colors animate-fade-in-up"
                  style={{ animationDelay: `${i * 40}ms`, animationFillMode: "both" }}
                >
                  <div className={`w-2 h-2 rounded-full flex-shrink-0 ${styles.dot}`} />
                  <div className="flex-1 min-w-0">
                    <Link href={`/workflows/builder/${exec.workflowId}`} className="text-sm font-medium truncate block hover:text-primary transition-colors">
                      {exec.workflowName}
                    </Link>
                    <p className="text-[11px] text-muted-foreground">{formatDistanceToNow(new Date(exec.startedAt), { addSuffix: true })}</p>
                  </div>
                  <span className="text-xs text-muted-foreground tabular-nums flex-shrink-0 w-20 text-right">
                    {exec.durationMs !== null ? formatDuration(exec.durationMs) : "-"}
                  </span>
                  <div className="w-20 flex justify-center">
                    <Badge className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${styles.badge}`}>{styles.label}</Badge>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}

function WorkflowsView({
  topWorkflows,
  dailyStats,
  loading,
}: {
  topWorkflows: any[]
  dailyStats: any[]
  loading: boolean
}) {
  const volumeData = dailyStats.slice(-7).map((d) => ({
    value: Number(d.executions) || 0,
    label: d.dayName || d.date || "",
  }))

  return (
    <div className="h-full flex flex-col gap-5">
      <div>
        <h3 className="text-sm font-semibold">Workflow Performance</h3>
        <p className="text-xs text-muted-foreground">Top workflows ranked by execution count</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 flex-1 min-h-0">
        <Card className="flex flex-col">
          <div className="px-5 pt-4 pb-2">
            <h4 className="text-sm font-semibold">Top Workflows by Runs</h4>
          </div>
          <CardContent className="flex-1 pb-4 flex flex-col">
            <HorizontalBarList
              items={topWorkflows.map((w) => ({
                label: w.workflowName,
                value: w.totalExecutions,
                href: `/workflows/builder/${w.workflowId}`,
                badge: `${w.successRate}%`,
              }))}
              loading={loading}
              emptyMessage="No workflows executed yet"
            />
          </CardContent>
        </Card>

        <Card className="flex flex-col">
          <div className="px-5 pt-4 pb-2">
            <h4 className="text-sm font-semibold">Execution Volume (7 day)</h4>
          </div>
          <CardContent className="flex-1 pb-4">
            <BarChart
              data={volumeData}
              valueKey="value"
              labelKey="label"
              loading={loading}
              emptyMessage="No execution data"
              barColor="bg-blue-500"
              height="h-[200px]"
            />
          </CardContent>
        </Card>
      </div>
    </div>
  )
}

function FailuresView({
  topFailingWorkflows,
  failureReasons,
  dailyStats,
  loading,
}: {
  topFailingWorkflows: any[]
  failureReasons: any[]
  dailyStats: any[]
  loading: boolean
}) {
  const failureData = dailyStats.slice(-7).map((d) => ({
    value: Number(d.failed ?? d.errors ?? d.error) || 0,
    label: d.dayName || d.date || "",
  }))

  return (
    <div className="h-full flex flex-col gap-5">
      <div>
        <h3 className="text-sm font-semibold">Failure Analysis</h3>
        <p className="text-xs text-muted-foreground">Identify and resolve workflow issues</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 flex-1 min-h-0">
        <Card className="flex flex-col">
          <div className="px-5 pt-4 pb-2">
            <h4 className="text-sm font-semibold">Failure Trend (7 day)</h4>
          </div>
          <CardContent className="flex-1 pb-4">
            <BarChart
              data={failureData}
              valueKey="value"
              labelKey="label"
              loading={loading}
              emptyMessage="No failures — great!"
              barColor="bg-red-500"
              height="h-[200px]"
            />
          </CardContent>
        </Card>

        <Card className="flex flex-col">
          <div className="px-5 pt-4 pb-2">
            <h4 className="text-sm font-semibold">Most Failing Workflows</h4>
          </div>
          <CardContent className="flex-1 pb-4 flex flex-col">
            <HorizontalBarList
              items={topFailingWorkflows.map((w) => ({
                label: w.workflowName,
                value: w.failedExecutions,
                href: `/workflows/builder/${w.workflowId}`,
              }))}
              loading={loading}
              emptyMessage="No failures in this period"
            />
          </CardContent>
        </Card>

        <Card className="flex flex-col">
          <div className="px-5 pt-4 pb-2">
            <h4 className="text-sm font-semibold">Common Error Types</h4>
          </div>
          <CardContent className="flex-1 pb-4 flex flex-col">
            {loading ? (
              <div className="space-y-3">
                {Array.from({ length: 4 }).map((_, i) => (
                  <Skeleton key={i} className="h-4 w-full" />
                ))}
              </div>
            ) : failureReasons.length === 0 ? (
              <div className="flex-1 flex items-center justify-center min-h-[120px]">
                <p className="text-sm text-muted-foreground text-center">No errors recorded</p>
              </div>
            ) : (
              <div className="space-y-3">
                {failureReasons.slice(0, 6).map((item: any, i: number) => (
                  <div key={i} className="flex items-start gap-2 text-sm">
                    <AlertCircle className="w-3.5 h-3.5 text-red-500 mt-0.5 flex-shrink-0" />
                    <div className="flex-1 min-w-0">
                      <p className="text-muted-foreground truncate text-xs">{item.reason}</p>
                    </div>
                    <Badge variant="outline" className="text-[10px] flex-shrink-0">{item.count}</Badge>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Main Component
// ---------------------------------------------------------------------------

export function AnalyticsContent() {
  const {
    dashboard,
    dashboardLoading,
    dashboardError,
    selectedPeriod,
    fetchDashboard,
    setSelectedPeriod,
  } = useAnalyticsStore()
  const [activeTab, setActiveTab] = useState<AnalyticsTab>("overview")

  useEffect(() => {
    fetchDashboard()
  }, [fetchDashboard])

  const overview = dashboard?.overview
  const dailyStats = dashboard?.dailyStats ?? []
  const topWorkflows = dashboard?.topWorkflows ?? []
  const recentExecutions = dashboard?.recentExecutions ?? []
  const statusBreakdown = dashboard?.statusBreakdown ?? []
  const topFailingWorkflows = dashboard?.topFailingWorkflows ?? []
  const failureReasons = dashboard?.failureReasons ?? []

  const handleExportExecutions = useCallback(() => {
    exportToCSV(
      `executions-${new Date().toISOString().slice(0, 10)}`,
      ["Workflow", "Status", "Duration", "Started At"],
      recentExecutions.map((e: any) => [e.workflowName, e.status, formatDuration(e.durationMs), new Date(e.startedAt).toISOString()]),
    )
  }, [recentExecutions])

  const handleExportWorkflows = useCallback(() => {
    exportToCSV(
      `workflows-${new Date().toISOString().slice(0, 10)}`,
      ["Workflow", "Executions", "Success Rate"],
      topWorkflows.map((w: any) => [w.workflowName, String(w.totalExecutions), `${w.successRate}%`]),
    )
  }, [topWorkflows])

  const handleExportFailures = useCallback(() => {
    exportToCSV(
      `failures-${new Date().toISOString().slice(0, 10)}`,
      ["Workflow", "Failed Executions"],
      topFailingWorkflows.map((w: any) => [w.workflowName, String(w.failedExecutions)]),
    )
  }, [topFailingWorkflows])

  const handleExportOverview = useCallback(() => {
    const rows = dailyStats.map((d: any) => [
      d.dayName || d.date || "",
      String(Number(d.executions) || 0),
      String(Number(d.successful ?? d.completed ?? d.success) || 0),
      String(Number(d.failed ?? d.errors ?? d.error) || 0),
    ])
    exportToCSV(`overview-${new Date().toISOString().slice(0, 10)}`, ["Day", "Executions", "Successful", "Failed"], rows)
  }, [dailyStats])

  const currentExportHandler =
    activeTab === "overview" ? handleExportOverview
    : activeTab === "executions" ? handleExportExecutions
    : activeTab === "workflows" ? handleExportWorkflows
    : handleExportFailures

  const tabs: { id: AnalyticsTab; label: string; icon: React.ElementType }[] = [
    { id: "overview", label: "Overview", icon: BarChart3 },
    { id: "executions", label: "Executions", icon: Activity },
    { id: "workflows", label: "Workflows", icon: Workflow },
    { id: "failures", label: "Failures", icon: AlertCircle },
  ]

  const tabDescriptions: Record<AnalyticsTab, string> = {
    overview: "A snapshot of your workflow performance across all metrics.",
    executions: "Detailed log of every workflow run in this period.",
    workflows: "Compare individual workflow performance and volume.",
    failures: "Identify issues and debug failing workflows.",
  }

  const failureCount = dashboard?.topFailingWorkflows?.length ?? 0

  return (
    <div className="h-full flex flex-col">
      {/* Page header */}
      <div className="flex-shrink-0 animate-fade-in-down">
        <div className="flex items-start justify-between gap-4 mb-5">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Analytics</h1>
            <p className="text-sm text-muted-foreground mt-0.5">{tabDescriptions[activeTab]}</p>
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            <Select value={selectedPeriod.toString()} onValueChange={(v) => setSelectedPeriod(parseInt(v, 10))}>
              <SelectTrigger className="w-[170px] h-9 text-sm sm:text-sm rounded-lg" aria-label="Time period">
                <Calendar className="w-3.5 h-3.5 mr-1.5 text-muted-foreground" />
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="7">Last 7 days</SelectItem>
                <SelectItem value="14">Last 14 days</SelectItem>
                <SelectItem value="30">Last 30 days</SelectItem>
                <SelectItem value="90">Last 90 days</SelectItem>
                <SelectItem value="0">All time</SelectItem>
              </SelectContent>
            </Select>
            <Button
              variant="outline"
              size="sm"
              onClick={currentExportHandler}
              className="h-9 gap-1.5 rounded-lg text-sm"
            >
              <Download className="w-3.5 h-3.5" />
              Export
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => fetchDashboard()}
              disabled={dashboardLoading}
              className="h-9 w-9 p-0 rounded-lg"
              aria-label="Refresh analytics"
            >
              <RefreshCw className={`w-4 h-4 ${dashboardLoading ? "animate-spin" : ""}`} />
            </Button>
          </div>
        </div>

        {/* Full-width tab navigation */}
        <div className="border-b -mx-6 px-6">
          <nav className="flex w-full" aria-label="Analytics views">
            {tabs.map((tab) => {
              const Icon = tab.icon
              const isActive = activeTab === tab.id
              return (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  className={`relative flex-1 flex items-center justify-center gap-2 py-3 text-sm font-medium transition-colors duration-200 border-b-2 -mb-px ${
                    isActive
                      ? "border-foreground text-foreground"
                      : "border-transparent text-muted-foreground hover:text-foreground hover:border-muted-foreground/30"
                  }`}
                >
                  <Icon className="w-4 h-4" />
                  {tab.label}
                  {tab.id === "failures" && failureCount > 0 && (
                    <span className={`inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-full text-[10px] font-bold leading-none ${
                      isActive
                        ? "bg-red-500 text-white"
                        : "bg-red-100 text-red-600 dark:bg-red-900/40 dark:text-red-400"
                    }`}>
                      {failureCount}
                    </span>
                  )}
                </button>
              )
            })}
          </nav>
        </div>
      </div>

      {/* Error */}
      {dashboardError && (
        <div className="flex items-center gap-3 p-3 rounded-lg border border-red-200 dark:border-red-900 text-red-600 dark:text-red-400 text-sm flex-shrink-0">
          <AlertCircle className="w-4 h-4 flex-shrink-0" />
          <span className="flex-1">{dashboardError}</span>
          <Button variant="outline" size="sm" onClick={() => fetchDashboard()}>
            Retry
          </Button>
        </div>
      )}

      {/* Active tab content */}
      <div className="flex-1 min-h-0 pt-5">
        {activeTab === "overview" && (
          <OverviewView overview={overview} dailyStats={dailyStats} statusBreakdown={statusBreakdown} loading={dashboardLoading} />
        )}
        {activeTab === "executions" && (
          <ExecutionsView recentExecutions={recentExecutions} loading={dashboardLoading} />
        )}
        {activeTab === "workflows" && (
          <WorkflowsView topWorkflows={topWorkflows} dailyStats={dailyStats} loading={dashboardLoading} />
        )}
        {activeTab === "failures" && (
          <FailuresView
            topFailingWorkflows={topFailingWorkflows}
            failureReasons={failureReasons}
            dailyStats={dailyStats}
            loading={dashboardLoading}
          />
        )}
      </div>
    </div>
  )
}
