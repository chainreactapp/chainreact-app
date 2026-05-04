/**
 * Overage usage reporter — drains task_overage_events to Stripe.
 *
 * Strategy (per decision #3, batched at period close):
 *  - Sum all unreported events for a user
 *  - Send ONE Stripe billing meter event per drain (event_name: 'task_overage')
 *  - On success, stamp reported_to_stripe_at + stripe_usage_record_id (== meter
 *    event identifier) on every event in the batch so the next drain skips them.
 *
 * Stripe API ≥ 2025-03-31.basil requires meter-backed metered prices. The legacy
 * `subscriptionItems.createUsageRecord` no longer works — usage is reported via
 * `billing.meterEvents.create` with the customer ID in the payload. Stripe routes
 * the event to whichever active subscription_item uses a price linked to this meter.
 * The meter is created by `scripts/setup-stripe-metered-prices.ts` (event_name
 * shared via METER_EVENT_NAME below).
 *
 * Idempotency: meter events accept an `identifier` field that Stripe dedupes on
 * server-side. We pass a deterministic hash of sorted event IDs — if the DB
 * update fails after Stripe success, the next cron tick re-sends with the same
 * identifier and Stripe drops it without double-charging.
 */

import { createHash } from 'crypto'
import { createAdminClient } from '@/lib/supabase/admin'
import { getStripeClient } from '@/lib/stripe/client'
import { logger } from '@/lib/utils/logger'

// Must match the event_name set in scripts/setup-stripe-metered-prices.ts.
const METER_EVENT_NAME = 'task_overage'

interface ReportResult {
  userId: string
  ok: boolean
  reportedCount: number
  reportedAmount: number
  stripeUsageRecordId?: string
  skipped?: 'no_events' | 'no_subscription_item' | 'no_customer'
  error?: string
}

interface OverageEventRow {
  id: string
  amount: number
  created_at: string
  stripe_subscription_item_id: string | null
}

/**
 * Drain a single user's unreported overage events to Stripe.
 *
 * Safe to call concurrently for different users. Concurrent calls for the same
 * user produce identical idempotency keys (same event-id set) → Stripe dedupes.
 */
export async function reportOverageToStripe(userId: string): Promise<ReportResult> {
  const supabase = createAdminClient()
  const stripe = getStripeClient()

  // Gate: user must have opted into overage (subscription_item exists).
  const { data: profile } = await supabase
    .from('user_profiles')
    .select('stripe_subscription_item_id')
    .eq('id', userId)
    .single()

  if (!profile?.stripe_subscription_item_id) {
    return { userId, ok: false, reportedCount: 0, reportedAmount: 0, skipped: 'no_subscription_item' }
  }

  // Meter events route by stripe_customer_id, not subscription_item.
  const { data: sub } = await supabase
    .from('subscriptions')
    .select('stripe_customer_id')
    .eq('user_id', userId)
    .in('status', ['active', 'trialing'])
    .order('current_period_end', { ascending: false, nullsFirst: false })
    .limit(1)
    .single()

  if (!sub?.stripe_customer_id) {
    return { userId, ok: false, reportedCount: 0, reportedAmount: 0, skipped: 'no_customer' }
  }
  const customerId = sub.stripe_customer_id

  // Drain all unreported events for this user. We do not filter by period_end —
  // meter events carry their own timestamp and Stripe attributes them to the
  // invoice period covering that timestamp.
  const { data: events, error: eventsError } = await supabase
    .from('task_overage_events')
    .select('id, amount, created_at, stripe_subscription_item_id')
    .eq('user_id', userId)
    .is('reported_to_stripe_at', null)
    .order('created_at', { ascending: true })
    .limit(1000)

  if (eventsError) {
    logger.error('[OverageReporter] Failed to fetch events', { userId, error: eventsError.message })
    return { userId, ok: false, reportedCount: 0, reportedAmount: 0, error: eventsError.message }
  }

  if (!events || events.length === 0) {
    return { userId, ok: true, reportedCount: 0, reportedAmount: 0, skipped: 'no_events' }
  }

  const totalAmount = (events as OverageEventRow[]).reduce((sum, e) => sum + e.amount, 0)

  // Meter event timestamp: most-recent event in the batch. Stripe will place
  // the usage in the period covering this timestamp.
  const latestTimestamp = Math.floor(
    new Date((events as OverageEventRow[])[events.length - 1].created_at).getTime() / 1000
  )

  // Deterministic identifier — a stable hash of the sorted event IDs. Stripe
  // dedupes meter events server-side by `identifier` within a 24h window.
  const sortedIds = (events as OverageEventRow[]).map((e) => e.id).sort().join(',')
  const identifier = `overage:${userId}:${createHash('sha256').update(sortedIds).digest('hex').slice(0, 24)}`

  // Send the consolidated meter event. Payload values must be strings.
  try {
    await stripe.billing.meterEvents.create({
      event_name: METER_EVENT_NAME,
      payload: {
        stripe_customer_id: customerId,
        value: String(totalAmount),
      },
      identifier,
      timestamp: latestTimestamp,
    })
  } catch (err: any) {
    logger.error('[OverageReporter] Stripe billing.meterEvents.create failed', {
      userId,
      customerId,
      identifier,
      error: err.message,
    })
    return { userId, ok: false, reportedCount: 0, reportedAmount: 0, error: err.message ?? 'Stripe error' }
  }

  // Stamp all reported events with the identifier and timestamp.
  const eventIds = (events as OverageEventRow[]).map((e) => e.id)
  const { error: updateError } = await supabase
    .from('task_overage_events')
    .update({
      reported_to_stripe_at: new Date().toISOString(),
      stripe_usage_record_id: identifier,
    })
    .in('id', eventIds)

  if (updateError) {
    // Stripe accepted the meter event. Our DB stamp failed — next drain re-uses
    // the same identifier, Stripe dedupes it, and the DB stamp is retried
    // without double-charging.
    logger.error('[OverageReporter] DB stamp failed after Stripe success — will retry next tick', {
      userId,
      identifier,
      error: updateError.message,
    })
    return {
      userId,
      ok: false,
      reportedCount: 0,
      reportedAmount: 0,
      stripeUsageRecordId: identifier,
      error: `DB stamp failed: ${updateError.message}`,
    }
  }

  logger.info('[OverageReporter] Reported to Stripe', {
    userId,
    customerId,
    identifier,
    reportedCount: events.length,
    reportedAmount: totalAmount,
  })

  return {
    userId,
    ok: true,
    reportedCount: events.length,
    reportedAmount: totalAmount,
    stripeUsageRecordId: identifier,
  }
}

/**
 * Find all users with unreported overage events and drain each.
 * Used by /api/cron/report-overage.
 */
export async function reportAllPendingOverage(): Promise<{
  attempted: number
  succeeded: number
  failed: number
  results: ReportResult[]
}> {
  const supabase = createAdminClient()

  // Distinct user_ids with at least one unreported event.
  const { data: pending, error } = await supabase
    .from('task_overage_events')
    .select('user_id')
    .is('reported_to_stripe_at', null)
    .limit(10000)

  if (error) {
    logger.error('[OverageReporter] Failed to fetch pending users', { error: error.message })
    return { attempted: 0, succeeded: 0, failed: 0, results: [] }
  }

  const uniqueUserIds = Array.from(new Set((pending ?? []).map((r: { user_id: string }) => r.user_id)))

  const results: ReportResult[] = []
  for (const userId of uniqueUserIds) {
    const result = await reportOverageToStripe(userId)
    results.push(result)
  }

  const succeeded = results.filter((r) => r.ok).length
  const failed = results.filter((r) => !r.ok).length

  return { attempted: results.length, succeeded, failed, results }
}
