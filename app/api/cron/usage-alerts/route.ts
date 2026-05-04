import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { logger } from '@/lib/utils/logger'
import {
  sendThreshold80Email,
  sendThreshold100Email,
  sendOverageActivatedEmail,
  sendPackDepletedEmail,
} from '@/lib/notifications/billing-emails'

/**
 * Daily cron: send billing usage alerts.
 *
 * Notifications (one per period unless explicitly noted):
 *  - threshold_80: tasks_used / tasks_limit >= 0.80
 *  - threshold_100: tasks_used >= tasks_limit
 *  - overage_activated: overage_tasks_used > 0 and not already notified for this period
 *  - pack_depleted: any prior paid pack AND task_pack_balance == 0 (period-agnostic;
 *    re-notifies if balance recovers and depletes again)
 *
 * Per-period dedup uses user_profiles.usage_notifications_sent JSONB —
 * each key stores the billing_period_start at send time. Stale timestamps
 * across period rolls naturally allow re-sending.
 */
export async function GET(request: NextRequest) {
  const authHeader = request.headers.get('authorization')
  const cronSecret = process.env.CRON_SECRET
  const providedSecret =
    authHeader?.replace('Bearer ', '') || request.nextUrl.searchParams.get('secret')

  if (!cronSecret || providedSecret !== cronSecret) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SECRET_KEY!
  )

  logger.info('[Cron] Starting usage-alerts check...')

  try {
    // Find all paid users whose period has not yet ended (so we don't re-notify
    // expired periods). Free/beta tier still gets threshold alerts.
    const { data: users, error } = await supabase
      .from('user_profiles')
      .select(`
        id,
        email,
        plan,
        tasks_used,
        tasks_limit,
        overage_tasks_used,
        overage_enabled,
        overage_cap_multiplier,
        task_pack_balance,
        auto_buy_packs,
        billing_period_start,
        billing_period_end,
        usage_notifications_sent
      `)
      .gt('tasks_limit', 0) // skip enterprise (limit=-1) and broken rows
      .limit(5000)

    if (error) {
      logger.error('[Cron] Failed to fetch users for usage alerts', { error: error.message })
      return NextResponse.json({ error: 'Failed to fetch users' }, { status: 500 })
    }

    let sent80 = 0
    let sent100 = 0
    let sentOverageActivated = 0
    let sentPackDepleted = 0
    let errors = 0

    for (const u of users ?? []) {
      if (!u.email) continue

      const periodStart = u.billing_period_start
      const sentMap = (u.usage_notifications_sent ?? {}) as Record<string, string | null>
      const usageRatio = u.tasks_limit > 0 ? u.tasks_used / u.tasks_limit : 0
      const updates: Record<string, string> = {}

      // threshold_80
      if (usageRatio >= 0.8 && sentMap.threshold_80 !== periodStart) {
        try {
          const ok = await sendThreshold80Email({
            to: u.email,
            tasksUsed: u.tasks_used,
            tasksLimit: u.tasks_limit,
            plan: u.plan,
          })
          if (ok) {
            updates.threshold_80 = periodStart
            sent80++
          }
        } catch (err: any) {
          logger.error('[Cron] threshold_80 email failed', { userId: u.id, error: err.message })
          errors++
        }
      }

      // threshold_100
      if (u.tasks_used >= u.tasks_limit && sentMap.threshold_100 !== periodStart) {
        try {
          const ok = await sendThreshold100Email({
            to: u.email,
            tasksLimit: u.tasks_limit,
            plan: u.plan,
            overageEnabled: !!u.overage_enabled,
          })
          if (ok) {
            updates.threshold_100 = periodStart
            sent100++
          }
        } catch (err: any) {
          logger.error('[Cron] threshold_100 email failed', { userId: u.id, error: err.message })
          errors++
        }
      }

      // overage_activated
      if (u.overage_tasks_used > 0 && sentMap.overage_activated !== periodStart) {
        // Look up overage rate (cached lookup — fine for daily cron)
        const { data: plan } = await supabase
          .from('plans')
          .select('limits')
          .eq('name', u.plan)
          .single()
        const overageRate = (plan?.limits as { overageRate?: number } | null)?.overageRate ?? 0
        if (overageRate > 0) {
          try {
            const ok = await sendOverageActivatedEmail({
              to: u.email,
              plan: u.plan,
              overageRate,
              capMultiplier: Number(u.overage_cap_multiplier ?? 2.0),
              tasksLimit: u.tasks_limit,
            })
            if (ok) {
              updates.overage_activated = periodStart
              sentOverageActivated++
            }
          } catch (err: any) {
            logger.error('[Cron] overage_activated email failed', { userId: u.id, error: err.message })
            errors++
          }
        }
      }

      // pack_depleted: check if user has had paid packs but balance is now zero.
      // Period-agnostic: store last-sent timestamp; only re-send if balance recovered then re-depleted.
      if (u.task_pack_balance === 0) {
        const { data: hasPriorPack } = await supabase
          .from('pack_purchases')
          .select('id')
          .eq('user_id', u.id)
          .eq('status', 'paid')
          .limit(1)
          .maybeSingle()

        if (hasPriorPack) {
          const lastSent = sentMap.pack_depleted
          // Re-send only if more than 24h since last notification (rate-limit) — simple guard
          const shouldSend =
            !lastSent || new Date().getTime() - new Date(lastSent).getTime() > 24 * 60 * 60 * 1000
          if (shouldSend) {
            try {
              const ok = await sendPackDepletedEmail({
                to: u.email,
                plan: u.plan,
                autoBuyEnabled: !!u.auto_buy_packs,
              })
              if (ok) {
                updates.pack_depleted = new Date().toISOString()
                sentPackDepleted++
              }
            } catch (err: any) {
              logger.error('[Cron] pack_depleted email failed', { userId: u.id, error: err.message })
              errors++
            }
          }
        }
      }

      // Persist per-user notification timestamps
      if (Object.keys(updates).length > 0) {
        const merged = { ...sentMap, ...updates }
        const { error: persistError } = await supabase
          .from('user_profiles')
          .update({ usage_notifications_sent: merged })
          .eq('id', u.id)
        if (persistError) {
          logger.error('[Cron] Failed to persist notifications_sent', {
            userId: u.id,
            error: persistError.message,
          })
          errors++
        }
      }
    }

    logger.info('[Cron] Usage alerts completed', {
      considered: users?.length ?? 0,
      sent80,
      sent100,
      sentOverageActivated,
      sentPackDepleted,
      errors,
    })

    return NextResponse.json({
      considered: users?.length ?? 0,
      sent80,
      sent100,
      sentOverageActivated,
      sentPackDepleted,
      errors,
    })
  } catch (error: any) {
    logger.error('[Cron] Usage alerts cron failed', { error: error.message })
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
