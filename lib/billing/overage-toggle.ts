/**
 * Overage opt-in / opt-out service.
 *
 * Adds or removes the Stripe metered subscription_item that captures
 * overage usage. Mirrors the user's plan tier and billing cycle.
 *
 * Idempotent on both directions — safe to call multiple times.
 */

import { createAdminClient } from '@/lib/supabase/admin'
import { getStripeClient } from '@/lib/stripe/client'
import { logger } from '@/lib/utils/logger'

/**
 * Tasks of overage-meter usage that triggers a separate Stripe invoice for users on
 * yearly subscriptions. Without this, Stripe would only invoice metered usage once a
 * year on the parent renewal, violating decision #9 (annual subs invoiced monthly).
 *
 * 1,000 tasks ≈ $25 at Pro rate / $20 at Team / $15 at Business — a reasonable
 * batching point for the typical user. Tunable: lower = more frequent invoices +
 * more Stripe API noise; higher = users may go months between overage invoices.
 */
const YEARLY_OVERAGE_USAGE_THRESHOLD = 1000

export type EnableOverageResult =
  | { ok: true; subscriptionItemId: string }
  | { ok: false; error: string; code: 'no_subscription' | 'no_metered_price' | 'invalid_plan' | 'stripe_error' }

export async function enableOverageForUser(userId: string): Promise<EnableOverageResult> {
  const supabase = createAdminClient()
  const stripe = getStripeClient()

  // 1. Load user profile + active subscription + plan in parallel
  const { data: profile } = await supabase
    .from('user_profiles')
    .select('plan, stripe_subscription_item_id')
    .eq('id', userId)
    .single()

  if (!profile) {
    return { ok: false, error: 'User profile not found', code: 'invalid_plan' }
  }

  if (profile.plan === 'free' || profile.plan === 'beta' || profile.plan === 'enterprise') {
    return {
      ok: false,
      error: `Plan "${profile.plan}" is not eligible for overage billing`,
      code: 'invalid_plan',
    }
  }

  // If user already has a metered item, verify it exists in Stripe and return idempotently
  if (profile.stripe_subscription_item_id) {
    try {
      const item = await stripe.subscriptionItems.retrieve(profile.stripe_subscription_item_id)
      if (item && !item.deleted) {
        logger.info('[Overage] Already enabled (idempotent)', { userId, subscriptionItemId: item.id })
        return { ok: true, subscriptionItemId: item.id }
      }
    } catch {
      // Item was deleted in Stripe — clear stale ID and re-create below
      logger.warn('[Overage] stripe_subscription_item_id is stale; re-creating', { userId })
    }
  }

  const { data: sub } = await supabase
    .from('subscriptions')
    .select('stripe_subscription_id, billing_cycle, status')
    .eq('user_id', userId)
    .in('status', ['active', 'trialing'])
    .order('current_period_end', { ascending: false, nullsFirst: false })
    .limit(1)
    .single()

  if (!sub?.stripe_subscription_id) {
    return { ok: false, error: 'No active Stripe subscription found', code: 'no_subscription' }
  }

  const cycle = sub.billing_cycle === 'yearly' ? 'yearly' : 'monthly'

  // 2. Resolve metered price ID from plans
  const { data: plan } = await supabase
    .from('plans')
    .select(cycle === 'yearly' ? 'stripe_metered_price_id_yearly' : 'stripe_metered_price_id_monthly')
    .eq('name', profile.plan)
    .single()

  const meteredPriceId = (plan as Record<string, string | null> | null)?.[
    cycle === 'yearly' ? 'stripe_metered_price_id_yearly' : 'stripe_metered_price_id_monthly'
  ]

  if (!meteredPriceId) {
    return {
      ok: false,
      error: `No metered price configured for plan ${profile.plan} (${cycle})`,
      code: 'no_metered_price',
    }
  }

  // 3. Check if subscription already has the metered item (idempotent guard)
  const existingItems = await stripe.subscriptionItems.list({
    subscription: sub.stripe_subscription_id,
    limit: 100,
  })
  const existing = existingItems.data.find((i) => i.price.id === meteredPriceId)
  if (existing) {
    await supabase
      .from('user_profiles')
      .update({ stripe_subscription_item_id: existing.id })
      .eq('id', userId)
    logger.info('[Overage] Found existing metered item, persisted ID', { userId, itemId: existing.id })
    return { ok: true, subscriptionItemId: existing.id }
  }

  // 4. Create the metered subscription_item.
  // For yearly subs, set billing_thresholds to force monthly invoicing per decision #9.
  try {
    const item = await stripe.subscriptionItems.create({
      subscription: sub.stripe_subscription_id,
      price: meteredPriceId,
      ...(cycle === 'yearly'
        ? { billing_thresholds: { usage_gte: YEARLY_OVERAGE_USAGE_THRESHOLD } }
        : {}),
      proration_behavior: 'none',
    })

    await supabase
      .from('user_profiles')
      .update({ stripe_subscription_item_id: item.id })
      .eq('id', userId)

    logger.info('[Overage] Enabled', { userId, plan: profile.plan, cycle, itemId: item.id })
    return { ok: true, subscriptionItemId: item.id }
  } catch (err: any) {
    logger.error('[Overage] Stripe subscriptionItems.create failed', { userId, error: err.message })
    return { ok: false, error: err.message ?? 'Stripe error', code: 'stripe_error' }
  }
}

export type DisableOverageResult =
  | { ok: true }
  | { ok: false; error: string }

export async function disableOverageForUser(userId: string): Promise<DisableOverageResult> {
  const supabase = createAdminClient()
  const stripe = getStripeClient()

  const { data: profile } = await supabase
    .from('user_profiles')
    .select('stripe_subscription_item_id')
    .eq('id', userId)
    .single()

  // No item recorded — nothing to do (idempotent)
  if (!profile?.stripe_subscription_item_id) {
    return { ok: true }
  }

  try {
    await stripe.subscriptionItems.del(profile.stripe_subscription_item_id, {
      proration_behavior: 'none',
      clear_usage: false, // preserve usage records so end-of-period invoice still bills correctly
    })
  } catch (err: any) {
    // 404 = already deleted in Stripe; clear our reference and continue
    if (err.statusCode !== 404) {
      logger.error('[Overage] Stripe subscriptionItems.del failed', { userId, error: err.message })
      return { ok: false, error: err.message ?? 'Stripe error' }
    }
    logger.warn('[Overage] Subscription item already deleted in Stripe', { userId })
  }

  await supabase
    .from('user_profiles')
    .update({ stripe_subscription_item_id: null })
    .eq('id', userId)

  logger.info('[Overage] Disabled', { userId })
  return { ok: true }
}
