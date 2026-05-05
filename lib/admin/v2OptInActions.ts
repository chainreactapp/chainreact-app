import { createSupabaseServiceClient } from '@/utils/supabase/server'
import { logAdminAction } from '@/lib/utils/admin-audit'
import { logger } from '@/lib/utils/logger'

/**
 * Action-scoped admin helpers for the v2 live-execution opt-in toggle.
 *
 * `user_profiles.opt_in_v2_execution` is the per-user gate that — together
 * with `FEATURE_FLAGS.V2_LIVE_EXECUTION` — routes a user's live /
 * sequential / scheduled / webhook workflow runs through v2 instead of
 * v1. Settable only by `super_admin` + step-up auth (see
 * `app/api/admin/v2-execution-opt-in/route.ts`). Removed in Phase 5
 * stage 5 alongside v1 deletion.
 *
 * All service-role DB access is contained here — the route file never
 * creates a service client directly. Every mutation calls
 * `logAdminAction` for audit.
 *
 * Plan: learning/docs/v2-canonical-execution-engine-plan.md (Phase 3).
 */

export interface SetOptInParams {
  /** UUID of the user whose opt-in is being toggled. */
  targetUserId: string
  /** New value. */
  optIn: boolean
}

export interface SetOptInResult {
  success: boolean
  /** Echo of the new value persisted (for response payload). */
  optIn?: boolean
  /** Echo of the prior value (for audit + idempotent UI feedback). */
  previousOptIn?: boolean
  error?: string
}

export async function setV2ExecutionOptIn(
  adminUserId: string,
  params: SetOptInParams,
  request?: Request,
): Promise<SetOptInResult> {
  const supabase = await createSupabaseServiceClient()

  // Read prior value for audit log + idempotent-ish response.
  const { data: priorProfile, error: readError } = await supabase
    .from('user_profiles')
    .select('opt_in_v2_execution')
    .eq('id', params.targetUserId)
    .maybeSingle()

  if (readError) {
    logger.error('[v2OptIn] Failed to read prior opt-in', {
      adminUserId,
      targetUserId: params.targetUserId,
      error: readError.message,
    })
    return { success: false, error: readError.message }
  }

  if (!priorProfile) {
    return { success: false, error: 'User profile not found' }
  }

  const previousOptIn = !!(priorProfile as any).opt_in_v2_execution

  // Idempotent — no-op write if already at the requested value, but still
  // log so admin actions are visible (a no-op admin action is still a
  // signal in the audit log).
  if (previousOptIn === params.optIn) {
    await logAdminAction({
      userId: adminUserId,
      action: 'v2_execution_opt_in_noop',
      resourceType: 'user_profiles',
      resourceId: params.targetUserId,
      oldValues: { opt_in_v2_execution: previousOptIn },
      newValues: { opt_in_v2_execution: params.optIn },
      request,
    })
    return { success: true, optIn: params.optIn, previousOptIn }
  }

  const { error: updateError } = await supabase
    .from('user_profiles')
    .update({ opt_in_v2_execution: params.optIn } as any)
    .eq('id', params.targetUserId)

  if (updateError) {
    logger.error('[v2OptIn] Update failed', {
      adminUserId,
      targetUserId: params.targetUserId,
      error: updateError.message,
    })
    return { success: false, error: updateError.message }
  }

  await logAdminAction({
    userId: adminUserId,
    action: params.optIn ? 'v2_execution_opt_in_enable' : 'v2_execution_opt_in_disable',
    resourceType: 'user_profiles',
    resourceId: params.targetUserId,
    oldValues: { opt_in_v2_execution: previousOptIn },
    newValues: { opt_in_v2_execution: params.optIn },
    request,
  })

  logger.info('[v2OptIn] Updated', {
    adminUserId,
    targetUserId: params.targetUserId,
    previousOptIn,
    newOptIn: params.optIn,
  })

  return { success: true, optIn: params.optIn, previousOptIn }
}

/**
 * List users with v2 opt-in enabled. Used by the admin UI to show who's
 * currently routed to v2. Caller should `requireAdmin({ capabilities:
 * ['super_admin'] })`. No step-up needed for read.
 */
export async function listV2OptInUsers(): Promise<{ data: Array<{ id: string; email: string | null; opt_in_v2_execution: boolean }> | null; error: any }> {
  const supabase = await createSupabaseServiceClient()
  const { data, error } = await supabase
    .from('user_profiles')
    .select('id, email, opt_in_v2_execution')
    .eq('opt_in_v2_execution' as any, true)
    .order('id')
  return { data: data as any, error }
}
