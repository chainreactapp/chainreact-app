/**
 * Contract: PR-G4 — Slack / Teams / Monday / OneDrive `Require` rows (Q11).
 *
 * Source files under test:
 *   - slack.ts createSlackChannel              (visibility)
 *   - slack/createChannel.ts createSlackChannel (isPrivate — alternate handler)
 *   - slack/inviteUsersToChannel.ts            (sendInviteNotification)
 *   - teams/createGroupChat.ts                 (sendInvitationEmail)
 *   - monday/createBoard.ts                    (boardKind)
 *   - onedrive/createSharingLink.ts            (linkScope)
 *
 * Handler-contracts: Q11 (no hidden high-risk defaults).
 *
 * The slack/createChannel.ts handler is dead-coded out of the registry today
 * (slack.ts:432's positional handler is what dispatches), but the audit
 * still flagged its `isPrivate` default. Test pins the require check on
 * both handlers — defense in depth if registry wiring ever changes.
 */

import { resetHarness } from '../helpers/actionTestHarness'

import { createSlackChannel as createSlackChannelLegacy } from '@/lib/workflows/actions/slack'
import { createSlackChannel as createSlackChannelObject } from '@/lib/workflows/actions/slack/createChannel'
import { inviteUsersToChannel } from '@/lib/workflows/actions/slack/inviteUsersToChannel'
import { createTeamsGroupChat } from '@/lib/workflows/actions/teams/createGroupChat'
import { createMondayBoard } from '@/lib/workflows/actions/monday/createBoard'
import { createOnedriveSharingLink } from '@/lib/workflows/actions/onedrive/createSharingLink'

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

describe('PR-G4 / Q11 — Slack createSlackChannel (positional, slack.ts) requires visibility', () => {
  test('missing visibility → MISSING_REQUIRED_FIELD', async () => {
    const result = await createSlackChannelLegacy(
      { channelName: 'plan-budget' },
      'user-1',
      {},
    )
    expectMissingRequired(result, 'visibility')
  })

  test("explicit visibility='private' passes the gate (Q5 enum value valid)", async () => {
    const result: any = await createSlackChannelLegacy(
      { channelName: 'plan-budget', visibility: 'private' },
      'user-1',
      {},
    )
    // The handler will fail later for unrelated reasons (no Slack
    // integration in test env). We only assert the gate didn't fire.
    if (result?.error?.code === 'MISSING_REQUIRED_FIELD') {
      expect(result.error.path).not.toBe('visibility')
    }
  })
})

describe('PR-G4 / Q11 — Slack createSlackChannel (object-style, slack/createChannel.ts) requires isPrivate', () => {
  test('missing isPrivate → MISSING_REQUIRED_FIELD', async () => {
    const result = await createSlackChannelObject({
      userId: 'user-1',
      config: { channelName: 'plan-budget' },
      input: {},
    })
    expectMissingRequired(result, 'isPrivate')
  })

  test('explicit isPrivate=false passes the gate (Q5: false is valid)', async () => {
    const result: any = await createSlackChannelObject({
      userId: 'user-1',
      config: { channelName: 'plan-budget', isPrivate: false },
      input: {},
    })
    if (result?.error?.code === 'MISSING_REQUIRED_FIELD') {
      expect(result.error.path).not.toBe('isPrivate')
    }
  })
})

describe('PR-G4 / Q11 — Slack inviteUsersToChannel requires sendInviteNotification', () => {
  test('missing sendInviteNotification → MISSING_REQUIRED_FIELD', async () => {
    const result = await inviteUsersToChannel({
      config: { channel: 'C123', users: ['U1'] },
      userId: 'user-1',
      input: {},
    })
    expectMissingRequired(result, 'sendInviteNotification')
  })
})

describe('PR-G4 / Q11 — Teams createTeamsGroupChat requires sendInvitationEmail', () => {
  test('missing sendInvitationEmail (and missing in input) → MISSING_REQUIRED_FIELD', async () => {
    const result = await createTeamsGroupChat(
      { topic: 'Team chat', members: ['alice@example.com'] },
      'user-1',
      {},
    )
    expectMissingRequired(result, 'sendInvitationEmail')
  })

  test('sendInvitationEmail explicitly supplied via input passes the gate', async () => {
    const result: any = await createTeamsGroupChat(
      { topic: 'Team chat', members: ['alice@example.com'] },
      'user-1',
      { sendInvitationEmail: false },
    )
    if (result?.error?.code === 'MISSING_REQUIRED_FIELD') {
      expect(result.error.path).not.toBe('sendInvitationEmail')
    }
  })

  test('sendInvitationEmail explicitly supplied via config passes the gate', async () => {
    const result: any = await createTeamsGroupChat(
      {
        topic: 'Team chat',
        members: ['alice@example.com'],
        sendInvitationEmail: true,
      },
      'user-1',
      {},
    )
    if (result?.error?.code === 'MISSING_REQUIRED_FIELD') {
      expect(result.error.path).not.toBe('sendInvitationEmail')
    }
  })
})

describe('PR-G4 / Q11 — Monday createMondayBoard requires boardKind', () => {
  test('missing boardKind → MISSING_REQUIRED_FIELD', async () => {
    const result = await createMondayBoard(
      { boardName: 'Project Tracker' },
      'user-1',
      {},
    )
    expectMissingRequired(result, 'boardKind')
  })

  test("explicit boardKind='private' passes the gate", async () => {
    const result: any = await createMondayBoard(
      { boardName: 'Project Tracker', boardKind: 'private' },
      'user-1',
      {},
    )
    if (result?.error?.code === 'MISSING_REQUIRED_FIELD') {
      expect(result.error.path).not.toBe('boardKind')
    }
  })
})

describe('PR-G4 / Q11 — OneDrive createOnedriveSharingLink requires linkScope', () => {
  // OneDrive uses a different signature: (config, context). Build a
  // minimal context the handler can consume.
  const makeContext = () => ({
    userId: 'user-1',
    dataFlowManager: {
      resolveVariable: (v: any) => v,
    },
  }) as any

  test('missing linkScope → MISSING_REQUIRED_FIELD', async () => {
    const result = await createOnedriveSharingLink(
      { itemType: 'file', fileId: 'f-1', linkType: 'view' },
      makeContext(),
    )
    expectMissingRequired(result, 'linkScope')
  })

  test("explicit linkScope='organization' passes the gate", async () => {
    const result: any = await createOnedriveSharingLink(
      {
        itemType: 'file',
        fileId: 'f-1',
        linkType: 'view',
        linkScope: 'organization',
      },
      makeContext(),
    )
    if (result?.error?.code === 'MISSING_REQUIRED_FIELD') {
      expect(result.error.path).not.toBe('linkScope')
    }
  })
})
