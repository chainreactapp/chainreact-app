"use client"

import { useEffect, useState, useCallback } from "react"
import { useRouter } from "next/navigation"
import { useAuthStore } from "@/stores/authStore"
import { isProfileAdmin } from "@/lib/types/admin"
import { LightningLoader } from "@/components/ui/lightning-loader"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { Loader2, RefreshCw } from "lucide-react"
import { fetchWithTimeout } from "@/lib/utils/fetch-with-timeout"
import { createClient } from "@/utils/supabase/client"
import { logger } from "@/lib/utils/logger"

interface BillingRow {
  id: string
  email: string
  plan: string
  tasks_used: number
  tasks_limit: number
  overage_enabled: boolean
  overage_cap_multiplier: number
  overage_tasks_used: number
  task_pack_balance: number
  auto_buy_packs: boolean
  billing_period_start: string | null
  billing_period_end: string | null
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

export default function AdminBillingPage() {
  const { profile } = useAuthStore()
  const router = useRouter()
  const [rows, setRows] = useState<BillingRow[]>([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [search, setSearch] = useState("")
  const [error, setError] = useState<string | null>(null)

  const fetchData = useCallback(async (q: string) => {
    setRefreshing(true)
    setError(null)
    try {
      const token = await getAuthToken()
      if (!token) throw new Error("Not signed in")

      const params = new URLSearchParams()
      if (q) params.set("q", q)

      const response = await fetchWithTimeout(
        `/api/admin/billing/users?${params.toString()}`,
        { method: "GET", headers: { Authorization: `Bearer ${token}` } },
        15000
      )
      if (!response.ok) {
        const data = await response.json().catch(() => ({}))
        throw new Error(data.error || `Failed to load (${response.status})`)
      }
      const data = await response.json()
      setRows(data.users ?? [])
    } catch (err: any) {
      setError(err.message ?? "Failed to load billing data")
      logger.error("[Admin Billing] Fetch failed", { error: err.message })
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }, [])

  useEffect(() => {
    if (!profile) return
    if (!isProfileAdmin(profile)) {
      router.push("/workflows")
      return
    }
    fetchData("")
  }, [profile, router, fetchData])

  if (!profile) {
    return (
      <div className="flex-1 flex items-center justify-center min-h-[400px]">
        <LightningLoader size="lg" color="primary" />
      </div>
    )
  }

  if (!isProfileAdmin(profile)) return null

  const formatDate = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString() : "—")

  return (
    <div className="max-w-7xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Admin · Billing</h1>
        <p className="text-sm text-muted-foreground">Per-user task usage, overage, and pack balance.</p>
      </div>

      <Card>
        <CardHeader>
          <div className="flex items-end gap-2">
            <div className="flex-1 max-w-sm">
              <CardTitle className="text-base mb-2">Search</CardTitle>
              <CardDescription className="mb-2">Filter by email substring.</CardDescription>
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") fetchData(search.trim())
                }}
                placeholder="user@example.com"
              />
            </div>
            <button
              type="button"
              onClick={() => fetchData(search.trim())}
              disabled={refreshing}
              className="px-4 py-2 rounded-lg bg-orange-500 text-white text-sm font-medium hover:bg-orange-400 disabled:opacity-50 inline-flex items-center gap-2"
            >
              {refreshing ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
              Refresh
            </button>
          </div>
        </CardHeader>
      </Card>

      {error && (
        <Card>
          <CardContent className="py-4 text-sm text-red-600 dark:text-red-400">{error}</CardContent>
        </Card>
      )}

      {loading ? (
        <Card>
          <CardContent className="py-10 flex items-center justify-center">
            <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
          </CardContent>
        </Card>
      ) : rows.length === 0 ? (
        <Card>
          <CardContent className="py-10 text-center text-muted-foreground text-sm">No users match.</CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="p-0 overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/40 text-xs">
                <tr className="text-left">
                  <th className="px-3 py-2 font-medium">Email</th>
                  <th className="px-3 py-2 font-medium">Plan</th>
                  <th className="px-3 py-2 font-medium text-right">Tasks used</th>
                  <th className="px-3 py-2 font-medium text-right">Limit</th>
                  <th className="px-3 py-2 font-medium text-right">% used</th>
                  <th className="px-3 py-2 font-medium text-right">Overage</th>
                  <th className="px-3 py-2 font-medium text-right">Pack bal.</th>
                  <th className="px-3 py-2 font-medium">Flags</th>
                  <th className="px-3 py-2 font-medium">Period ends</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {rows.map((u) => {
                  const pct = u.tasks_limit > 0 ? Math.round((u.tasks_used / u.tasks_limit) * 100) : 0
                  return (
                    <tr key={u.id} className="hover:bg-muted/30">
                      <td className="px-3 py-2 font-mono text-xs truncate max-w-[220px]">{u.email}</td>
                      <td className="px-3 py-2 capitalize">{u.plan}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{u.tasks_used.toLocaleString()}</td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        {u.tasks_limit === -1 ? "∞" : u.tasks_limit.toLocaleString()}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        <span className={pct >= 100 ? "text-red-600 font-medium" : pct >= 80 ? "text-amber-600" : ""}>
                          {pct}%
                        </span>
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        {u.overage_enabled ? (
                          <span>
                            {u.overage_tasks_used.toLocaleString()}
                            <span className="text-xs text-muted-foreground ml-1">
                              / {u.overage_cap_multiplier}×
                            </span>
                          </span>
                        ) : (
                          <span className="text-muted-foreground">off</span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">{u.task_pack_balance.toLocaleString()}</td>
                      <td className="px-3 py-2">
                        <div className="flex gap-1 flex-wrap">
                          {u.overage_enabled && (
                            <Badge variant="outline" className="text-[10px] h-5">overage</Badge>
                          )}
                          {u.auto_buy_packs && (
                            <Badge variant="outline" className="text-[10px] h-5">auto-buy</Badge>
                          )}
                        </div>
                      </td>
                      <td className="px-3 py-2 text-xs text-muted-foreground">{formatDate(u.billing_period_end)}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
