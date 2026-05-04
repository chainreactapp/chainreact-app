/**
 * Off-session task pack auto-buy.
 *
 * Triggered when a workflow execution would otherwise hit insufficient_balance
 * AND the user has opted in via user_profiles.auto_buy_packs = true.
 *
 * Flow:
 *  1. Read plan + subscription state. Bail if any prerequisite missing.
 *  2. Pre-insert a pack_purchases row with status='pending' and triggered_by='auto_buy'.
 *  3. stripe.paymentIntents.create with off_session=true, confirm=true.
 *  4. On success: synchronously flip pending → paid, credit task_pack_balance,
 *     write task_billing_events 'pack_purchase' audit row.
 *  5. On requires_action (SCA): leave row pending, return ok=false with code='sca_required'.
 *  6. On hard decline / Stripe error: flip row to 'failed', return code='declined'.
 *
 * Caller behavior:
 *  - The current execution still 402s — auto-buy doesn't unblock the in-flight request.
 *  - The next execution attempt sees the credited balance and succeeds.
 *  - Returns a hint to the route so it can include "pack ordered, retry shortly"
 *    in the 402 body.
 */

import { createAdminClient } from '@/lib/supabase/admin'
import { getStripeClient } from '@/lib/stripe/client'
import { logger } from '@/lib/utils/logger'

export type AutoBuyResult =
  | { ok: true; packSize: number; newBalance: number; paymentIntentId: string }
  | { ok: false; code: AutoBuyFailureCode; error?: string }

export type AutoBuyFailureCode =
  | 'not_enabled'
  | 'plan_ineligible'
  | 'no_pack_configured'
  | 'no_subscription'
  | 'no_payment_method'
  | 'sca_required'
  | 'declined'
  | 'stripe_error'
  | 'db_error'

export async function triggerAutoBuyIfEnabled(userId: string): Promise<AutoBuyResult> {
  const supabase = createAdminClient()
  const stripe = getStripeClient()

  // 1. Load user profile + plan + subscription state in parallel-ish
  const { data: profile } = await supabase
    .from('user_profiles')
    .select('plan, auto_buy_packs, task_pack_balance')
    .eq('id', userId)
    .single()

  if (!profile?.auto_buy_packs) return { ok: false, code: 'not_enabled' }
  if (['free', 'beta', 'enterprise'].includes(profile.plan)) return { ok: false, code: 'plan_ineligible' }

  const { data: plan } = await supabase
    .from('plans')
    .select('pack_size, pack_price_cents, stripe_pack_price_id')
    .eq('name', profile.plan)
    .single()

  if (!plan?.pack_size || !plan.pack_price_cents) {
    return { ok: false, code: 'no_pack_configured' }
  }

  const { data: subscription } = await supabase
    .from('subscriptions')
    .select('stripe_customer_id, default_payment_method_id')
    .eq('user_id', userId)
    .in('status', ['active', 'trialing'])
    .order('current_period_end', { ascending: false, nullsFirst: false })
    .limit(1)
    .single()

  if (!subscription?.stripe_customer_id) {
    return { ok: false, code: 'no_subscription' }
  }
  if (!subscription.default_payment_method_id) {
    return { ok: false, code: 'no_payment_method' }
  }

  // 2. Pre-insert pending row. We use a UUID to key idempotency and surface to Stripe metadata.
  const { data: pending, error: pendingError } = await supabase
    .from('pack_purchases')
    .insert({
      user_id: userId,
      stripe_checkout_session_id: null,
      plan_code: profile.plan,
      pack_size: plan.pack_size,
      pack_price_cents: plan.pack_price_cents,
      tasks_remaining: 0,
      tasks_consumed: 0,
      status: 'pending',
      triggered_by: 'auto_buy',
    })
    .select('id')
    .single()

  if (pendingError || !pending) {
    logger.error('[AutoBuy] Failed to pre-insert pack_purchases row', {
      userId,
      error: pendingError?.message,
    })
    return { ok: false, code: 'db_error', error: pendingError?.message }
  }

  // 3. Create off-session payment intent. Idempotency key = pending.id so retries dedupe.
  let paymentIntent
  try {
    paymentIntent = await stripe.paymentIntents.create(
      {
        amount: plan.pack_price_cents,
        currency: 'usd',
        customer: subscription.stripe_customer_id,
        payment_method: subscription.default_payment_method_id,
        off_session: true,
        confirm: true,
        metadata: {
          user_id: userId,
          plan_code: profile.plan,
          pack_size: String(plan.pack_size),
          pack_purchase_id: pending.id,
          purchase_kind: 'task_pack',
          triggered_by: 'auto_buy',
        },
      },
      { idempotencyKey: `auto_buy:${pending.id}` }
    )
  } catch (err: any) {
    // Stripe throws on requires_action and hard declines (3DS / insufficient funds).
    const code: AutoBuyFailureCode =
      err.code === 'authentication_required' ? 'sca_required' : 'declined'

    await supabase
      .from('pack_purchases')
      .update({ status: 'failed' })
      .eq('id', pending.id)

    logger.warn('[AutoBuy] Payment intent failed', {
      userId,
      packPurchaseId: pending.id,
      stripeCode: err.code,
      error: err.message,
    })
    return { ok: false, code, error: err.message }
  }

  if (paymentIntent.status !== 'succeeded') {
    // Unexpected non-succeeded status (requires_action without throw, etc.)
    logger.warn('[AutoBuy] PaymentIntent did not reach succeeded synchronously', {
      userId,
      packPurchaseId: pending.id,
      status: paymentIntent.status,
    })
    return { ok: false, code: 'sca_required' }
  }

  // 4. Synchronously credit the user.
  const { error: flipError } = await supabase
    .from('pack_purchases')
    .update({
      status: 'paid',
      paid_at: new Date().toISOString(),
      stripe_payment_intent_id: paymentIntent.id,
      tasks_remaining: plan.pack_size,
    })
    .eq('id', pending.id)
    .eq('status', 'pending')

  if (flipError) {
    logger.error('[AutoBuy] Failed to flip pack_purchases to paid after Stripe success', {
      userId,
      packPurchaseId: pending.id,
      paymentIntentId: paymentIntent.id,
      error: flipError.message,
    })
    return { ok: false, code: 'db_error', error: flipError.message }
  }

  const newBalance = (profile.task_pack_balance ?? 0) + plan.pack_size
  const { error: balanceError } = await supabase
    .from('user_profiles')
    .update({ task_pack_balance: newBalance })
    .eq('id', userId)

  if (balanceError) {
    logger.error('[AutoBuy] Failed to credit task_pack_balance after pack flip', {
      userId,
      packPurchaseId: pending.id,
      error: balanceError.message,
    })
    return { ok: false, code: 'db_error', error: balanceError.message }
  }

  // Audit
  await supabase.from('task_billing_events').insert({
    user_id: userId,
    execution_id: paymentIntent.id,
    event_type: 'pack_purchase',
    amount: 0,
    node_breakdown: {},
    balance_after: 0,
    tasks_limit_snapshot: 0,
    period_start_snapshot: null,
    period_end_snapshot: null,
    workflow_id: null,
    source: 'auto_buy',
    metadata: {
      pack_size: plan.pack_size,
      pack_price_cents: plan.pack_price_cents,
      plan_code: profile.plan,
      stripe_payment_intent_id: paymentIntent.id,
      pack_purchase_id: pending.id,
      triggered_by: 'auto_buy',
      new_pack_balance: newBalance,
    },
  })

  logger.info('[AutoBuy] Pack credited', {
    userId,
    packSize: plan.pack_size,
    newBalance,
    paymentIntentId: paymentIntent.id,
  })

  return { ok: true, packSize: plan.pack_size, newBalance, paymentIntentId: paymentIntent.id }
}
