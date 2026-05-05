import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServiceClient } from '@/utils/supabase/server'
import { getWebhookBaseUrl } from '@/lib/utils/getBaseUrl'
import { logger } from '@/lib/utils/logger'

const BATCH_SIZE = 25

export async function GET(request: NextRequest) {
  const cronSecret = process.env.CRON_SECRET
  const authHeader = request.headers.get('authorization')
  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const supabase = await createSupabaseServiceClient()
  const now = new Date().toISOString()

  const { data: dueTriggers, error: fetchError } = await supabase
    .from('workflows_schedules')
    .select('*')
    .eq('status', 'pending')
    .eq('enabled', true)
    .lte('scheduled_for', now)
    .order('scheduled_for', { ascending: true })
    .limit(BATCH_SIZE)

  if (fetchError) {
    logger.error('Failed to fetch scheduled triggers:', fetchError)
    return NextResponse.json({ error: 'Failed to fetch scheduled triggers' }, { status: 500 })
  }

  if (!dueTriggers || dueTriggers.length === 0) {
    return NextResponse.json({ processed: 0 })
  }

  const triggerIds = dueTriggers.map((row) => row.id)
  const { error: updateError } = await supabase
    .from('workflows_schedules')
    .update({ status: 'processing', updated_at: new Date().toISOString() })
    .in('id', triggerIds)
    .eq('status', 'pending')
    .eq('enabled', true)

  if (updateError) {
    logger.error('Failed to mark scheduled triggers as processing:', updateError)
    return NextResponse.json({ error: 'Failed to lock scheduled triggers' }, { status: 500 })
  }

  const baseUrl = getWebhookBaseUrl()
  const executionUrl = `${baseUrl}/api/workflows/execute`

  let processed = 0

  for (const scheduled of dueTriggers) {
    try {
      const payload = scheduled.payload || {}
      const inputData = {
        source: 'scheduled-trigger',
        scheduledFor: scheduled.scheduled_for,
        triggerType: scheduled.trigger_type,
        eventId: scheduled.event_id,
        ...payload,
      }

      const userId = scheduled.created_by || null
      if (!userId) {
        await supabase
          .from('workflows_schedules')
          .update({
            status: 'failed',
            updated_at: new Date().toISOString(),
            payload: { ...payload, error: 'Missing created_by for scheduled trigger' },
            enabled: false
          })
          .eq('id', scheduled.id)
        continue
      }

      const response = await fetch(executionUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-user-id': userId
        },
        body: JSON.stringify({
          workflowId: scheduled.workflow_id,
          testMode: false,
          // PR-V2-CRON — distinct executionMode so the engine-dispatch
          // log distinguishes scheduled-cron traffic from manual /api/
          // workflows/execute calls. The execute route's v1-fork
          // predicate recognizes 'scheduled' as a live-eligible mode.
          executionMode: 'scheduled',
          skipTriggers: true,
          inputData,
        })
      })

      if (!response.ok) {
        const errorText = await response.text()
        await supabase
          .from('workflows_schedules')
          .update({ status: 'failed', updated_at: new Date().toISOString(), payload: { ...payload, error: errorText } })
          .eq('id', scheduled.id)
        continue
      }

      await supabase
        .from('workflows_schedules')
        .update({
          status: 'completed',
          updated_at: new Date().toISOString(),
          last_run_at: new Date().toISOString(),
          next_run_at: null,
          enabled: false
        })
        .eq('id', scheduled.id)

      processed += 1
    } catch (error: any) {
      await supabase
        .from('workflows_schedules')
        .update({ status: 'failed', updated_at: new Date().toISOString(), payload: { ...(scheduled.payload || {}), error: error?.message }, enabled: false })
        .eq('id', scheduled.id)
    }
  }

  return NextResponse.json({ processed })
}
