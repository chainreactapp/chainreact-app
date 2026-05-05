/**
 * Contract: PR-V2-FLAG admin endpoint — `setV2ExecutionOptIn` helper.
 *
 * Source: lib/admin/v2OptInActions.ts
 *
 * What this file proves:
 *   - User profile lookup error → returns { success: false, error }.
 *   - User profile not found → 404-equivalent error.
 *   - Idempotent flip (current = requested) → no DB write, but logs
 *     `v2_execution_opt_in_noop` for audit visibility.
 *   - Enable (false → true) → writes, logs `v2_execution_opt_in_enable`.
 *   - Disable (true → false) → writes, logs `v2_execution_opt_in_disable`.
 *   - Update DB error → returns { success: false, error }.
 *   - Audit log payload includes oldValues + newValues with the boolean.
 */

jest.mock('server-only', () => ({}))

jest.mock('@/lib/utils/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}))

const mockLogAdminAction = jest.fn().mockResolvedValue(undefined)
jest.mock('@/lib/utils/admin-audit', () => ({
  logAdminAction: (...args: any[]) => mockLogAdminAction(...args),
}))

// In-memory profile store keyed by id. Each test resets via beforeEach.
let mockProfiles: Record<string, { opt_in_v2_execution: boolean } | null> = {}
let mockReadError: any = null
let mockUpdateError: any = null
const capturedUpdates: Array<{ id: string; opt_in_v2_execution: boolean }> = []

const mockFromImpl = jest.fn().mockImplementation((table: string) => {
  let pendingFilter: Record<string, any> = {}
  let pendingUpdate: any = null
  const builder: any = {
    select: () => builder,
    update: (payload: any) => {
      pendingUpdate = payload
      return builder
    },
    eq: (column: string, value: any) => {
      pendingFilter = { ...pendingFilter, [column]: value }
      // For an update flow: the .eq('id', x) terminates the chain via await
      if (pendingUpdate) {
        const id = pendingFilter.id
        if (mockUpdateError) {
          return Promise.resolve({ error: mockUpdateError })
        }
        capturedUpdates.push({ id, ...(pendingUpdate as object) } as any)
        if (mockProfiles[id]) {
          mockProfiles[id]!.opt_in_v2_execution = pendingUpdate.opt_in_v2_execution
        }
        return Promise.resolve({ error: null })
      }
      return builder
    },
    order: () => builder,
    maybeSingle: async () => {
      if (mockReadError) return { data: null, error: mockReadError }
      if (table !== 'user_profiles') return { data: null, error: null }
      const id = pendingFilter.id
      if (id in mockProfiles) {
        return { data: mockProfiles[id], error: null }
      }
      return { data: null, error: null }
    },
  }
  return builder
})

jest.mock('@/utils/supabase/server', () => ({
  createSupabaseServiceClient: jest.fn().mockResolvedValue({
    from: (table: string) => mockFromImpl(table),
  }),
}))

import { setV2ExecutionOptIn } from '@/lib/admin/v2OptInActions'

beforeEach(() => {
  mockProfiles = {}
  mockReadError = null
  mockUpdateError = null
  capturedUpdates.length = 0
  mockLogAdminAction.mockClear()
})

describe('setV2ExecutionOptIn — failure paths', () => {
  test('user profile not found → success:false, "User profile not found"', async () => {
    const result = await setV2ExecutionOptIn('admin-1', {
      targetUserId: 'unknown-user',
      optIn: true,
    })
    expect(result.success).toBe(false)
    expect(result.error).toBe('User profile not found')
    expect(capturedUpdates).toHaveLength(0)
    expect(mockLogAdminAction).not.toHaveBeenCalled()
  })

  test('read error → success:false, error message passes through', async () => {
    mockReadError = { message: 'connection blip' }
    const result = await setV2ExecutionOptIn('admin-1', {
      targetUserId: 'user-1',
      optIn: true,
    })
    expect(result.success).toBe(false)
    expect(result.error).toBe('connection blip')
    expect(capturedUpdates).toHaveLength(0)
    expect(mockLogAdminAction).not.toHaveBeenCalled()
  })

  test('update error → success:false, error passes through', async () => {
    mockProfiles['user-1'] = { opt_in_v2_execution: false }
    mockUpdateError = { message: 'permission denied' }
    const result = await setV2ExecutionOptIn('admin-1', {
      targetUserId: 'user-1',
      optIn: true,
    })
    expect(result.success).toBe(false)
    expect(result.error).toBe('permission denied')
    // No success audit log; the helper logs only on successful write.
    expect(mockLogAdminAction).not.toHaveBeenCalled()
  })
})

describe('setV2ExecutionOptIn — idempotent no-op', () => {
  test('current = requested (true → true) → no write, logs noop', async () => {
    mockProfiles['user-1'] = { opt_in_v2_execution: true }
    const result = await setV2ExecutionOptIn('admin-1', {
      targetUserId: 'user-1',
      optIn: true,
    })
    expect(result.success).toBe(true)
    expect(result.optIn).toBe(true)
    expect(result.previousOptIn).toBe(true)
    expect(capturedUpdates).toHaveLength(0)
    expect(mockLogAdminAction).toHaveBeenCalledTimes(1)
    expect(mockLogAdminAction.mock.calls[0][0].action).toBe('v2_execution_opt_in_noop')
  })

  test('current = requested (false → false) → no write, logs noop', async () => {
    mockProfiles['user-1'] = { opt_in_v2_execution: false }
    const result = await setV2ExecutionOptIn('admin-1', {
      targetUserId: 'user-1',
      optIn: false,
    })
    expect(result.success).toBe(true)
    expect(capturedUpdates).toHaveLength(0)
    expect(mockLogAdminAction.mock.calls[0][0].action).toBe('v2_execution_opt_in_noop')
  })
})

describe('setV2ExecutionOptIn — enable / disable', () => {
  test('false → true: writes, logs v2_execution_opt_in_enable', async () => {
    mockProfiles['user-1'] = { opt_in_v2_execution: false }
    const result = await setV2ExecutionOptIn('admin-1', {
      targetUserId: 'user-1',
      optIn: true,
    }, { url: 'http://test' } as any)

    expect(result.success).toBe(true)
    expect(result.previousOptIn).toBe(false)
    expect(result.optIn).toBe(true)
    expect(capturedUpdates).toEqual([
      { id: 'user-1', opt_in_v2_execution: true },
    ])

    expect(mockLogAdminAction).toHaveBeenCalledTimes(1)
    const auditCall = mockLogAdminAction.mock.calls[0][0]
    expect(auditCall.action).toBe('v2_execution_opt_in_enable')
    expect(auditCall.userId).toBe('admin-1')
    expect(auditCall.resourceType).toBe('user_profiles')
    expect(auditCall.resourceId).toBe('user-1')
    expect(auditCall.oldValues).toEqual({ opt_in_v2_execution: false })
    expect(auditCall.newValues).toEqual({ opt_in_v2_execution: true })
  })

  test('true → false: writes, logs v2_execution_opt_in_disable', async () => {
    mockProfiles['user-1'] = { opt_in_v2_execution: true }
    const result = await setV2ExecutionOptIn('admin-1', {
      targetUserId: 'user-1',
      optIn: false,
    })

    expect(result.success).toBe(true)
    expect(result.previousOptIn).toBe(true)
    expect(result.optIn).toBe(false)
    expect(capturedUpdates).toEqual([
      { id: 'user-1', opt_in_v2_execution: false },
    ])
    expect(mockLogAdminAction.mock.calls[0][0].action).toBe('v2_execution_opt_in_disable')
  })
})
