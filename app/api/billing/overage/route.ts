import { NextRequest, NextResponse } from 'next/server'
import { jsonResponse, errorResponse } from '@/lib/utils/api-response'
import { createClient } from '@supabase/supabase-js'
import { logger } from '@/lib/utils/logger'
import { enableOverageForUser, disableOverageForUser } from '@/lib/billing/overage-toggle'

/**
 * GET — read current overage settings + usage for the authenticated user.
 * Returns enough context for the OverageToggle component to render.
 */
export async function GET(request: NextRequest) {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SECRET_KEY!
  )

  const token = request.headers.get('authorization')?.replace('Bearer ', '')
  if (!token) return errorResponse('Unauthorized', 401)

  const { data: { user }, error: authError } = await supabase.auth.getUser(token)
  if (authError || !user) return errorResponse('Unauthorized', 401)

  const { data: profile, error: profileError } = await supabase
    .from('user_profiles')
    .select('plan, overage_enabled, overage_cap_multiplier, overage_tasks_used, tasks_limit, tasks_used')
    .eq('id', user.id)
    .single()

  if (profileError || !profile) {
    logger.error('[Overage API] Failed to load profile', { userId: user.id, error: profileError?.message })
    return errorResponse('Failed to load profile', 500)
  }

  const { data: plan } = await supabase
    .from('plans')
    .select('limits')
    .eq('name', profile.plan)
    .single()

  const overageRate = (plan?.limits as { overageRate?: number } | null)?.overageRate ?? null

  return jsonResponse({
    plan: profile.plan,
    eligible: !['free', 'beta', 'enterprise'].includes(profile.plan),
    overageEnabled: profile.overage_enabled ?? false,
    overageCapMultiplier: Number(profile.overage_cap_multiplier ?? 2.0),
    overageTasksUsed: profile.overage_tasks_used ?? 0,
    overageRate,
    tasksUsed: profile.tasks_used ?? 0,
    tasksLimit: profile.tasks_limit,
  })
}

/**
 * POST — update overage settings.
 * Body: { enabled: boolean, capMultiplier?: number (1-5) }
 *
 * On enable: creates a metered Stripe subscription_item (idempotent).
 * On disable: deletes the metered subscription_item (idempotent).
 * Always: persists overage_enabled + overage_cap_multiplier on user_profiles.
 */
export async function POST(request: NextRequest) {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SECRET_KEY!
  )

  const token = request.headers.get('authorization')?.replace('Bearer ', '')
  if (!token) return errorResponse('Unauthorized', 401)

  const { data: { user }, error: authError } = await supabase.auth.getUser(token)
  if (authError || !user) return errorResponse('Unauthorized', 401)

  let body: { enabled?: boolean; capMultiplier?: number }
  try {
    body = await request.json()
  } catch {
    return errorResponse('Invalid JSON body', 400)
  }

  const enabled = Boolean(body.enabled)
  const capMultiplier = body.capMultiplier !== undefined ? Number(body.capMultiplier) : undefined

  if (capMultiplier !== undefined && (Number.isNaN(capMultiplier) || capMultiplier < 1 || capMultiplier > 5)) {
    return errorResponse('capMultiplier must be a number between 1 and 5', 400)
  }

  // Toggle Stripe-side first; only persist to DB on success.
  if (enabled) {
    const result = await enableOverageForUser(user.id)
    if (!result.ok) {
      const status = result.code === 'invalid_plan' || result.code === 'no_subscription' ? 400 : 502
      return errorResponse(result.error, status)
    }
  } else {
    const result = await disableOverageForUser(user.id)
    if (!result.ok) {
      return errorResponse(result.error, 502)
    }
  }

  // Persist DB state (also writes capMultiplier when supplied)
  const updates: Record<string, unknown> = { overage_enabled: enabled }
  if (capMultiplier !== undefined) updates.overage_cap_multiplier = capMultiplier

  const { error: updateError } = await supabase
    .from('user_profiles')
    .update(updates)
    .eq('id', user.id)

  if (updateError) {
    logger.error('[Overage API] Failed to persist settings after Stripe success', {
      userId: user.id,
      enabled,
      capMultiplier,
      error: updateError.message,
    })
    return errorResponse('Failed to persist settings', 500)
  }

  logger.info('[Overage API] Settings updated', { userId: user.id, enabled, capMultiplier })
  return jsonResponse({ enabled, capMultiplier: capMultiplier ?? null })
}
