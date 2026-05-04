import { NextRequest } from 'next/server'
import { jsonResponse, errorResponse } from '@/lib/utils/api-response'
import { requireAdmin } from '@/lib/utils/admin-auth'
import { logger } from '@/lib/utils/logger'

/**
 * GET /api/admin/billing/users
 *
 * Lists every user's billing state for the admin dashboard.
 * Capability gate: billing_admin (super_admin satisfies any capability).
 *
 * Query params:
 *   q     - text search on email
 *   plan  - filter by plan code
 *   limit - default 100, max 500
 */
export async function GET(request: NextRequest) {
  const auth = await requireAdmin({ capabilities: ['billing_admin'] })
  if (!auth.isAdmin) return auth.response

  const url = new URL(request.url)
  const q = url.searchParams.get('q')?.trim() ?? ''
  const planFilter = url.searchParams.get('plan')?.trim() ?? ''
  const limit = Math.min(500, Math.max(1, Number(url.searchParams.get('limit') ?? 100)))

  let query = auth.serviceClient
    .from('user_profiles')
    .select(`
      id,
      email,
      plan,
      tasks_used,
      tasks_limit,
      overage_enabled,
      overage_cap_multiplier,
      overage_tasks_used,
      task_pack_balance,
      auto_buy_packs,
      billing_period_start,
      billing_period_end
    `)
    .order('tasks_used', { ascending: false })
    .limit(limit)

  if (q) query = query.ilike('email', `%${q}%`)
  if (planFilter) query = query.eq('plan', planFilter)

  const { data, error } = await query

  if (error) {
    logger.error('[Admin Billing] Failed to load users', { error: error.message })
    return errorResponse('Failed to load users', 500)
  }

  return jsonResponse({ users: data ?? [], count: data?.length ?? 0 })
}
