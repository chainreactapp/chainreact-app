"use client"

/**
 * V2 Execution Rollout — admin panel for the
 * `user_profiles.opt_in_v2_execution` toggle.
 *
 * Used during Phase 5 stages 1-2 of the v2 canonical engine consolidation
 * (see learning/docs/v2-canonical-execution-engine-plan.md). Lists users
 * currently opted in, lets super_admins toggle the flag for any user
 * via email lookup. Step-up auth required for the toggle (treated as
 * destructive — flipping engine routing changes which engine bills +
 * executes the user's workflows).
 *
 * The component itself does not enforce admin/capability — the API
 * route at `/api/admin/v2-execution-opt-in` does. Capability gating in
 * the UI is purely cosmetic (hides the panel from non-admins).
 *
 * Removed in Phase 5 stage 5 alongside v1 deletion + the underlying
 * column drop.
 */

import { useEffect, useState, useCallback } from "react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { Badge } from "@/components/ui/badge"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { useToast } from "@/hooks/use-toast"
import { useAdminAction } from "@/hooks/useAdminAction"
import { StepUpAuthDialog } from "@/components/admin/StepUpAuthDialog"
import { Activity, AlertTriangle, Loader2, RefreshCw, Search, ShieldAlert } from "lucide-react"
import { logger } from '@/lib/utils/logger'

interface OptedInUser {
  id: string
  email: string | null
  opt_in_v2_execution: boolean
}

export default function V2ExecutionRollout() {
  const { toast } = useToast()
  const { execute, retry, needsStepUp, setNeedsStepUp, loading: toggleLoading } = useAdminAction()

  const [optedInUsers, setOptedInUsers] = useState<OptedInUser[]>([])
  const [listLoading, setListLoading] = useState(true)
  const [listError, setListError] = useState<string | null>(null)

  const [targetUserId, setTargetUserId] = useState("")
  const [targetOptIn, setTargetOptIn] = useState(true)

  const fetchOptedInUsers = useCallback(async () => {
    setListLoading(true)
    setListError(null)
    try {
      const res = await fetch("/api/admin/v2-execution-opt-in")
      if (!res.ok) {
        const text = await res.text()
        throw new Error(text || `HTTP ${res.status}`)
      }
      const data = await res.json()
      setOptedInUsers(data.users ?? [])
    } catch (err: any) {
      logger.error("[V2Rollout] Failed to fetch opted-in users", { error: err?.message })
      setListError(err?.message ?? "Failed to fetch opted-in users")
    } finally {
      setListLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchOptedInUsers()
  }, [fetchOptedInUsers])

  const handleToggle = async () => {
    if (!targetUserId.trim()) {
      toast({ title: "Missing user ID", description: "Enter a user ID first", variant: "destructive" })
      return
    }

    await execute(
      "/api/admin/v2-execution-opt-in",
      {
        method: "POST",
        body: JSON.stringify({
          targetUserId: targetUserId.trim(),
          optIn: targetOptIn,
        }),
      },
      (data: any) => {
        toast({
          title: data?.idempotent
            ? "Already at requested value"
            : targetOptIn
              ? "v2 opt-in enabled"
              : "v2 opt-in disabled",
          description: data?.idempotent
            ? `User ${targetUserId} was already ${targetOptIn ? "opted in" : "opted out"}.`
            : `User ${targetUserId} is now ${targetOptIn ? "routed to v2" : "routed to v1"} for live executions.`,
        })
        setTargetUserId("")
        fetchOptedInUsers()
      },
      (err: string) => {
        toast({ title: "Toggle failed", description: err, variant: "destructive" })
      },
    )
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Activity className="h-5 w-5" />
            v2 Execution Rollout
          </CardTitle>
          <CardDescription>
            Per-user opt-in for the v2 (`WorkflowExecutionService`) live-execution
            path. Live, sequential, scheduled, and webhook runs go through v2 only
            when both `ENABLE_V2_LIVE_EXECUTION` is on AND the user has opt-in
            enabled. Sandbox/test runs are unaffected. super_admin only; toggling
            requires step-up authentication.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <Alert className="border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-500/50 dark:bg-amber-500/10 dark:text-amber-200">
            <ShieldAlert className="h-4 w-4" />
            <AlertDescription>
              Flipping a user's opt-in changes which engine bills + executes
              their workflows on the next run. There's no v1 fallback if v2
              fails — failures surface to the user as workflow errors. Use
              during staged rollout only.
            </AlertDescription>
          </Alert>

          <div className="grid grid-cols-1 gap-3 md:grid-cols-[1fr_auto_auto]">
            <div className="space-y-1">
              <Label htmlFor="v2-target-user-id">User ID</Label>
              <Input
                id="v2-target-user-id"
                placeholder="user-uuid"
                value={targetUserId}
                onChange={(e) => setTargetUserId(e.target.value)}
                disabled={toggleLoading}
              />
            </div>
            <div className="flex items-end gap-3">
              <div className="flex flex-col items-center gap-1">
                <Label htmlFor="v2-target-opt-in" className="text-xs text-muted-foreground">
                  Opt-in
                </Label>
                <Switch
                  id="v2-target-opt-in"
                  checked={targetOptIn}
                  onCheckedChange={setTargetOptIn}
                  disabled={toggleLoading}
                />
              </div>
            </div>
            <div className="flex items-end">
              <Button onClick={handleToggle} disabled={toggleLoading || !targetUserId.trim()}>
                {toggleLoading ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Saving...
                  </>
                ) : (
                  <>{targetOptIn ? "Enable" : "Disable"} for user</>
                )}
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <CardTitle>Opted-in users</CardTitle>
            <CardDescription>
              {listLoading
                ? "Loading..."
                : `${optedInUsers.length} user${optedInUsers.length === 1 ? "" : "s"} routed to v2`}
            </CardDescription>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={fetchOptedInUsers}
            disabled={listLoading}
          >
            <RefreshCw className={`mr-2 h-4 w-4 ${listLoading ? "animate-spin" : ""}`} />
            Refresh
          </Button>
        </CardHeader>
        <CardContent>
          {listError ? (
            <Alert variant="destructive">
              <AlertTriangle className="h-4 w-4" />
              <AlertDescription className="flex items-center justify-between">
                <span>{listError}</span>
                <Button variant="outline" size="sm" onClick={fetchOptedInUsers}>
                  Retry
                </Button>
              </AlertDescription>
            </Alert>
          ) : optedInUsers.length === 0 && !listLoading ? (
            <p className="text-sm text-muted-foreground">
              No users currently opted in. The list refreshes after a successful toggle.
            </p>
          ) : (
            <ul className="divide-y divide-border">
              {optedInUsers.map((u) => (
                <li key={u.id} className="flex items-center justify-between py-3">
                  <div className="space-y-0.5">
                    <p className="text-sm font-medium text-foreground">
                      {u.email ?? "(no email)"}
                    </p>
                    <p className="font-mono text-xs text-muted-foreground">{u.id}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge
                      variant="outline"
                      className="bg-emerald-100 text-emerald-800 dark:bg-emerald-500/20 dark:text-emerald-300"
                    >
                      v2
                    </Badge>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        setTargetUserId(u.id)
                        setTargetOptIn(false)
                      }}
                      disabled={toggleLoading}
                    >
                      Disable
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <StepUpAuthDialog
        open={needsStepUp}
        onOpenChange={setNeedsStepUp}
        onVerified={retry}
        onCancel={() => setNeedsStepUp(false)}
      />
    </div>
  )
}
