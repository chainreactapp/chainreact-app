import { NextRequest, NextResponse } from 'next/server'
import { logger } from '@/lib/utils/logger'
import { reportAllPendingOverage } from '@/lib/billing/overage-reporter'

/**
 * Daily cron: drain task_overage_events to Stripe usage records.
 *
 * Mirrors the auth pattern in /api/cron/reset-task-usage. Runs unconditionally
 * — the reporter handles "no events" / "no subscription item" cases internally
 * and is idempotent on retry via Stripe's Idempotency-Key.
 *
 * Schedule: daily at 02:00 UTC (configure in vercel.json crons section).
 */
export async function GET(request: NextRequest) {
  const authHeader = request.headers.get('authorization')
  const cronSecret = process.env.CRON_SECRET
  const providedSecret =
    authHeader?.replace('Bearer ', '') || request.nextUrl.searchParams.get('secret')

  if (!cronSecret || providedSecret !== cronSecret) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  logger.info('[Cron] Starting overage reporting...')

  try {
    const summary = await reportAllPendingOverage()
    logger.info('[Cron] Overage reporting completed', summary)
    return NextResponse.json({
      attempted: summary.attempted,
      succeeded: summary.succeeded,
      failed: summary.failed,
    })
  } catch (error: any) {
    logger.error('[Cron] Overage reporting cron failed', { error: error.message })
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
