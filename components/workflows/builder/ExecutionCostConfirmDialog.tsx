"use client"

import React, { useEffect, useState, useCallback } from "react"
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
import { AlertTriangle, Loader2, Info, Zap, XCircle } from "lucide-react"
import { cn } from "@/lib/utils"
import { fetchWithTimeout } from "@/lib/utils/fetch-with-timeout"

const SKIP_CONFIRMATION_KEY = "chainreact:skipCostConfirmation"

interface CostPreviewResponse {
  flatCost: number
  totalCost: number
  chargedCost: number
  loopExpansionEnabled: boolean
  hasLoops: boolean
  breakdown: Record<string, number>
  loopDetails: {
    loopNodeId: string
    innerNodeIds: string[]
    innerCost: number
    maxIterations: number
    expandedCost: number
  }[]
  balance: {
    remaining: number | null
    limit: number
    used: number
    unlimited: boolean
  }
  overage: {
    enabled: boolean
    rate: number | null
    capMultiplier: number
    tasksUsed: number
    room: number
    wouldConsumeAmount: number
    wouldConsumeCostCents: number
  }
  wouldExceedBudget: boolean
}

interface ExecutionCostConfirmDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onConfirm: () => void
  workflowId: string
  /** Node labels keyed by node ID, for display in breakdown */
  nodeLabels?: Record<string, string>
}

export function ExecutionCostConfirmDialog({
  open,
  onOpenChange,
  onConfirm,
  workflowId,
  nodeLabels = {},
}: ExecutionCostConfirmDialogProps) {
  const [preview, setPreview] = useState<CostPreviewResponse | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [skipFuture, setSkipFuture] = useState(false)

  const fetchPreview = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const response = await fetchWithTimeout(
        `/api/workflows/${workflowId}/preview-cost`,
        { method: "GET" },
        10000
      )
      if (!response.ok) {
        const data = await response.json().catch(() => ({}))
        throw new Error(data.error || `Failed to load cost preview (${response.status})`)
      }
      const data = await response.json()
      setPreview(data)
    } catch (err: any) {
      setError(err.message || "Failed to load cost preview")
    } finally {
      setLoading(false)
    }
  }, [workflowId])

  useEffect(() => {
    if (open) {
      fetchPreview()
    } else {
      setPreview(null)
      setError(null)
      setSkipFuture(false)
    }
  }, [open, fetchPreview])

  const handleConfirm = () => {
    if (skipFuture) {
      try {
        localStorage.setItem(SKIP_CONFIRMATION_KEY, "true")
      } catch {
        // localStorage may be unavailable
      }
    }
    onConfirm()
  }

  // Fail closed: if preview API fails, block execution
  const canConfirm = preview != null && !error && !loading

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent className="max-w-md">
        <AlertDialogHeader>
          <AlertDialogTitle className="flex items-center gap-2">
            <Zap className="w-5 h-5 text-blue-600 dark:text-blue-400" />
            Confirm Execution
          </AlertDialogTitle>
          <AlertDialogDescription>
            Review the task cost before running this workflow.
          </AlertDialogDescription>
        </AlertDialogHeader>

        <div className="space-y-4 py-2">
          {loading && (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
            </div>
          )}

          {error && (
            <div className="flex items-start gap-2 p-3 rounded-lg bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800">
              <XCircle className="w-4 h-4 mt-0.5 text-red-600 dark:text-red-400 shrink-0" />
              <div className="text-sm text-red-700 dark:text-red-300">
                <p className="font-medium">Unable to verify cost</p>
                <p className="text-xs mt-1">{error}</p>
                <p className="text-xs mt-1">Execution is blocked until cost can be verified.</p>
              </div>
            </div>
          )}

          {preview && !error && (
            <>
              {/* Cost summary */}
              <div className={cn(
                "p-3 rounded-lg border",
                preview.wouldExceedBudget
                  ? "bg-red-50 dark:bg-red-950/30 border-red-200 dark:border-red-800"
                  : "bg-blue-50 dark:bg-blue-950/30 border-blue-200 dark:border-blue-800"
              )}>
                <div className="flex justify-between items-center">
                  <span className="text-sm font-medium">This run will use</span>
                  <span className={cn(
                    "text-xl font-bold tabular-nums",
                    preview.wouldExceedBudget
                      ? "text-red-600 dark:text-red-400"
                      : "text-blue-600 dark:text-blue-400"
                  )}>
                    {preview.chargedCost}
                    <span className="text-sm font-normal ml-1">
                      task{preview.chargedCost !== 1 ? "s" : ""}
                    </span>
                  </span>
                </div>

                {/* Balance */}
                {!preview.balance.unlimited && (
                  <div className="text-xs text-muted-foreground mt-2">
                    Balance: {preview.balance.remaining} / {preview.balance.limit} remaining
                  </div>
                )}
              </div>

              {/* Loop warning */}
              {preview.hasLoops && (
                <div className="flex items-start gap-2 p-3 rounded-lg bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800">
                  <Info className="w-4 h-4 mt-0.5 text-amber-600 dark:text-amber-400 shrink-0" />
                  <p className="text-xs text-amber-700 dark:text-amber-300">
                    Loops are charged upfront based on configured maximum iterations.
                    This run will reserve the worst-case task cost before execution.
                  </p>
                </div>
              )}

              {/* Overage notice (charge will spill into overage but is allowed) */}
              {!preview.wouldExceedBudget && preview.overage.wouldConsumeAmount > 0 && (
                <div className="flex items-start gap-2 p-3 rounded-lg bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800">
                  <Info className="w-4 h-4 mt-0.5 text-amber-600 dark:text-amber-400 shrink-0" />
                  <div className="text-xs text-amber-700 dark:text-amber-300">
                    <p className="font-medium">
                      {preview.overage.wouldConsumeAmount} task{preview.overage.wouldConsumeAmount !== 1 ? "s" : ""} will run on overage
                    </p>
                    <p className="mt-1">
                      Estimated additional charge: ${(preview.overage.wouldConsumeCostCents / 100).toFixed(2)}
                      {preview.overage.rate ? ` ($${preview.overage.rate.toFixed(3)}/task)` : ""}
                    </p>
                  </div>
                </div>
              )}

              {/* Exceeds budget warning — even overage cap can't cover */}
              {preview.wouldExceedBudget && (
                <div className="flex items-start gap-2 p-3 rounded-lg bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800">
                  <AlertTriangle className="w-4 h-4 mt-0.5 text-red-600 dark:text-red-400 shrink-0" />
                  <p className="text-xs text-red-700 dark:text-red-300">
                    {preview.overage.enabled
                      ? `This workflow exceeds your plan + overage cap (${preview.overage.capMultiplier}× plan limit). Execution will be blocked.`
                      : "This workflow exceeds your remaining task balance. Enable overage billing in subscription settings to keep running, or wait for the next billing period."}
                  </p>
                </div>
              )}

              {/* Node breakdown (collapsible) */}
              {Object.keys(preview.breakdown).length > 0 && (
                <details className="text-xs">
                  <summary className="cursor-pointer text-muted-foreground hover:text-foreground transition-colors font-medium">
                    Node breakdown ({Object.keys(preview.breakdown).length} nodes)
                  </summary>
                  <div className="mt-2 space-y-1 max-h-32 overflow-y-auto">
                    {Object.entries(preview.breakdown).map(([nodeId, cost]) => (
                      <div key={nodeId} className="flex justify-between px-2 py-0.5 rounded hover:bg-muted/50">
                        <span className="text-muted-foreground truncate max-w-[200px]">
                          {nodeLabels[nodeId] || nodeId.slice(0, 12)}
                        </span>
                        <span className="font-medium tabular-nums">{cost} task{cost !== 1 ? "s" : ""}</span>
                      </div>
                    ))}
                  </div>
                </details>
              )}

              {/* Loop details */}
              {preview.loopDetails.length > 0 && (
                <details className="text-xs">
                  <summary className="cursor-pointer text-muted-foreground hover:text-foreground transition-colors font-medium">
                    Loop details ({preview.loopDetails.length} loop{preview.loopDetails.length !== 1 ? "s" : ""})
                  </summary>
                  <div className="mt-2 space-y-1">
                    {preview.loopDetails.map((loop) => (
                      <div key={loop.loopNodeId} className="px-2 py-1 rounded bg-muted/30">
                        <span className="text-muted-foreground">
                          {nodeLabels[loop.loopNodeId] || "Loop"}: {loop.innerCost} task{loop.innerCost !== 1 ? "s" : ""} x {loop.maxIterations} iterations = {loop.expandedCost} tasks
                        </span>
                      </div>
                    ))}
                  </div>
                </details>
              )}

              {/* Retry notice */}
              <p className="text-xs text-muted-foreground">
                Retries are billed as new runs.
              </p>

              {/* Don't show again */}
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={skipFuture}
                  onChange={(e) => setSkipFuture(e.target.checked)}
                  className="rounded border-gray-300 dark:border-gray-600"
                />
                <span className="text-xs text-muted-foreground">Don&apos;t show this again</span>
              </label>
            </>
          )}
        </div>

        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            onClick={handleConfirm}
            disabled={!canConfirm || preview?.wouldExceedBudget}
            className={cn(
              preview?.wouldExceedBudget && "opacity-50 cursor-not-allowed"
            )}
          >
            {loading ? "Loading..." : "Run Workflow"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

/**
 * Check if the user has opted out of the cost confirmation dialog.
 */
export function shouldSkipCostConfirmation(): boolean {
  try {
    return localStorage.getItem(SKIP_CONFIRMATION_KEY) === "true"
  } catch {
    return false
  }
}
