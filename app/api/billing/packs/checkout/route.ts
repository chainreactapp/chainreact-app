import { NextRequest } from 'next/server'
import { jsonResponse, errorResponse } from '@/lib/utils/api-response'
import { createClient } from '@supabase/supabase-js'
import { getStripeClient } from '@/lib/stripe/client'
import { logger } from '@/lib/utils/logger'

/**
 * POST /api/billing/packs/checkout
 *
 * Body: {} (pack size + price are derived from the user's plan; one pack per tier per decision #8)
 *
 * Creates a Stripe Checkout Session in `mode: 'payment'` for a one-time pack
 * purchase. Pre-inserts a `pack_purchases` row with status='pending'; the
 * webhook flips it to 'paid' and credits user_profiles.task_pack_balance.
 *
 * Idempotent on re-click via the UNIQUE constraint on
 * pack_purchases.stripe_checkout_session_id.
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

  // Load user's plan + customer + pack metadata in parallel
  const { data: profile } = await supabase
    .from('user_profiles')
    .select('plan')
    .eq('id', user.id)
    .single()

  if (!profile?.plan) return errorResponse('User profile not found', 404)
  if (['free', 'beta', 'enterprise'].includes(profile.plan)) {
    return errorResponse(`Plan "${profile.plan}" is not eligible for task packs`, 400)
  }

  const { data: plan } = await supabase
    .from('plans')
    .select('pack_size, pack_price_cents, stripe_pack_price_id')
    .eq('name', profile.plan)
    .single()

  if (!plan?.stripe_pack_price_id || !plan.pack_size || !plan.pack_price_cents) {
    return errorResponse(`Pack pricing not configured for plan "${profile.plan}"`, 503)
  }

  const { data: subscription } = await supabase
    .from('subscriptions')
    .select('stripe_customer_id')
    .eq('user_id', user.id)
    .in('status', ['active', 'trialing'])
    .order('current_period_end', { ascending: false, nullsFirst: false })
    .limit(1)
    .single()

  if (!subscription?.stripe_customer_id) {
    return errorResponse('No active Stripe subscription found', 400)
  }

  const stripe = getStripeClient()

  // Determine return URLs (mirror checkout/route.ts pattern)
  const baseUrl =
    process.env.NEXT_PUBLIC_APP_URL ||
    `${request.headers.get('x-forwarded-proto') || 'https'}://${request.headers.get('host') || 'chainreact.app'}`

  let session
  try {
    session = await stripe.checkout.sessions.create({
      mode: 'payment',
      customer: subscription.stripe_customer_id,
      line_items: [{ price: plan.stripe_pack_price_id, quantity: 1 }],
      payment_intent_data: {
        setup_future_usage: 'off_session', // save the card for future auto-buys
        metadata: {
          user_id: user.id,
          plan_code: profile.plan,
          pack_size: String(plan.pack_size),
          purchase_kind: 'task_pack',
        },
      },
      metadata: {
        user_id: user.id,
        plan_code: profile.plan,
        pack_size: String(plan.pack_size),
        purchase_kind: 'task_pack',
        triggered_by: 'manual',
      },
      success_url: `${baseUrl}/subscription?pack_purchased=1`,
      cancel_url: `${baseUrl}/subscription?pack_canceled=1`,
    })
  } catch (err: any) {
    logger.error('[PackCheckout] Stripe session creation failed', { userId: user.id, error: err.message })
    return errorResponse(err.message ?? 'Stripe error', 502)
  }

  // Pre-insert a pending row keyed by session.id (UNIQUE) so the webhook can flip to paid.
  const { error: insertError } = await supabase.from('pack_purchases').insert({
    user_id: user.id,
    stripe_checkout_session_id: session.id,
    plan_code: profile.plan,
    pack_size: plan.pack_size,
    pack_price_cents: plan.pack_price_cents,
    tasks_remaining: 0,
    tasks_consumed: 0,
    status: 'pending',
    triggered_by: 'manual',
  })

  if (insertError) {
    logger.error('[PackCheckout] Failed to pre-insert pack_purchases row', {
      userId: user.id,
      sessionId: session.id,
      error: insertError.message,
    })
    return errorResponse('Failed to record pending purchase', 500)
  }

  logger.info('[PackCheckout] Session created', {
    userId: user.id,
    sessionId: session.id,
    plan: profile.plan,
    packSize: plan.pack_size,
  })

  return jsonResponse({ url: session.url, sessionId: session.id })
}
