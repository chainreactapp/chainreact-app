"use client"

import { useEffect, useMemo, useState } from "react"
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from "@/components/ui/dialog"
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
import { Badge } from "@/components/ui/badge"
import {
  History, Loader2, CheckCircle2, XCircle, AlertCircle,
  Download, RefreshCw, Filter, Clock, Activity,
  ChevronLeft, RotateCcw,
} from "lucide-react"
import { useToast } from "@/hooks/use-toast"
import { cn } from "@/lib/utils"
import { ClassifiedErrorCard } from "@/components/workflows/ClassifiedErrorCard"
import type { PersistedErrorClassification } from "@/lib/workflows/errors/classifyExecutionFailure"

type FlowRunSummary = {
  id: string
  status: string
  startedAt: string | null
  finishedAt: string | null
  sessionType?: string
  errorMessage?: string | null
  errorClassification?: PersistedErrorClassification | null
  metadata?: Record<string, any>
}

type ExecutionStep = {
  id: string
  node_id: string
  node_type: string
  node_name?: string
  step_number: number
  status: string
  duration_ms?: number
}

interface WorkflowHistoryDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  workflowId: string
  onSelectRun?: (runId: string) => Promise<void> | void
  activeRunId?: string | null
  /**
   * If set, the dialog auto-opens directly into the detail view for this
   * execution. Used by the `?historyExecution=...` deep link from
   * notifications.
   */
  pendingExecutionId?: string | null
  /**
   * Called once the dialog has consumed `pendingExecutionId`, so the parent
   * can clear the URL query param.
   */
  onPendingConsumed?: () => void
}

const PAYMENT_IMPACTING_PROVIDERS = ["stripe", "shopify", "square", "paypal"]
function isPaymentImpactingNodeType(nodeType: string | null | undefined): boolean {
  if (!nodeType) return false
  const lower = nodeType.toLowerCase()
  return PAYMENT_IMPACTING_PROVIDERS.some((p) => lower.startsWith(`${p}_`))
}

const STATUS_CONFIG: Record<string, { label: string; iconColor: string; badgeClass: string }> = {
  success: {
    label: "Success",
    iconColor: "text-emerald-500 dark:text-emerald-400",
    badgeClass: "bg-emerald-100 text-emerald-800 border-emerald-300 dark:bg-emerald-500/20 dark:text-emerald-300 dark:border-emerald-500/40",
  },
  error: {
    label: "Error",
    iconColor: "text-red-500 dark:text-red-400",
    badgeClass: "bg-red-100 text-red-800 border-red-300 dark:bg-red-500/20 dark:text-red-300 dark:border-red-500/40",
  },
  failed: {
    label: "Error",
    iconColor: "text-red-500 dark:text-red-400",
    badgeClass: "bg-red-100 text-red-800 border-red-300 dark:bg-red-500/20 dark:text-red-300 dark:border-red-500/40",
  },
  running: {
    label: "Listening",
    iconColor: "text-blue-500 dark:text-blue-400",
    badgeClass: "bg-blue-100 text-blue-800 border-blue-300 dark:bg-blue-500/20 dark:text-blue-300 dark:border-blue-500/40",
  },
  cancelled: {
    label: "Cancelled",
    iconColor: "text-amber-500 dark:text-amber-400",
    badgeClass: "bg-amber-100 text-amber-800 border-amber-300 dark:bg-amber-500/20 dark:text-amber-300 dark:border-amber-500/40",
  },
}

const DEFAULT_STATUS = {
  label: "Unknown",
  iconColor: "text-gray-400 dark:text-gray-400",
  badgeClass: "bg-gray-100 text-gray-800 border-gray-300 dark:bg-gray-500/20 dark:text-gray-300 dark:border-gray-500/40",
}

const StatusIcon = ({ status }: { status: string }) => {
  const cfg = STATUS_CONFIG[status] || DEFAULT_STATUS
  const iconClass = cn("h-4 w-4", cfg.iconColor, status === "running" && "animate-spin")
  switch (status) {
    case "success": return <CheckCircle2 className={iconClass} />
    case "error": case "failed": return <XCircle className={iconClass} />
    case "running": return <RefreshCw className={iconClass} />
    case "cancelled": return <AlertCircle className={iconClass} />
    default: return <Clock className={iconClass} />
  }
}

const StatusBadge = ({ status }: { status: string }) => {
  const cfg = STATUS_CONFIG[status] || DEFAULT_STATUS
  return <Badge variant="outline" className={cn("text-[11px] whitespace-nowrap", cfg.badgeClass)}>{cfg.label}</Badge>
}

export function WorkflowHistoryDialog({
  open, onOpenChange, workflowId, pendingExecutionId, onPendingConsumed,
}: WorkflowHistoryDialogProps) {
  const [runs, setRuns] = useState<FlowRunSummary[]>([])
  const [loading, setLoading] = useState(false)
  const [filter, setFilter] = useState<"all" | "success" | "failed">("all")
  const [view, setView] = useState<"list" | "detail">("list")
  const [selectedRun, setSelectedRun] = useState<FlowRunSummary | null>(null)
  const [executionSteps, setExecutionSteps] = useState<ExecutionStep[]>([])
  const [stepsLoading, setStepsLoading] = useState(false)
  const [retryConfirmOpen, setRetryConfirmOpen] = useState(false)
  const [retrying, setRetrying] = useState(false)
  const { toast } = useToast()

  // Stats: success rate only counts completed runs (not running/listening)
  const successCount = runs.filter((r) => r.status === "success").length
  const failedCount = runs.filter((r) => r.status === "error" || r.status === "failed").length
  const completedCount = successCount + failedCount
  const avgDuration = (() => {
    const done = runs.filter((r) => r.startedAt && r.finishedAt)
    if (!done.length) return 0
    return done.reduce((a, r) => a + (new Date(r.finishedAt!).getTime() - new Date(r.startedAt!).getTime()), 0) / done.length
  })()

  const filteredRuns = runs.filter((r) => {
    if (filter === "success") return r.status === "success"
    if (filter === "failed") return r.status === "error" || r.status === "failed"
    return true
  })

  const hasPaymentImpactingStep = useMemo(
    () => executionSteps.some((s) => isPaymentImpactingNodeType(s.node_type)),
    [executionSteps]
  )

  useEffect(() => {
    if (open) void loadRuns()
    if (!open) {
      // Reset detail view when dialog closes so a future open starts on the list
      setView("list")
      setSelectedRun(null)
      setExecutionSteps([])
    }
  }, [open, workflowId])

  // Deep-link auto-open: when pendingExecutionId is set and runs are loaded,
  // jump straight to the detail view for that execution.
  useEffect(() => {
    if (!open) return
    if (!pendingExecutionId) return
    if (loading) return
    const target = runs.find((r) => r.id === pendingExecutionId)
    if (!target) return
    void handleSelectRun(target)
    onPendingConsumed?.()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, pendingExecutionId, loading, runs])

  const loadRuns = async () => {
    try {
      setLoading(true)
      const res = await fetch(`/workflows/v2/api/flows/${workflowId}/runs/history`)
      if (!res.ok) throw new Error("Failed to load runs")
      const data = await res.json()
      setRuns(data.runs || [])
    } catch (err) {
      console.error("[WorkflowHistoryDialog] loadRuns error:", err)
      toast({ title: "Unable to load history", description: "Please try again.", variant: "destructive" })
    } finally { setLoading(false) }
  }

  const loadStepsFor = async (executionId: string) => {
    try {
      setStepsLoading(true)
      const res = await fetch(`/api/workflows/history/${executionId}/steps`)
      if (!res.ok) throw new Error("Failed to load steps")
      const data = await res.json()
      setExecutionSteps(data.steps || [])
    } catch (err) {
      console.error("[WorkflowHistoryDialog] loadStepsFor error:", err)
      setExecutionSteps([])
    } finally {
      setStepsLoading(false)
    }
  }

  const handleSelectRun = async (run: FlowRunSummary) => {
    setSelectedRun(run)
    setView("detail")
    await loadStepsFor(run.id)
  }

  const handleBack = () => {
    setView("list")
    setSelectedRun(null)
    setExecutionSteps([])
  }

  const handleRetry = async () => {
    if (!selectedRun) return
    setRetrying(true)
    try {
      const res = await fetch(`/api/executions/${selectedRun.id}/retry`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) {
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
      // Refresh the list so the new run appears
      await loadRuns()
      // Return to list view so the user can see the new run
      handleBack()
    } catch (err) {
      console.error("[WorkflowHistoryDialog] handleRetry error:", err)
      toast({
        title: "Retry failed",
        description: "Could not reach the server. Please try again.",
        variant: "destructive",
      })
    } finally {
      setRetrying(false)
    }
  }

  const exportRuns = () => {
    if (!runs.length) return
    const blob = new Blob([JSON.stringify({ runs }, null, 2)], { type: "application/json" })
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    a.download = `workflow-history-${workflowId.slice(0, 8)}.json`
    document.body.appendChild(a); a.click(); document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }

  const fmtTime = (v?: string | null) => {
    if (!v) return "N/A"
    try { return new Date(v).toLocaleString() } catch { return v }
  }

  const fmtDuration = (start?: string | null, end?: string | null) => {
    if (!start || !end) return "-"
    const ms = new Date(end).getTime() - new Date(start).getTime()
    if (ms < 1000) return `${ms}ms`
    if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`
    return `${Math.floor(ms / 60000)}m ${Math.floor((ms % 60000) / 1000)}s`
  }

  const fmtMs = (ms: number) => {
    if (!ms) return "-"
    if (ms < 1000) return `${Math.round(ms)}ms`
    if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`
    return `${Math.floor(ms / 60000)}m ${Math.floor((ms % 60000) / 1000)}s`
  }

  const statCards: { icon: typeof Activity; label: string; value: string | number; color: string }[] = [
    { icon: Activity, label: "Total Runs", value: runs.length, color: "gray" },
    { icon: CheckCircle2, label: "Success Rate", value: completedCount > 0 ? `${((successCount / completedCount) * 100).toFixed(0)}%` : "-", color: "emerald" },
    { icon: XCircle, label: "Failures", value: failedCount, color: "red" },
    { icon: Clock, label: "Avg Duration", value: fmtMs(avgDuration), color: "blue" },
  ]

  const colorMap: Record<string, { border: string; text: string; value: string }> = {
    gray: { border: "border-gray-200 dark:border-gray-700", text: "text-gray-600 dark:text-gray-400", value: "text-gray-900 dark:text-white" },
    emerald: { border: "border-emerald-200 dark:border-emerald-800", text: "text-emerald-600 dark:text-emerald-400", value: "text-emerald-700 dark:text-emerald-300" },
    red: { border: "border-red-200 dark:border-red-800", text: "text-red-600 dark:text-red-400", value: "text-red-700 dark:text-red-300" },
    blue: { border: "border-blue-200 dark:border-blue-800", text: "text-blue-600 dark:text-blue-400", value: "text-blue-700 dark:text-blue-300" },
  }

  const isFailed = selectedRun?.status === "error" || selectedRun?.status === "failed"

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl p-0 overflow-hidden max-h-[85vh] flex flex-col">
        {/* Header */}
        <DialogHeader className="px-6 py-4 border-b bg-gradient-to-r from-gray-50 to-white dark:from-gray-900 dark:to-gray-950 flex-shrink-0">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3 min-w-0">
              {view === "detail" && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={handleBack}
                  className="h-8 px-2 -ml-2 flex-shrink-0"
                >
                  <ChevronLeft className="w-4 h-4" />
                </Button>
              )}
              <div className="min-w-0">
                <DialogTitle className="flex items-center gap-2 text-lg">
                  <History className="w-5 h-5" />
                  {view === "list" ? "Execution History" : "Execution Details"}
                </DialogTitle>
                <DialogDescription className="text-sm mt-1">
                  {view === "list"
                    ? "Review past workflow runs."
                    : selectedRun
                    ? `${fmtTime(selectedRun.startedAt)} • ${fmtDuration(selectedRun.startedAt, selectedRun.finishedAt)}`
                    : ""}
                </DialogDescription>
              </div>
            </div>
            {view === "list" && (
              <Button variant="outline" size="sm" onClick={() => void loadRuns()} disabled={loading} className="h-9 flex-shrink-0">
                <RefreshCw className={cn("h-4 w-4 mr-2", loading && "animate-spin")} />
                Refresh
              </Button>
            )}
            {view === "detail" && isFailed && (
              <Button
                size="sm"
                onClick={() => setRetryConfirmOpen(true)}
                className="h-9 flex-shrink-0"
              >
                <RotateCcw className="w-4 h-4 mr-2" />
                Retry execution
              </Button>
            )}
          </div>
        </DialogHeader>

        {/* Body */}
        {view === "list" ? (
          loading ? (
            <div className="flex items-center justify-center py-12 px-6">
              <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
            </div>
          ) : runs.length === 0 ? (
            <div className="text-center py-12 px-6 text-muted-foreground">
              <History className="w-12 h-12 mx-auto mb-4 opacity-50" />
              <p>No executions yet</p>
              <p className="text-sm mt-2">Run the workflow or a node test to generate history.</p>
            </div>
          ) : (
            <div className="flex-1 flex flex-col overflow-hidden min-h-0">
              {/* Stats */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 px-6 py-4 border-b bg-gray-50/50 dark:bg-gray-900/50 flex-shrink-0">
                {statCards.map((sc) => {
                  const c = colorMap[sc.color]
                  return (
                    <div key={sc.label} className={cn("bg-white dark:bg-gray-800 rounded-lg border p-3", c.border)}>
                      <div className="flex items-center gap-2 mb-1">
                        <sc.icon className={cn("h-3.5 w-3.5", c.text)} />
                        <span className={cn("text-xs font-medium", c.text)}>{sc.label}</span>
                      </div>
                      <div className={cn("text-xl font-bold", c.value)}>{sc.value}</div>
                    </div>
                  )
                })}
              </div>

              {/* Runs section - full width */}
              <div className="px-6 pt-4 pb-6">
                {/* Runs header with filters + export */}
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <Filter className="h-3.5 w-3.5 text-muted-foreground" />
                    {(["all", "success", "failed"] as const).map((f) => (
                      <Button key={f} size="sm" variant={filter === f ? "default" : "outline"}
                        onClick={() => setFilter(f)} className="h-7 px-2.5 text-xs capitalize">
                        {f === "all" ? `All (${runs.length})` : f === "success" ? `Success (${successCount})` : `Failed (${failedCount})`}
                      </Button>
                    ))}
                  </div>
                  <Button variant="outline" size="sm" onClick={exportRuns} disabled={!runs.length} className="h-7 px-2.5 text-xs">
                    <Download className="w-3.5 h-3.5 mr-1.5" />
                    Export
                  </Button>
                </div>

                {/* Run list container with scroll */}
                <div className="max-h-[40vh] overflow-y-auto rounded-lg border bg-gray-50/30 dark:bg-gray-900/30 p-2 space-y-1.5">
                  {filteredRuns.length === 0 ? (
                    <div className="text-center py-8 text-muted-foreground">
                      <Filter className="w-8 h-8 mx-auto mb-2 opacity-50" />
                      <p className="text-sm">No matching runs</p>
                    </div>
                  ) : filteredRuns.map((run) => {
                    const runIsFailed = run.status === "error" || run.status === "failed"
                    return (
                      <button
                        key={run.id}
                        onClick={() => void handleSelectRun(run)}
                        className={cn(
                          "w-full text-left border rounded-lg px-4 py-3 transition-all bg-white dark:bg-gray-900",
                          "hover:bg-accent hover:shadow-sm hover:border-gray-400 dark:hover:border-gray-500",
                        )}
                      >
                        <div className="flex items-center gap-3">
                          <div className="flex-shrink-0"><StatusIcon status={run.status} /></div>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2">
                              <span className="font-medium text-sm">
                                {run.sessionType === "webhook" ? "Triggered" : "Manual"}
                              </span>
                              <StatusBadge status={run.status} />
                            </div>
                            <div className="text-xs text-muted-foreground mt-0.5">{fmtTime(run.startedAt)}</div>
                          </div>
                          <div className="text-xs text-muted-foreground flex-shrink-0">
                            {fmtDuration(run.startedAt, run.finishedAt)}
                          </div>
                        </div>
                        {runIsFailed && (run.errorClassification || run.errorMessage) && (
                          <div
                            className="mt-3"
                            onClick={(e) => e.stopPropagation()}
                          >
                            <ClassifiedErrorCard
                              classification={run.errorClassification}
                              rawErrorMessage={run.errorMessage}
                              workflowId={workflowId}
                              variant="compact"
                            />
                          </div>
                        )}
                      </button>
                    )
                  })}
                </div>
              </div>
            </div>
          )
        ) : (
          /* Detail view */
          <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
            {selectedRun && (
              <>
                {(selectedRun.errorClassification || selectedRun.errorMessage) && (
                  <ClassifiedErrorCard
                    classification={selectedRun.errorClassification}
                    rawErrorMessage={selectedRun.errorMessage}
                    workflowId={workflowId}
                    variant="full"
                  />
                )}

                <div className="rounded-lg border bg-white dark:bg-gray-900 p-4">
                  <div className="text-sm font-semibold mb-3">Execution overview</div>
                  <div className="grid grid-cols-2 gap-3 text-sm">
                    <div>
                      <div className="text-xs text-muted-foreground">Execution ID</div>
                      <code className="text-xs">{selectedRun.id.slice(0, 8)}…</code>
                    </div>
                    <div>
                      <div className="text-xs text-muted-foreground">Status</div>
                      <StatusBadge status={selectedRun.status} />
                    </div>
                    <div>
                      <div className="text-xs text-muted-foreground">Started</div>
                      <div>{fmtTime(selectedRun.startedAt)}</div>
                    </div>
                    <div>
                      <div className="text-xs text-muted-foreground">Duration</div>
                      <div>{fmtDuration(selectedRun.startedAt, selectedRun.finishedAt)}</div>
                    </div>
                  </div>
                </div>

                <div className="rounded-lg border bg-white dark:bg-gray-900 p-4">
                  <div className="text-sm font-semibold mb-3">
                    Steps {executionSteps.length > 0 && `(${executionSteps.length})`}
                  </div>
                  {stepsLoading ? (
                    <div className="flex items-center justify-center py-6">
                      <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
                    </div>
                  ) : executionSteps.length === 0 ? (
                    <div className="text-sm text-muted-foreground py-2">No step records.</div>
                  ) : (
                    <ul className="space-y-1.5">
                      {executionSteps.map((step) => (
                        <li
                          key={step.id}
                          className="flex items-center gap-3 text-sm border rounded px-3 py-2"
                        >
                          <span className="text-xs font-mono text-muted-foreground w-5">
                            {step.step_number}
                          </span>
                          <StatusIcon status={step.status} />
                          <span className="flex-1 truncate">
                            {step.node_name || step.node_type}
                          </span>
                          <span className="text-xs text-muted-foreground">
                            {step.duration_ms ? fmtMs(step.duration_ms) : "-"}
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </>
            )}
          </div>
        )}
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
