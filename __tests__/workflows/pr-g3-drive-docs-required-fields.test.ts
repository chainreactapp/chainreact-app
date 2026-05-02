/**
 * Contract: PR-G3 — Drive/Docs sharing `Require` rows (Q11).
 *
 * Source files under test:
 *   - googleDrive/shareFile.ts        (sendNotification — unconditional)
 *   - googleDrive/uploadFile.ts       (shareNotification — required only when shareWith non-empty)
 *   - googleDocs.ts shareGoogleDocument (sendNotification — unconditional)
 *
 * Handler-contracts: Q11 (no hidden high-risk defaults).
 *
 * For uploadFile, the require is conditional. The backfill registry uses
 * the new `applyWhen` predicate (PR-G3 framework extension) so existing
 * upload-file nodes WITHOUT shareWith are left alone, and only nodes
 * actually exercising the share path get backfilled.
 */

import {
  resetHarness,
} from '../helpers/actionTestHarness'

import { shareGoogleDriveFile } from '@/lib/workflows/actions/googleDrive/shareFile'
import { uploadGoogleDriveFile } from '@/lib/workflows/actions/googleDrive/uploadFile'
import { shareGoogleDocument } from '@/lib/workflows/actions/googleDocs'
import {
  applyEntriesToConfig,
  type BackfillEntry,
} from '@/lib/workflows/migrations/handlerDefaultsBackfill'

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

describe('PR-G3 / Q11 — Drive shareFile requires sendNotification', () => {
  test('missing sendNotification → MISSING_REQUIRED_FIELD', async () => {
    const result = await shareGoogleDriveFile(
      { fileId: 'f-1', shareType: 'user', emailAddress: 'alice@x.com', role: 'reader' },
      'user-1',
      {},
    )
    expectMissingRequired(result, 'sendNotification')
  })

  test('explicit false passes the require gate (Q5: false is valid)', async () => {
    // The provider call further down won't succeed in the harness — we
    // only assert the require check itself doesn't fire.
    const result = await shareGoogleDriveFile(
      {
        fileId: 'f-1',
        shareType: 'user',
        emailAddress: 'alice@x.com',
        role: 'reader',
        sendNotification: false,
      },
      'user-1',
      {},
    )
    // Whatever the result is, it's NOT a MISSING_REQUIRED_FIELD on sendNotification.
    if (result && typeof result === 'object' && 'error' in result) {
      const err = (result as any).error
      if (err && typeof err === 'object' && err.code === 'MISSING_REQUIRED_FIELD') {
        expect(err.path).not.toBe('sendNotification')
      }
    }
  })
})

describe('PR-G3 / Q11 — Docs shareGoogleDocument requires sendNotification', () => {
  test('missing sendNotification → MISSING_REQUIRED_FIELD', async () => {
    const result = await shareGoogleDocument(
      { documentId: 'd-1', shareWith: 'alice@x.com', permission: 'reader' },
      'user-1',
      {},
    )
    expectMissingRequired(result, 'sendNotification')
  })
})

describe('PR-G3 / Q11 — Drive uploadFile conditionally requires shareNotification', () => {
  test('shareWith empty → require check NOT enforced', async () => {
    // The handler proceeds past the require gate — it later fails for
    // unrelated reasons (missing source file). We only need to confirm
    // the failure isn't MISSING_REQUIRED_FIELD on shareNotification.
    const result = await uploadGoogleDriveFile(
      {
        sourceType: 'file',
        fileName: 'test.txt',
        shareWith: [], // empty
      },
      'user-1',
      {},
    )
    // Confirm the require gate didn't fire on shareNotification.
    const err = (result as any)?.error
    if (err && typeof err === 'object') {
      expect(err.code === 'MISSING_REQUIRED_FIELD' && err.path === 'shareNotification').toBe(false)
    }
  })

  test('shareWith non-empty + missing shareNotification → MISSING_REQUIRED_FIELD', async () => {
    const result = await uploadGoogleDriveFile(
      {
        sourceType: 'file',
        fileName: 'test.txt',
        shareWith: ['alice@x.com'],
        // shareNotification missing
      },
      'user-1',
      {},
    )
    expectMissingRequired(result, 'shareNotification')
  })

  test('shareWith non-empty + explicit shareNotification:false passes the gate', async () => {
    const result = await uploadGoogleDriveFile(
      {
        sourceType: 'file',
        fileName: 'test.txt',
        shareWith: ['alice@x.com'],
        shareNotification: false,
      },
      'user-1',
      {},
    )
    // Q11 gate doesn't fire — the test asserts only that the require
    // check is not what failed (handler will error for other reasons).
    const err = (result as any)?.error
    if (err && typeof err === 'object') {
      expect(err.code === 'MISSING_REQUIRED_FIELD' && err.path === 'shareNotification').toBe(false)
    }
  })
})

describe('PR-G3 — backfill framework applyWhen predicate', () => {
  // These tests verify the framework extension that PR-G3 introduced:
  // entries can carry `applyWhen` that gates whether the entry runs for
  // a given config row. Used by the upload-file conditional require.
  const entry: BackfillEntry = {
    pr: 'PR-G3',
    nodeType: 'google-drive:create_file',
    fieldName: 'shareNotification',
    legacyDefault: true,
    auditRef: 'uploadFile.ts:449',
    applyWhen: (config) => {
      const sw = config.shareWith
      return Array.isArray(sw) && sw.length > 0
    },
  }

  test('config with non-empty shareWith → backfill applies', () => {
    const result = applyEntriesToConfig({ shareWith: ['a@x.com'] }, [entry])
    expect(result).not.toBeNull()
    expect(result!.newConfig.shareNotification).toBe(true)
    expect(result!.appliedFields).toEqual(['shareNotification'])
  })

  test('config with empty shareWith → backfill skipped', () => {
    const result = applyEntriesToConfig({ shareWith: [] }, [entry])
    expect(result).toBeNull()
  })

  test('config with no shareWith key → backfill skipped', () => {
    const result = applyEntriesToConfig({ otherField: 'x' }, [entry])
    expect(result).toBeNull()
  })

  test('config with shareWith=null → backfill skipped', () => {
    const result = applyEntriesToConfig({ shareWith: null }, [entry])
    expect(result).toBeNull()
  })

  test('idempotent: re-running on a backfilled config → no change', () => {
    const first = applyEntriesToConfig({ shareWith: ['a@x.com'] }, [entry])!
    const second = applyEntriesToConfig(first.newConfig, [entry])
    expect(second).toBeNull()
  })

  test('explicit false on shareNotification preserved (Q5)', () => {
    const result = applyEntriesToConfig(
      { shareWith: ['a@x.com'], shareNotification: false },
      [entry],
    )
    expect(result).toBeNull() // already set, no overwrite
  })
})
