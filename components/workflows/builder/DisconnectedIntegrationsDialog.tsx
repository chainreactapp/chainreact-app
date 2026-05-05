"use client"

import React, { useState, useEffect, useCallback } from "react"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { useIntegrationStore, isConnectedStatus } from "@/stores/integrationStore"
import { AlertTriangle, CheckCircle2, ExternalLink, Loader2, RefreshCw } from "lucide-react"
import { cn } from "@/lib/utils"
import { getProviderIcon } from "@/lib/workflows/ai-agent/providerDisambiguation"
import {
  getDisconnectedIntegrations as getDisconnectedIntegrationsImpl,
  type DisconnectedIntegration,
} from "./disconnectedIntegrations"

// Re-exported so existing imports in WorkflowBuilderV2.tsx continue to
// work. The implementation lives in `./disconnectedIntegrations.ts` so
// it can be unit-tested without React/JSX in the transform path.
export const getDisconnectedIntegrations = getDisconnectedIntegrationsImpl

interface DisconnectedIntegrationsDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  disconnectedIntegrations: DisconnectedIntegration[]
  onAllConnected: () => void
}

export function DisconnectedIntegrationsDialog({
  open,
  onOpenChange,
  disconnectedIntegrations,
  onAllConnected,
}: DisconnectedIntegrationsDialogProps) {
  const { integrations, fetchIntegrations } = useIntegrationStore()
  const [connectingProvider, setConnectingProvider] = useState<string | null>(null)
  const [refreshing, setRefreshing] = useState(false)

  // Check which integrations are now connected. Uses the shared
  // `isConnectedStatus` helper so we accept the same set of values
  // (connected | authorized | active | valid | ok | ready) that the
  // integration store treats as connected. Narrowing this list here
  // re-introduces the false-disconnect bug fixed on 2026-05-05.
  const getConnectionStatus = (providerId: string) => {
    const integration = integrations.find(i => i.provider === providerId)
    return isConnectedStatus(integration?.status)
  }

  // Count how many are still disconnected
  const stillDisconnected = disconnectedIntegrations.filter(
    int => !getConnectionStatus(int.providerId)
  )

  // If all connected, notify parent
  useEffect(() => {
    if (open && stillDisconnected.length === 0 && disconnectedIntegrations.length > 0) {
      // Small delay to show the success state
      const timer = setTimeout(() => {
        onAllConnected()
      }, 1000)
      return () => clearTimeout(timer)
    }
  }, [open, stillDisconnected.length, disconnectedIntegrations.length, onAllConnected])

  // Handle connect click
  const handleConnect = (providerId: string) => {
    setConnectingProvider(providerId)
    // Open OAuth in new window
    const width = 600
    const height = 700
    const left = window.screenX + (window.outerWidth - width) / 2
    const top = window.screenY + (window.outerHeight - height) / 2

    window.open(
      `/api/oauth/${providerId}/authorize`,
      `Connect ${providerId}`,
      `width=${width},height=${height},left=${left},top=${top}`
    )
  }

  // Handle refresh
  const handleRefresh = useCallback(async () => {
    setRefreshing(true)
    await fetchIntegrations()
    setRefreshing(false)
    setConnectingProvider(null)
  }, [fetchIntegrations])

  // Listen for OAuth completion
  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      if (event.data?.type === 'oauth-complete' || event.data?.type === 'integration-connected') {
        handleRefresh()
      }
    }

    window.addEventListener('message', handleMessage)
    return () => window.removeEventListener('message', handleMessage)
  }, [handleRefresh])

  // Also listen for custom event
  useEffect(() => {
    const handleIntegrationConnected = () => {
      handleRefresh()
    }

    window.addEventListener('integration-connected', handleIntegrationConnected)
    return () => window.removeEventListener('integration-connected', handleIntegrationConnected)
  }, [handleRefresh])

  const allConnected = stillDisconnected.length === 0

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {allConnected ? (
              <>
                <CheckCircle2 className="w-5 h-5 text-emerald-500" />
                All Accounts Connected
              </>
            ) : (
              <>
                <AlertTriangle className="w-5 h-5 text-amber-500" />
                Connect Your Accounts
              </>
            )}
          </DialogTitle>
          <DialogDescription>
            {allConnected
              ? "Great! All required accounts are now connected. You can run your test."
              : "Connect these accounts to test your workflow. Your workflow uses these services."
            }
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 py-4">
          {disconnectedIntegrations.map((integration) => {
            const isConnected = getConnectionStatus(integration.providerId)
            const isConnecting = connectingProvider === integration.providerId
            const icon = getProviderIcon(integration.providerId)

            return (
              <div
                key={integration.providerId}
                className={cn(
                  "flex items-center justify-between p-3 rounded-lg border transition-colors",
                  isConnected
                    ? "bg-emerald-50 dark:bg-emerald-950/30 border-emerald-200 dark:border-emerald-800"
                    : "bg-muted/50 border-border"
                )}
              >
                <div className="flex items-center gap-3">
                  <div className={cn(
                    "w-10 h-10 rounded-lg flex items-center justify-center text-xl",
                    isConnected
                      ? "bg-emerald-100 dark:bg-emerald-900/50"
                      : "bg-background border"
                  )}>
                    {icon || integration.displayName.charAt(0)}
                  </div>
                  <div>
                    <div className="font-medium text-sm">{integration.displayName}</div>
                    <div className="text-xs text-muted-foreground">
                      {integration.nodeCount} node{integration.nodeCount !== 1 ? 's' : ''} in workflow
                    </div>
                  </div>
                </div>

                {isConnected ? (
                  <div className="flex items-center gap-1.5 text-emerald-600 dark:text-emerald-400">
                    <CheckCircle2 className="w-4 h-4" />
                    <span className="text-sm font-medium">Connected</span>
                  </div>
                ) : (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => handleConnect(integration.providerId)}
                    disabled={isConnecting}
                    className="gap-1.5"
                  >
                    {isConnecting ? (
                      <>
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        Connecting...
                      </>
                    ) : (
                      <>
                        <ExternalLink className="w-3.5 h-3.5" />
                        Connect
                      </>
                    )}
                  </Button>
                )}
              </div>
            )
          })}
        </div>

        <div className="flex items-center justify-between pt-2 border-t">
          <Button
            variant="ghost"
            size="sm"
            onClick={handleRefresh}
            disabled={refreshing}
            className="gap-1.5"
          >
            <RefreshCw className={cn("w-3.5 h-3.5", refreshing && "animate-spin")} />
            Refresh Status
          </Button>

          <div className="flex gap-2">
            <Button variant="ghost" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button
              onClick={onAllConnected}
              disabled={!allConnected}
            >
              {allConnected ? "Run Test" : `Connect ${stillDisconnected.length} Account${stillDisconnected.length !== 1 ? 's' : ''}`}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

