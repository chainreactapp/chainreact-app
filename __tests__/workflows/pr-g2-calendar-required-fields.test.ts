/**
 * Contract: PR-G2 — Calendar `Require` rows (Q11).
 *
 * Source files under test:
 *   - google-calendar/createEvent.ts        (sendNotifications + guestsCanInviteOthers + guestsCanSeeOtherGuests)
 *   - google-calendar/updateEvent.ts        (sendNotifications)
 *   - google-calendar/addAttendees.ts       (sendNotifications)
 *   - google-calendar/removeAttendees.ts    (sendNotifications)
 *   - google-calendar/moveEvent.ts          (sendNotifications)
 *   - google-calendar/deleteEvent.ts        (sendNotifications)
 *   - google-calendar/quickAddEvent.ts      (sendNotifications)
 *
 * Handler-contracts: Q11 (no hidden high-risk defaults).
 *
 * Each handler now hard-fails with MISSING_REQUIRED_FIELD when a required
 * high-risk field is absent. Existing workflows are migrated via
 * handlerDefaultsBackfillRegistry — the handler is the runtime defense-in-
 * depth, not the primary surface.
 */

import {
  resetHarness,
  mockCalendarApi,
} from '../helpers/actionTestHarness'

import { createGoogleCalendarEvent } from '@/lib/workflows/actions/google-calendar/createEvent'
import { updateGoogleCalendarEvent } from '@/lib/workflows/actions/google-calendar/updateEvent'
import { addGoogleCalendarAttendees } from '@/lib/workflows/actions/google-calendar/addAttendees'
import { removeGoogleCalendarAttendees } from '@/lib/workflows/actions/google-calendar/removeAttendees'
import { moveGoogleCalendarEvent } from '@/lib/workflows/actions/google-calendar/moveEvent'
import { deleteGoogleCalendarEvent } from '@/lib/workflows/actions/google-calendar/deleteEvent'
import { quickAddGoogleCalendarEvent } from '@/lib/workflows/actions/google-calendar/quickAddEvent'

afterEach(() => {
  resetHarness()
})

const expectMissingRequired = (result: any, path: string) => {
  expect(result).toMatchObject({
    success: false,
    category: 'config',
    error: { code: 'MISSING_REQUIRED_FIELD', path },
  })
}

describe('PR-G2 / Q11 — createEvent requires high-risk fields', () => {
  test('missing sendNotifications → MISSING_REQUIRED_FIELD (no provider call)', async () => {
    const result = await createGoogleCalendarEvent(
      {
        title: 'T',
        startDate: '2026-05-01',
        startTime: '09:00',
        startTimeZone: 'America/Chicago',
        // sendNotifications missing
        guestsCanInviteOthers: false,
        guestsCanSeeOtherGuests: false,
      },
      'user-1',
      {},
    )
    expectMissingRequired(result, 'sendNotifications')
    expect(mockCalendarApi.events.insert).not.toHaveBeenCalled()
  })

  test('missing guestsCanInviteOthers → MISSING_REQUIRED_FIELD', async () => {
    const result = await createGoogleCalendarEvent(
      {
        title: 'T',
        startDate: '2026-05-01',
        startTime: '09:00',
        sendNotifications: 'none',
        // guestsCanInviteOthers missing
        guestsCanSeeOtherGuests: false,
      },
      'user-1',
      {},
    )
    expectMissingRequired(result, 'guestsCanInviteOthers')
    expect(mockCalendarApi.events.insert).not.toHaveBeenCalled()
  })

  test('missing guestsCanSeeOtherGuests → MISSING_REQUIRED_FIELD', async () => {
    const result = await createGoogleCalendarEvent(
      {
        title: 'T',
        startDate: '2026-05-01',
        startTime: '09:00',
        sendNotifications: 'none',
        guestsCanInviteOthers: false,
        // guestsCanSeeOtherGuests missing
      },
      'user-1',
      {},
    )
    expectMissingRequired(result, 'guestsCanSeeOtherGuests')
  })

  test('Q5: explicit false on guest fields is valid (NOT treated as missing)', async () => {
    mockCalendarApi.events.insert.mockResolvedValue({ data: { id: 'e' } })

    const result = await createGoogleCalendarEvent(
      {
        title: 'T',
        startDate: '2026-05-01',
        startTime: '09:00',
        startTimeZone: 'America/Chicago',
        sendNotifications: 'none',
        guestsCanInviteOthers: false,
        guestsCanSeeOtherGuests: false,
      },
      'user-1',
      {},
    )
    expect(result.success).toBe(true)
  })

  test("explicit 'none' for sendNotifications passes (Q5 enum value valid)", async () => {
    mockCalendarApi.events.insert.mockResolvedValue({ data: { id: 'e' } })

    const result = await createGoogleCalendarEvent(
      {
        title: 'T',
        startDate: '2026-05-01',
        startTime: '09:00',
        startTimeZone: 'America/Chicago',
        sendNotifications: 'none',
        guestsCanInviteOthers: false,
        guestsCanSeeOtherGuests: false,
      },
      'user-1',
      {},
    )
    expect(result.success).toBe(true)
  })

  test("first missing field reported — sendNotifications wins over guestsCan*", async () => {
    const result = await createGoogleCalendarEvent(
      {
        title: 'T',
        startDate: '2026-05-01',
        startTime: '09:00',
        // ALL three missing — order in declaration is sendNotifications first.
      },
      'user-1',
      {},
    )
    expectMissingRequired(result, 'sendNotifications')
  })
})

describe('PR-G2 / Q11 — updateEvent requires sendNotifications', () => {
  test('missing sendNotifications → MISSING_REQUIRED_FIELD (no get/update call)', async () => {
    const result = await updateGoogleCalendarEvent(
      { eventId: 'evt-1', title: 'New title' },
      'user-1',
      {},
    )
    expectMissingRequired(result, 'sendNotifications')
    expect(mockCalendarApi.events.get).not.toHaveBeenCalled()
    expect(mockCalendarApi.events.update).not.toHaveBeenCalled()
  })

  test('explicit sendNotifications passes the gate', async () => {
    mockCalendarApi.events.get.mockResolvedValue({
      data: {
        start: { dateTime: '2026-05-01T09:00:00', timeZone: 'America/New_York' },
        end: { dateTime: '2026-05-01T10:00:00', timeZone: 'America/New_York' },
      },
    })
    mockCalendarApi.events.update.mockResolvedValue({
      data: { id: 'evt-1', start: {}, end: {}, htmlLink: 'x' },
    })

    const result = await updateGoogleCalendarEvent(
      { eventId: 'evt-1', title: 'New title', sendNotifications: 'none' },
      'user-1',
      {},
    )
    expect(result.success).toBe(true)
  })
})

describe('PR-G2 / Q11 — addAttendees requires sendNotifications', () => {
  test('missing → MISSING_REQUIRED_FIELD', async () => {
    const result = await addGoogleCalendarAttendees(
      { eventId: 'evt-1', attendees: 'alice@x.com' },
      'user-1',
      {},
    )
    expectMissingRequired(result, 'sendNotifications')
    expect(mockCalendarApi.events.get).not.toHaveBeenCalled()
  })
})

describe('PR-G2 / Q11 — removeAttendees requires sendNotifications', () => {
  test('missing → MISSING_REQUIRED_FIELD', async () => {
    const result = await removeGoogleCalendarAttendees(
      { eventId: 'evt-1', attendeesToRemove: 'alice@x.com' },
      'user-1',
      {},
    )
    expectMissingRequired(result, 'sendNotifications')
    expect(mockCalendarApi.events.get).not.toHaveBeenCalled()
  })
})

describe('PR-G2 / Q11 — moveEvent requires sendNotifications', () => {
  test('missing → MISSING_REQUIRED_FIELD', async () => {
    const result = await moveGoogleCalendarEvent(
      {
        eventId: 'evt-1',
        sourceCalendarId: 'primary',
        destinationCalendarId: 'other-cal',
      },
      'user-1',
      {},
    )
    expectMissingRequired(result, 'sendNotifications')
  })
})

describe('PR-G2 / Q11 — deleteEvent requires sendNotifications', () => {
  test('missing → MISSING_REQUIRED_FIELD (no event.get / event.delete call)', async () => {
    const result = await deleteGoogleCalendarEvent(
      { eventId: 'evt-1' },
      'user-1',
      {},
    )
    expectMissingRequired(result, 'sendNotifications')
    expect(mockCalendarApi.events.get).not.toHaveBeenCalled()
    expect(mockCalendarApi.events.delete).not.toHaveBeenCalled()
  })
})

describe('PR-G2 / Q11 — quickAddEvent requires sendNotifications', () => {
  test('missing → MISSING_REQUIRED_FIELD', async () => {
    const result = await quickAddGoogleCalendarEvent(
      { text: 'Lunch with John tomorrow at noon' },
      'user-1',
      {},
    )
    expectMissingRequired(result, 'sendNotifications')
  })
})
