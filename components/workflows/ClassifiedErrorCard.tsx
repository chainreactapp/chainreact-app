"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { AlertTriangle, ChevronDown, ChevronRight, ExternalLink, XCircle } from "lucide-react"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import type { HumanizedError } from "@/lib/workflows/errors/humanizeActionError"
import type { PersistedErrorClassification } from "@/lib/workflows/errors/classifyExecutionFailure"

interface ClassifiedErrorCardProps {
  classification?: HumanizedError | PersistedErrorClassification | null
  rawErrorMessage?: string | null
  workflowId?: string
  className?: string
  /**
   * Compact variant for the list view (smaller, no technical-details disclosure).
   * Defaults to full variant.
   */
  variant?: "full" | "compact"
}

/**
 * Renders a humanized failure summary plus a contextual CTA matching the
 * classification's `action`. Falls back to a generic "Workflow failed"
 * message when no classification is present (older execution rows).
 */
export function ClassifiedErrorCard({
  classification,
  rawErrorMessage,
  workflowId,
  className,
  variant = "full",
}: ClassifiedErrorCardProps) {
  const router = useRouter()
  const [showDetails, setShowDetails] = useState(false)

  const isWarning = classification?.severity === "warning"
  const Icon = isWarning ? AlertTriangle : XCircle

  const title =
    classification?.title ||
    (rawErrorMessage ? "Workflow failed" : "Workflow failed")
  const description =
    classification?.description ||
    rawErrorMessage ||
    "The workflow run did not complete."
  const hint = classification?.hint

  const containerClass = isWarning
    ? "bg-amber-50 dark:bg-amber-900/20 border-amber-300 dark:border-amber-700"
    : "bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800"
  const titleClass = isWarning
    ? "text-amber-900 dark:text-amber-100"
    : "text-red-900 dark:text-red-100"
  const bodyClass = isWarning
    ? "text-amber-800 dark:text-amber-200"
    : "text-red-700 dark:text-red-300"
  const iconClass = isWarning
    ? "text-amber-600 dark:text-amber-400"
    : "text-red-600 dark:text-red-400"

  function handleCta() {
    if (!classification?.action) return
    if (classification.action === "reconnect") {
      router.push("/integrations")
      return
    }
    if (classification.action === "open_node") {
      if (!workflowId) return
      const params = new URLSearchParams()
      if (classification.nodeId) params.set("focusNode", classification.nodeId)
      const qs = params.toString()
      router.push(`/workflows/builder/${workflowId}${qs ? `?${qs}` : ""}`)
      return
    }
    if (classification.action === "upgrade_plan") {
      router.push("/subscription")
    }
  }

  function ctaLabel(): string | null {
    if (!classification?.action) return null
    if (classification.action === "reconnect") {
      return classification.provider
        ? `Reconnect ${classification.provider}`
        : "Reconnect integration"
    }
    if (classification.action === "open_node") return "Open node"
    if (classification.action === "upgrade_plan") return "Manage billing"
    return null
  }

  const ctaText = ctaLabel()

  return (
    <div
      className={cn(
        "rounded-lg border-2 p-4",
        containerClass,
        className
      )}
    >
      <div className="flex items-start gap-3">
        <Icon className={cn("h-5 w-5 mt-0.5 flex-shrink-0", iconClass)} />
        <div className="flex-1 min-w-0">
          <div className={cn("font-semibold text-sm mb-1", titleClass)}>
            {title}
          </div>
          <div className={cn("text-sm", bodyClass)}>{description}</div>

          {classification?.nodeName && (
            <div className={cn("text-xs mt-2 opacity-80", bodyClass)}>
              Failed step: <span className="font-medium">{classification.nodeName}</span>
              {(() => {
                const persisted = classification as PersistedErrorClassification
                return typeof persisted.failedNodeCount === "number" &&
                  persisted.failedNodeCount > 1
                  ? <span className="ml-1">(+{persisted.failedNodeCount - 1} more)</span>
                  : null
              })()}
            </div>
          )}

          {hint && (
            <div className={cn("text-xs mt-2 italic", bodyClass)}>{hint}</div>
          )}

          {(ctaText || (variant === "full" && rawErrorMessage)) && (
            <div className="flex flex-wrap items-center gap-2 mt-3">
              {ctaText && (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={handleCta}
                  className="h-8"
                >
                  {ctaText}
                  <ExternalLink className="h-3.5 w-3.5 ml-1.5" />
                </Button>
              )}
              {variant === "full" && rawErrorMessage && (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => setShowDetails((v) => !v)}
                  className="h-8 text-xs"
                >
                  {showDetails ? (
                    <ChevronDown className="h-3.5 w-3.5 mr-1" />
                  ) : (
                    <ChevronRight className="h-3.5 w-3.5 mr-1" />
                  )}
                  Technical details
                </Button>
              )}
            </div>
          )}

          {variant === "full" && showDetails && rawErrorMessage && (
            <pre className="mt-3 text-xs bg-white/60 dark:bg-black/30 p-3 rounded border border-current/10 overflow-x-auto whitespace-pre-wrap break-words font-mono">
              {rawErrorMessage}
            </pre>
          )}
        </div>
      </div>
    </div>
  )
}
