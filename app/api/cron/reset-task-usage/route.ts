import { createClient } from "@supabase/supabase-js"
import { NextRequest, NextResponse } from "next/server"
import { logger } from "@/lib/utils/logger"

/**
 * Billing period task usage reset — safety net for ALL users.
 *
 * Primary reset mechanisms:
 * - RPC inline auto-reset: resets expired periods during deduction calls
 * - Stripe webhook: resets paid users on invoice.payment_succeeded
 *
 * This cron is a SAFETY NET that catches users whose period expired but
 * weren't reset by the primary mechanisms (e.g., users who haven't executed
 * a workflow since their period expired, or webhook delivery failures).
 *
 * Runs daily at midnight UTC.
 *
 * Free/beta users: Reset tasks_used, advance billing period (rolling 30-day).
 * Paid users (active sub): Reset tasks_used, do NOT advance period (webhook handles that).
 * Paid users (non-active sub): Do NOT reset. Emit reconciliation alert.
 */
export async function GET(request: NextRequest) {
  // Verify cron secret
  const authHeader = request.headers.get("authorization")
  const cronSecret = process.env.CRON_SECRET
  const providedSecret = authHeader?.replace("Bearer ", "") ||
                         request.nextUrl.searchParams.get("secret")

  if (!cronSecret || providedSecret !== cronSecret) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SECRET_KEY!
  )

  logger.info("[Cron] Starting task usage reset check (all users)...")

  try {
    const now = new Date()

    // Find ALL users with expired billing period and tasks_used > 0 OR overage_tasks_used > 0
    const { data: usersToReset, error: fetchError } = await supabase
      .from('user_profiles')
      .select('id, plan, tasks_used, tasks_limit, overage_tasks_used, billing_period_start, billing_period_end')
      .or('tasks_used.gt.0,overage_tasks_used.gt.0')
      .lt('billing_period_end', now.toISOString())

    if (fetchError) {
      logger.error('[Cron] Failed to fetch users for task reset:', fetchError)
      return NextResponse.json({ error: 'Failed to fetch users' }, { status: 500 })
    }

    if (!usersToReset || usersToReset.length === 0) {
      logger.info('[Cron] No users need task reset')
      return NextResponse.json({ processed: 0 })
    }

    let freeResetCount = 0
    let paidResetCount = 0
    let paidSkippedCount = 0
    let errorCount = 0

    for (const user of usersToReset) {
      const isFreeOrBeta = user.plan === 'free' || user.plan === 'beta'

      if (isFreeOrBeta) {
        // Free/beta users: reset and advance period
        const newPeriodEnd = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000)

        const { data: updated, error: resetError } = await supabase
          .from('user_profiles')
          .update({
            tasks_used: 0,
            overage_tasks_used: 0,
            billing_period_start: now.toISOString(),
            billing_period_end: newPeriodEnd.toISOString()
          })
          .eq('id', user.id)
          .or('tasks_used.gt.0,overage_tasks_used.gt.0') // Atomic guard
          .select('id')

        if (resetError) {
          errorCount++
          logger.error('[Cron] Failed to reset tasks for free user', { userId: user.id, error: resetError.message })
          continue
        }

        // Only insert billing event if the update actually affected a row
        if (updated && updated.length > 0) {
          freeResetCount++
          // Insert period_reset billing event
          await supabase.from('task_billing_events').insert({
            user_id: user.id,
            event_type: 'period_reset',
            amount: 0,
            balance_after: 0,
            tasks_limit_snapshot: user.tasks_limit,
            period_start_snapshot: user.billing_period_start,
            period_end_snapshot: user.billing_period_end,
            source: 'cron_reset',
            metadata: { previous_tasks_used: user.tasks_used }
          }).then(({ error }) => {
            if (error) logger.warn('[Cron] Failed to log reset event (non-blocking)', { userId: user.id, error: error.message })
          })
        }
      } else {
        // Paid users: check subscription status before resetting
        const { data: subscription } = await supabase
          .from('subscriptions')
          .select('status')
          .eq('user_id', user.id)
          .in('status', ['active', 'trialing'])
          .order('current_period_end', { ascending: false, nullsFirst: false })
          .limit(1)
          .single()

        if (subscription) {
          // Active subscription — safe to reset tasks (webhook should have done this)
          const { data: updated, error: resetError } = await supabase
            .from('user_profiles')
            .update({ tasks_used: 0, overage_tasks_used: 0 })
            .eq('id', user.id)
            .or('tasks_used.gt.0,overage_tasks_used.gt.0') // Atomic guard
            .select('id')

          if (resetError) {
            errorCount++
            logger.error('[Cron] Failed to reset tasks for paid user', { userId: user.id, error: resetError.message })
            continue
          }

          if (updated && updated.length > 0) {
            paidResetCount++

            // Insert billing event
            await supabase.from('task_billing_events').insert({
              user_id: user.id,
              event_type: 'period_reset',
              amount: 0,
              balance_after: 0,
              tasks_limit_snapshot: user.tasks_limit,
              period_start_snapshot: user.billing_period_start,
              period_end_snapshot: user.billing_period_end,
              source: 'cron_reset',
              metadata: {
                previous_tasks_used: user.tasks_used,
                subscription_status: subscription.status,
                reset_reason: 'expired_period_active_subscription'
              }
            }).then(({ error }) => {
              if (error) logger.warn('[Cron] Failed to log reset event (non-blocking)', { userId: user.id, error: error.message })
            })

            logger.warn('[Cron] ALERT: Paid user period expired but webhook did not reset. Subscription active. Resetting as safety net.', {
              userId: user.id,
              plan: user.plan,
              periodEnd: user.billing_period_end,
              subscriptionStatus: subscription.status
            })
          }
        } else {
          // Non-active subscription — do NOT reset, emit reconciliation alert
          paidSkippedCount++
          logger.error('[Cron] ALERT: Paid user period expired with non-active subscription status. Requires manual reconciliation.', {
            userId: user.id,
            plan: user.plan,
            periodEnd: user.billing_period_end,
            tasksUsed: user.tasks_used
          })
        }
      }
    }

    logger.info('[Cron] Task reset completed', {
      totalFound: usersToReset.length,
      freeResetCount,
      paidResetCount,
      paidSkippedCount,
      errorCount
    })

    return NextResponse.json({
      processed: freeResetCount + paidResetCount,
      paidSkipped: paidSkippedCount,
      errors: errorCount,
    })
  } catch (error: any) {
    logger.error('[Cron] Task reset cron failed:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
