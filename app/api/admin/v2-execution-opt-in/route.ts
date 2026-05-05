import { jsonResponse, errorResponse } from '@/lib/utils/api-response'
import { requireAdmin } from '@/lib/utils/admin-auth'
import { setV2ExecutionOptIn, listV2OptInUsers } from '@/lib/admin/v2OptInActions'
import { logger } from '@/lib/utils/logger'

/**
 * Admin endpoint for the v2 live-execution opt-in toggle.
 *
 * GET — list users with `opt_in_v2_execution = true`. super_admin only.
 * POST — set a user's opt-in. super_admin + step-up auth required.
 *
 * Body for POST: `{ targetUserId: string, optIn: boolean }`.
 *
 * Plan: learning/docs/v2-canonical-execution-engine-plan.md (Phase 3
 * staged rollout). Removed in Phase 5 stage 5.
 */

export async function GET(_request: Request) {
  const authResult = await requireAdmin({ capabilities: ['super_admin'] })
  if (!authResult.isAdmin) return authResult.response

  const { data, error } = await listV2OptInUsers()
  if (error) {
    logger.error('[v2 opt-in] List failed', { error: (error as any).message })
    return errorResponse('Failed to list opt-in users', 500)
  }

  return jsonResponse({ success: true, users: data ?? [] })
}

export async function POST(request: Request) {
  // Step-up required — flipping engine routing for a user changes which
  // engine bills + executes their workflows. Treat as destructive.
  const authResult = await requireAdmin({ capabilities: ['super_admin'], stepUp: true })
  if (!authResult.isAdmin) return authResult.response

  try {
    const body = await request.json()
    const { targetUserId, optIn } = body

    if (!targetUserId || typeof targetUserId !== 'string') {
      return errorResponse('targetUserId is required', 400)
    }
    if (typeof optIn !== 'boolean') {
      return errorResponse('optIn must be a boolean', 400)
    }

    const result = await setV2ExecutionOptIn(
      authResult.userId,
      { targetUserId, optIn },
      request,
    )

    if (!result.success) {
      const status = result.error === 'User profile not found' ? 404 : 500
      return errorResponse(result.error ?? 'Failed to update opt-in', status)
    }

    return jsonResponse({
      success: true,
      targetUserId,
      optIn: result.optIn,
      previousOptIn: result.previousOptIn,
      idempotent: result.previousOptIn === result.optIn,
    })
  } catch (error: any) {
    logger.error('[v2 opt-in] POST handler error', { error: error?.message })
    return errorResponse(error?.message ?? 'Internal server error', 500)
  }
}
