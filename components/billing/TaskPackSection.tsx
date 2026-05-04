"use client"

import React, { useEffect, useState, useCallback } from "react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Switch } from "@/components/ui/switch"
import { Button } from "@/components/ui/button"
import { Loader2, AlertTriangle, Package, ExternalLink } from "lucide-react"
import { fetchWithTimeout } from "@/lib/utils/fetch-with-timeout"
import { createClient } from "@/utils/supabase/client"
import { logger } from "@/lib/utils/logger"

interface PurchaseRow {
  id: string
  plan_code: string
  pack_size: number
  pack_price_cents: number
  status: 'pending' | 'paid' | 'refunded' | 'failed'
  triggered_by: 'manual' | 'auto_buy'
  created_at: string
  paid_at: string | null
  refunded_at: string | null
  tasks_remaining: number
  tasks_consumed: number
}

interface PackState {
  plan: string
  eligible: boolean
  packBalance: number
  autoBuyEnabled: boolean
  hasPaymentMethod: boolean
  packSize: number | null
  packPriceCents: number | null
  history: PurchaseRow[]
}

async function getAuthToken(): Promise<string | null> {
  try {
    const supabase = createClient()
    const { data: { session } } = await supabase.auth.getSession()
    return session?.access_token ?? null
  } catch {
    return null
  }
}

export function TaskPackSection() {
  const [state, setState] = useState<PackState | null>(null)
  const [loading, setLoading] = useState(true)
  const [savingAutoBuy, setSavingAutoBuy] = useState(false)
  const [purchasing, setPurchasing] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const fetchState = useCallback(async () => {
    try {
      const token = await getAuthToken()
      if (!token) {
        setError("Not signed in")
        setLoading(false)
        return
      }
      const response = await fetchWithTimeout(
        "/api/billing/packs",
        { method: "GET", headers: { Authorization: `Bearer ${token}` } },
        10000
      )
      if (!response.ok) {
        const data = await response.json().catch(() => ({}))
        throw new Error(data.error || `Failed to load packs (${response.status})`)
      }
      setState(await response.json())
      setError(null)
    } catch (err: any) {
      setError(err.message ?? "Failed to load packs")
      logger.error("[TaskPackSection] Fetch failed", { error: err.message })
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchState()
  }, [fetchState])

  const handleBuyPack = async () => {
    setPurchasing(true)
    setError(null)
    try {
      const token = await getAuthToken()
      if (!token) throw new Error("Not signed in")
      const response = await fetchWithTimeout(
        "/api/billing/packs/checkout",
        {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
          body: JSON.stringify({}),
        },
        15000
      )
      if (!response.ok) {
        const data = await response.json().catch(() => ({}))
        throw new Error(data.error || `Checkout failed (${response.status})`)
      }
      const data = await response.json()
      if (data.url) {
        window.location.href = data.url
      } else {
        throw new Error("Checkout URL missing in response")
      }
    } catch (err: any) {
      setError(err.message ?? "Failed to start checkout")
      logger.error("[TaskPackSection] Checkout failed", { error: err.message })
      setPurchasing(false)
    }
  }

  const handleAutoBuyToggle = async (enabled: boolean) => {
    setSavingAutoBuy(true)
    setError(null)
    try {
      const token = await getAuthToken()
      if (!token) throw new Error("Not signed in")
      const response = await fetchWithTimeout(
        "/api/billing/packs",
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
          body: JSON.stringify({ autoBuyEnabled: enabled }),
        },
        10000
      )
      if (!response.ok) {
        const data = await response.json().catch(() => ({}))
        throw new Error(data.error || `Failed to save (${response.status})`)
      }
      await fetchState()
    } catch (err: any) {
      setError(err.message ?? "Failed to save preference")
      logger.error("[TaskPackSection] Auto-buy save failed", { error: err.message })
      await fetchState()
    } finally {
      setSavingAutoBuy(false)
    }
  }

  if (loading) {
    return (
      <Card>
        <CardContent className="flex items-center justify-center py-6">
          <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
        </CardContent>
      </Card>
    )
  }

  if (!state || !state.eligible) {
    return null
  }

  const packDollars = state.packPriceCents ? (state.packPriceCents / 100).toFixed(0) : "—"

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-lg">
          <Package className="w-4 h-4 text-orange-500" />
          Task packs
        </CardTitle>
        <CardDescription>
          One-time pack purchases. Tasks never expire — they survive period rolls and plan downgrades.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        {error && (
          <div className="flex items-start gap-2 p-3 rounded-lg bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800">
            <AlertTriangle className="w-4 h-4 mt-0.5 text-red-600 dark:text-red-400 shrink-0" />
            <p className="text-sm text-red-700 dark:text-red-300">{error}</p>
          </div>
        )}

        <div className="grid grid-cols-2 gap-3">
          <div>
            <p className="text-xs text-muted-foreground">Pack balance</p>
            <p className="text-2xl font-semibold tabular-nums">
              {state.packBalance.toLocaleString()}
              <span className="text-sm font-normal text-muted-foreground ml-1">tasks</span>
            </p>
          </div>
          <div className="text-right">
            {state.packSize && state.packPriceCents ? (
              <Button
                onClick={handleBuyPack}
                disabled={purchasing}
                className="bg-orange-500 hover:bg-orange-400 text-white"
              >
                {purchasing ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <>
                    Buy {state.packSize.toLocaleString()} for ${packDollars}
                    <ExternalLink className="w-3.5 h-3.5 ml-1.5" />
                  </>
                )}
              </Button>
            ) : (
              <p className="text-xs text-muted-foreground">Pack pricing not configured</p>
            )}
          </div>
        </div>

        <div className="border-t pt-4 space-y-2">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium">Auto-buy when balance reaches zero</p>
              <p className="text-xs text-muted-foreground mt-0.5">
                {state.hasPaymentMethod
                  ? "Charges your saved card. The current run still 402s — retry to use the new balance."
                  : "Requires a saved payment method (complete a regular checkout first)."}
              </p>
            </div>
            <Switch
              checked={state.autoBuyEnabled}
              disabled={savingAutoBuy || !state.hasPaymentMethod}
              onCheckedChange={handleAutoBuyToggle}
            />
          </div>
        </div>

        {state.history.length > 0 && (
          <div className="border-t pt-4">
            <p className="text-sm font-medium mb-2">Recent purchases</p>
            <div className="space-y-1 max-h-48 overflow-y-auto text-xs">
              {state.history.map((row) => {
                const dollars = (row.pack_price_cents / 100).toFixed(2)
                const date = new Date(row.paid_at ?? row.created_at).toLocaleDateString()
                return (
                  <div
                    key={row.id}
                    className="flex justify-between items-center px-2 py-1 rounded hover:bg-muted/40"
                  >
                    <span className="text-muted-foreground">
                      {date} — {row.pack_size.toLocaleString()} tasks
                      {row.triggered_by === 'auto_buy' && (
                        <span className="ml-1.5 text-[10px] px-1.5 py-0.5 rounded bg-blue-100 dark:bg-blue-950/40 text-blue-700 dark:text-blue-300">
                          auto
                        </span>
                      )}
                    </span>
                    <span className="flex items-center gap-2 tabular-nums">
                      <span className="font-medium">${dollars}</span>
                      <span
                        className={
                          row.status === "paid"
                            ? "text-green-600 dark:text-green-400"
                            : row.status === "pending"
                              ? "text-amber-600 dark:text-amber-400"
                              : row.status === "refunded"
                                ? "text-slate-500"
                                : "text-red-600 dark:text-red-400"
                        }
                      >
                        {row.status}
                      </span>
                    </span>
                  </div>
                )
              })}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
