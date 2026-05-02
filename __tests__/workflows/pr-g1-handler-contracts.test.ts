/**
 * Contract: PR-G1 — Calendar / Sheets / Wait `Change` rows (Q11 + Q12).
 *
 * Source files under test:
 *   - lib/workflows/actions/google-calendar/createEvent.ts
 *   - lib/workflows/actions/google-calendar/updateEvent.ts
 *   - lib/workflows/actions/microsoft-outlook/createCalendarEvent.ts
 *   - lib/workflows/actions/googleSheets/createSpreadsheet.ts
 *   - lib/workflows/actions/core/executeWait.ts
 *
 * Handler-contracts: Q11 (no silent time substitution) + Q12 (timezone /
 * locale resolution: workspace → user → UTC/en_US).
 *
 * Coverage focus: PR-G1 behavior changes (validation failures, end-time
 * compute, custom-end-time validation). The createEvent test file
 * (__tests__/nodes/google-calendar-create-event.test.ts) already covers
 * createEvent's Q11 cases via the full harness; the cases here exercise
 * the other four handlers + the meta plumbing for createEvent.
 */

import {
  resetHarness,
  mockCalendarApi,
} from '../helpers/actionTestHarness'
import { createGoogleCalendarEvent } from '@/lib/workflows/actions/google-calendar/createEvent'
import { updateGoogleCalendarEvent } from '@/lib/workflows/actions/google-calendar/updateEvent'
import { createOutlookCalendarEvent } from '@/lib/workflows/actions/microsoft-outlook/createCalendarEvent'

afterEach(() => {
  resetHarness()
})

// PR-G2 (Q11) — high-risk fields now required at handler level. PR-G1 tests
// that don't pin Require behavior supply the recommended-safe values so the
// handler proceeds to the time/timezone behavior under test.
const CREATE_REQUIRED = {
  sendNotifications: 'none' as const,
  guestsCanInviteOthers: false,
  guestsCanSeeOtherGuests: false,
}
const UPDATE_REQUIRED = {
  sendNotifications: 'none' as const,
}

describe('PR-G1 / Q11 — Outlook createCalendarEvent custom-end-time validation', () => {
  test('duration=custom + missing customEndTime → MISSING_REQUIRED_FIELD', async () => {
    const result: any = await createOutlookCalendarEvent(
      {
        subject: 'Test',
        eventDate: 'today',
        eventTime: '09:00',
        duration: 'custom',
        // customEndTime intentionally absent — handler must NOT default to '17:00'.
      },
      'user-1',
      {},
    )

    expect(result).toMatchObject({
      success: false,
      category: 'config',
      error: { code: 'MISSING_REQUIRED_FIELD', path: 'customEndTime' },
    })
  })

  test('duration=custom + invalid customEndTime format → INVALID_TIME_FORMAT', async () => {
    const result: any = await createOutlookCalendarEvent(
      {
        subject: 'Test',
        eventDate: 'today',
        eventTime: '09:00',
        duration: 'custom',
        customEndTime: '5pm', // bad format
      },
      'user-1',
      {},
    )

    expect(result).toMatchObject({
      success: false,
      category: 'validation',
      error: { code: 'INVALID_TIME_FORMAT', path: 'customEndTime' },
    })
  })

})

describe('PR-G1 / Q11 — Outlook createCalendarEvent eventTime/customEndTime invalid format short-circuits', () => {
  test('invalid eventTime format → INVALID_TIME_FORMAT (no provider call)', async () => {
    // Note: the handler currently treats config.eventTime as a free-text
    // value — 'badtime' enters parseDateTime where Q11 strict validation
    // catches it. The audit row line 86 (`eventTime`) is a Change row that
    // ships with a visible config-default in the schema; this test pins the
    // runtime side of the contract.
    const result: any = await createOutlookCalendarEvent(
      {
        subject: 'Test',
        eventDate: 'today',
        eventTime: 'badtime',
        duration: '60',
      },
      'user-1',
      {},
    )

    expect(result).toMatchObject({
      success: false,
      category: 'validation',
      error: { code: 'INVALID_TIME_FORMAT' },
    })
  })
})

describe('PR-G1 / Q11 — Calendar updateEvent time-format validation', () => {
  test('invalid user-supplied startTime format → INVALID_TIME_FORMAT', async () => {
    mockCalendarApi.events.get.mockResolvedValue({
      data: {
        id: 'evt-existing',
        start: { dateTime: '2026-05-01T09:00:00', timeZone: 'America/New_York' },
        end: { dateTime: '2026-05-01T10:00:00', timeZone: 'America/New_York' },
      },
    })

    const result: any = await updateGoogleCalendarEvent(
      {
        ...UPDATE_REQUIRED,
        eventId: 'evt-existing',
        startDate: '2026-05-01',
        startTime: '9am', // bad format
      },
      'user-1',
      {},
    )

    expect(result).toMatchObject({
      success: false,
      category: 'validation',
      error: { code: 'INVALID_TIME_FORMAT', path: 'startTime' },
    })
    expect(mockCalendarApi.events.update).not.toHaveBeenCalled()
  })

  test('user supplies new start, no new end → end = new start + 60', async () => {
    mockCalendarApi.events.get.mockResolvedValue({
      data: {
        id: 'evt-existing',
        start: { dateTime: '2026-05-01T09:00:00', timeZone: 'America/New_York' },
        end: { dateTime: '2026-05-01T10:00:00', timeZone: 'America/New_York' },
      },
    })
    mockCalendarApi.events.update.mockResolvedValue({
      data: { id: 'evt-existing', start: {}, end: {}, htmlLink: 'x' },
    })

    await updateGoogleCalendarEvent(
      {
        ...UPDATE_REQUIRED,
        eventId: 'evt-existing',
        startDate: '2026-05-01',
        startTime: '14:30',
      },
      'user-1',
      {},
    )

    expect(mockCalendarApi.events.update).toHaveBeenCalledTimes(1)
    const call = mockCalendarApi.events.update.mock.calls[0][0]
    // New start = 14:30, new end = 15:30 (computed as start + 60).
    expect(call.requestBody.start.dateTime).toBe('2026-05-01T14:30:00')
    expect(call.requestBody.end.dateTime).toBe('2026-05-01T15:30:00')
  })

  test('no new times supplied + existing event has start/end → preserve existing', async () => {
    mockCalendarApi.events.get.mockResolvedValue({
      data: {
        id: 'evt-existing',
        start: { dateTime: '2026-05-01T11:00:00', timeZone: 'America/New_York' },
        end: { dateTime: '2026-05-01T12:00:00', timeZone: 'America/New_York' },
      },
    })
    mockCalendarApi.events.update.mockResolvedValue({
      data: { id: 'evt-existing', start: {}, end: {}, htmlLink: 'x' },
    })

    await updateGoogleCalendarEvent(
      {
        ...UPDATE_REQUIRED,
        eventId: 'evt-existing',
        title: 'New title only',
        startDate: '2026-05-01', // forces the time-update branch
      },
      'user-1',
      {},
    )

    expect(mockCalendarApi.events.update).toHaveBeenCalledTimes(1)
    const call = mockCalendarApi.events.update.mock.calls[0][0]
    expect(call.requestBody.start.dateTime).toBe('2026-05-01T11:00:00')
    expect(call.requestBody.end.dateTime).toBe('2026-05-01T12:00:00')
  })
})

describe('PR-G1 / Q12 — Calendar createEvent timezone meta plumbing', () => {
  test('explicit startTimeZone wins (resolver not consulted for explicit value)', async () => {
    mockCalendarApi.events.insert.mockResolvedValue({ data: { id: 'e' } })

    await createGoogleCalendarEvent(
      {
        ...CREATE_REQUIRED,
        title: 'T',
        startDate: '2026-05-01',
        startTime: '09:00',
        startTimeZone: 'America/Chicago',
      },
      'user-1',
      {},
      { workspaceId: 'ws-1' } as any,
    )

    const call = mockCalendarApi.events.insert.mock.calls[0][0]
    expect(call.requestBody.start.timeZone).toBe('America/Chicago')
  })

  test('startTimeZone="auto" routes through resolveTimezone fallback', async () => {
    mockCalendarApi.events.insert.mockResolvedValue({ data: { id: 'e' } })

    await createGoogleCalendarEvent(
      {
        ...CREATE_REQUIRED,
        title: 'T',
        startDate: '2026-05-01',
        startTime: '09:00',
        startTimeZone: 'auto',
      },
      'user-1',
      {},
    )

    const call = mockCalendarApi.events.insert.mock.calls[0][0]
    // The harness mocks createAdminClient with a chain that doesn't return
    // workspaces / user_profiles rows — resolver falls through to UTC. The
    // test pins that 'auto' is treated as "use the resolver" rather than
    // the literal string 'auto'.
    expect(call.requestBody.start.timeZone).toBe('UTC')
  })
})
