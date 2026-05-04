import { NextRequest } from 'next/server'
import { jsonResponse, errorResponse } from '@/lib/utils/api-response'
import { createClient } from '@supabase/supabase-js'
import { logger } from '@/lib/utils/logger'

/**
 * GET /api/billing/packs
 *
 * Returns the user's task pack summary for the TaskPackSection UI:
 *   - eligibility (plan tier check)
 *   - current pack balance
 *   - auto-buy toggle state
 *   - whether a saved payment method exists (gates auto-buy UI)
 *   - per-tier pack pricing
 *   - recent purchase history (most recent 25)
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

  const { data: profile } = await supabase
    .from('user_profiles')
    .select('plan, task_pack_balance, auto_buy_packs')
    .eq('id', user.id)
    .single()

  if (!profile) return errorResponse('User profile not found', 404)

  const { data: plan } = await supabase
    .from('plans')
    .select('pack_size, pack_price_cents')
    .eq('name', profile.plan)
    .single()

  const { data: subscription } = await supabase
    .from('subscriptions')
    .select('default_payment_method_id')
    .eq('user_id', user.id)
    .in('status', ['active', 'trialing'])
    .order('current_period_end', { ascending: false, nullsFirst: false })
    .limit(1)
    .single()

  const { data: history } = await supabase
    .from('pack_purchases')
    .select('id, plan_code, pack_size, pack_price_cents, status, triggered_by, created_at, paid_at, refunded_at, tasks_remaining, tasks_consumed')
    .eq('user_id', user.id)
    .order('created_at', { ascending: false })
    .limit(25)

  return jsonResponse({
    plan: profile.plan,
    eligible: !['free', 'beta', 'enterprise'].includes(profile.plan),
    packBalance: profile.task_pack_balance ?? 0,
    autoBuyEnabled: profile.auto_buy_packs ?? false,
    hasPaymentMethod: Boolean(subscription?.default_payment_method_id),
    packSize: plan?.pack_size ?? null,
    packPriceCents: plan?.pack_price_cents ?? null,
    history: history ?? [],
  })
}

/**
 * PATCH /api/billing/packs
 *
 * Body: { autoBuyEnabled: boolean }
 *
 * Updates the user's auto-buy preference. No Stripe-side state to mutate;
 * the flag is read by the execute route at the 402 path.
 */
export async function PATCH(request: NextRequest) {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SECRET_KEY!
  )

  const token = request.headers.get('authorization')?.replace('Bearer ', '')
  if (!token) return errorResponse('Unauthorized', 401)

  const { data: { user }, error: authError } = await supabase.auth.getUser(token)
  if (authError || !user) return errorResponse('Unauthorized', 401)

  let body: { autoBuyEnabled?: boolean }
  try {
    body = await request.json()
  } catch {
    return errorResponse('Invalid JSON body', 400)
  }

  if (typeof body.autoBuyEnabled !== 'boolean') {
    return errorResponse('autoBuyEnabled must be a boolean', 400)
  }

  // Validate plan eligibility before persisting (defense in depth — UI also hides for ineligible plans)
  const { data: profile } = await supabase
    .from('user_profiles')
    .select('plan')
    .eq('id', user.id)
    .single()

  if (!profile) return errorResponse('User profile not found', 404)
  if (['free', 'beta', 'enterprise'].includes(profile.plan)) {
    return errorResponse(`Plan "${profile.plan}" is not eligible for task packs`, 400)
  }

  const { error: updateError } = await supabase
    .from('user_profiles')
    .update({ auto_buy_packs: body.autoBuyEnabled })
    .eq('id', user.id)

  if (updateError) {
    logger.error('[Packs API] Failed to update auto_buy_packs', {
      userId: user.id,
      error: updateError.message,
    })
    return errorResponse('Failed to save preference', 500)
  }

  logger.info('[Packs API] Auto-buy preference updated', {
    userId: user.id,
    autoBuyEnabled: body.autoBuyEnabled,
  })

  return jsonResponse({ autoBuyEnabled: body.autoBuyEnabled })
}
