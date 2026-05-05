/**
 * Infra test: workflow failure notifications against a real Postgres.
 *
 * The unit suite (`__tests__/notifications/errorHandler.test.ts`) proves
 * the orchestrator's branching logic. That suite mocks the entire
 * Supabase client, so it cannot catch:
 *   - Column type / name mismatches between our SQL and the production schema
 *   - Atomic-claim semantics under real concurrency (two finalizers racing)
 *   - JSON round-trip on `error_classification` (jsonb -> object preserved)
 *   - The `notifications` insert shape being accepted by the table
 *
 * This file pins those four contracts against the local Postgres started
 * by `docker-compose.test.yml`. The schema is bootstrapped inline with
 * exactly the columns production cares about — same pattern as
 * `deductTasksAtomic-idempotency.infra.test.ts` and
 * `ensureUserProfile-race.infra.test.ts`.
 *
 * Skips cleanly when Docker isn't reachable.
 */

import {
  isTestDbAvailable,
  withTestDb,
  connect,
} from "../helpers/dbHarness"

const REQUIRES_DOCKER_NOTE =
  "(skipped: docker postgres not reachable — run `npm run test:infra:up`)"

let dbAvailable = false
beforeAll(async () => {
  dbAvailable = await isTestDbAvailable()
})

/**
 * Minimal slice of `workflow_execution_sessions` and friends. Only the
 * columns the failure-notification pipeline reads/writes — the production
 * table has many more, but they don't affect the contracts under test.
 */
async function bootstrapSchema(client: any): Promise<void> {
  await client.query(`
    CREATE TABLE workflows (
      id uuid PRIMARY KEY,
      user_id uuid,
      name text,
      settings jsonb
    );

    CREATE TABLE workflow_execution_sessions (
      id text PRIMARY KEY,
      workflow_id uuid REFERENCES workflows(id),
      user_id uuid,
      status text,
      error_message text,
      error_classification jsonb,
      error_notifications_sent_at timestamptz,
      started_at timestamptz NOT NULL DEFAULT now()
    );

    CREATE TABLE notifications (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id uuid NOT NULL,
      type text NOT NULL,
      title text NOT NULL,
      message text NOT NULL,
      action_url text,
      action_label text,
      metadata jsonb,
      is_read boolean NOT NULL DEFAULT false,
      created_at timestamptz NOT NULL DEFAULT now()
    );
  `)
}

// ────────────────────────────────────────────────────────────────────
// CONTRACT 1: error_classification jsonb round-trip preserves the
// humanized snapshot exactly.
// ────────────────────────────────────────────────────────────────────

describe("error_classification — schema contract", () => {
  test("jsonb round-trip preserves the full classification shape", async () => {
    if (!dbAvailable) {
      console.warn(`[error-notifications.infra] ${REQUIRES_DOCKER_NOTE}`)
      return
    }

    await withTestDb(async ({ client }) => {
      await bootstrapSchema(client)

      const wf = "11111111-1111-1111-1111-111111111111"
      const usr = "22222222-2222-2222-2222-222222222222"
      await client.query(`INSERT INTO workflows (id, user_id, name) VALUES ($1, $2, 'wf')`, [wf, usr])

      const classification = {
        category: "auth",
        code: "AUTH_RECONNECT_REQUIRED",
        provider: "gmail",
        path: null,
        title: "Reconnect Gmail",
        description: "Your Gmail connection expired or was revoked.",
        hint: "Reconnect Gmail, then retry.",
        action: "reconnect",
        severity: "error",
        nodeId: "node_42",
        nodeName: "Send confirmation",
        firstFailedNodeId: "node_42",
        failedNodeCount: 1,
      }

      await client.query(
        `INSERT INTO workflow_execution_sessions (id, workflow_id, user_id, status, error_classification)
         VALUES ($1, $2, $3, 'failed', $4::jsonb)`,
        ["exec_1", wf, usr, JSON.stringify(classification)],
      )

      const res = await client.query(
        `SELECT error_classification FROM workflow_execution_sessions WHERE id = $1`,
        ["exec_1"],
      )
      expect(res.rows[0].error_classification).toEqual(classification)
    })
  })

  test("error_classification can be null (default state for non-failed runs)", async () => {
    if (!dbAvailable) {
      console.warn(`[error-notifications.infra] ${REQUIRES_DOCKER_NOTE}`)
      return
    }

    await withTestDb(async ({ client }) => {
      await bootstrapSchema(client)
      const wf = "11111111-1111-1111-1111-111111111111"
      const usr = "22222222-2222-2222-2222-222222222222"
      await client.query(`INSERT INTO workflows (id, user_id, name) VALUES ($1, $2, 'wf')`, [wf, usr])
      await client.query(
        `INSERT INTO workflow_execution_sessions (id, workflow_id, user_id, status)
         VALUES ($1, $2, $3, 'completed')`,
        ["exec_2", wf, usr],
      )
      const res = await client.query(
        `SELECT error_classification FROM workflow_execution_sessions WHERE id = $1`,
        ["exec_2"],
      )
      expect(res.rows[0].error_classification).toBeNull()
    })
  })
})

// ────────────────────────────────────────────────────────────────────
// CONTRACT 2: atomic dedup claim. The orchestrator does
//   UPDATE workflow_execution_sessions
//   SET error_notifications_sent_at = NOW()
//   WHERE id = $1 AND error_notifications_sent_at IS NULL
//   RETURNING id
// First call returns the id; second call returns nothing.
// ────────────────────────────────────────────────────────────────────

describe("error_notifications_sent_at — atomic claim", () => {
  test("first claim returns the id; second claim returns no row", async () => {
    if (!dbAvailable) {
      console.warn(`[error-notifications.infra] ${REQUIRES_DOCKER_NOTE}`)
      return
    }

    await withTestDb(async ({ client }) => {
      await bootstrapSchema(client)
      const wf = "11111111-1111-1111-1111-111111111111"
      const usr = "22222222-2222-2222-2222-222222222222"
      await client.query(`INSERT INTO workflows (id, user_id, name) VALUES ($1, $2, 'wf')`, [wf, usr])
      await client.query(
        `INSERT INTO workflow_execution_sessions (id, workflow_id, user_id, status)
         VALUES ('exec_1', $1, $2, 'failed')`,
        [wf, usr],
      )

      const claim = `
        UPDATE workflow_execution_sessions
        SET error_notifications_sent_at = NOW()
        WHERE id = $1 AND error_notifications_sent_at IS NULL
        RETURNING id
      `

      const first = await client.query(claim, ["exec_1"])
      expect(first.rowCount).toBe(1)

      const second = await client.query(claim, ["exec_1"])
      expect(second.rowCount).toBe(0)
    })
  })

  test("concurrent claims: exactly one of N parallel callers wins", async () => {
    // The most important contract — protects against the engine-crash
    // catch + execute-route catch + finalization path all racing on the
    // same execution. PG row-level locking via UPDATE WHERE … IS NULL
    // makes that race safe.
    if (!dbAvailable) {
      console.warn(`[error-notifications.infra] ${REQUIRES_DOCKER_NOTE}`)
      return
    }

    await withTestDb(async ({ client, schema }) => {
      await bootstrapSchema(client)
      const wf = "11111111-1111-1111-1111-111111111111"
      const usr = "22222222-2222-2222-2222-222222222222"
      await client.query(`INSERT INTO workflows (id, user_id, name) VALUES ($1, $2, 'wf')`, [wf, usr])
      await client.query(
        `INSERT INTO workflow_execution_sessions (id, workflow_id, user_id, status)
         VALUES ('exec_race', $1, $2, 'failed')`,
        [wf, usr],
      )

      // Five independent connections so each transaction genuinely races.
      const N = 5
      const connections = await Promise.all(
        Array.from({ length: N }, () => connect()),
      )
      try {
        for (const c of connections) {
          await c.query(`SET search_path TO "${schema}", public`)
        }

        const claim = `
          UPDATE workflow_execution_sessions
          SET error_notifications_sent_at = NOW()
          WHERE id = $1 AND error_notifications_sent_at IS NULL
          RETURNING id
        `

        const results = await Promise.all(
          connections.map((c) => c.query(claim, ["exec_race"])),
        )

        const winners = results.filter((r) => r.rowCount === 1)
        const losers = results.filter((r) => r.rowCount === 0)
        expect(winners).toHaveLength(1)
        expect(losers).toHaveLength(N - 1)

        // The winner stamped the column; verify exactly once.
        const verify = await client.query(
          `SELECT error_notifications_sent_at FROM workflow_execution_sessions WHERE id = $1`,
          ["exec_race"],
        )
        expect(verify.rows[0].error_notifications_sent_at).toBeTruthy()
      } finally {
        await Promise.all(connections.map((c) => c.end()))
      }
    })
  })
})

// ────────────────────────────────────────────────────────────────────
// CONTRACT 3: notifications row insert shape matches what the
// orchestrator writes.
// ────────────────────────────────────────────────────────────────────

describe("notifications — in-app insert shape", () => {
  test("insert with the orchestrator's payload accepted by the table", async () => {
    if (!dbAvailable) {
      console.warn(`[error-notifications.infra] ${REQUIRES_DOCKER_NOTE}`)
      return
    }

    await withTestDb(async ({ client }) => {
      await bootstrapSchema(client)
      const usr = "22222222-2222-2222-2222-222222222222"

      const row = {
        user_id: usr,
        type: "workflow_failed",
        title: "Reconnect Gmail",
        message: "Your Gmail connection expired or was revoked.",
        action_url:
          "https://app.test/workflows/builder/wf_1?historyExecution=exec_1",
        action_label: "Reconnect Gmail",
        metadata: {
          workflow_id: "wf_1",
          execution_id: "exec_1",
          category: "error",
          failed_step_name: "Send confirmation",
        },
        is_read: false,
      }

      const ins = await client.query(
        `INSERT INTO notifications
           (user_id, type, title, message, action_url, action_label, metadata, is_read)
         VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8)
         RETURNING id, metadata, is_read, action_url, type`,
        [
          row.user_id,
          row.type,
          row.title,
          row.message,
          row.action_url,
          row.action_label,
          JSON.stringify(row.metadata),
          row.is_read,
        ],
      )
      expect(ins.rowCount).toBe(1)
      expect(ins.rows[0].type).toBe("workflow_failed")
      expect(ins.rows[0].is_read).toBe(false)
      expect(ins.rows[0].metadata).toEqual(row.metadata)
      expect(ins.rows[0].action_url).toContain("historyExecution=exec_1")
    })
  })
})

// ────────────────────────────────────────────────────────────────────
// CONTRACT 4: end-to-end orchestrator against the real DB.
//
// Wraps the pg client in a thin Supabase-shaped facade so we can run
// the production `notifyWorkflowFailure` code without changing it. Only
// the external network boundaries (email/Slack/Discord/SMS) are mocked.
//
// What this proves end-to-end:
//   - notifyWorkflowFailure looks up the workflow row via the wrapper
//   - sendWorkflowErrorNotifications claims the dedup slot
//   - First call: in-app row inserted, channels fired
//   - Second call: in-app NOT inserted again, channels NOT fired again
//   - Database state after two calls: exactly one notifications row,
//     error_notifications_sent_at stamped exactly once
// ────────────────────────────────────────────────────────────────────

const sentEmails: any[] = []
const sentSlack: any[] = []
const sentDiscord: any[] = []
const sentSMS: any[] = []

jest.mock("@/lib/notifications/email", () => ({
  sendWorkflowErrorEmail: jest.fn(async (to: string, payload: any) => {
    sentEmails.push({ to, payload })
    return true
  }),
}))
jest.mock("@/lib/notifications/slack", () => ({
  sendWorkflowErrorSlack: jest.fn(async (channel: string, payload: any, userId: string) => {
    sentSlack.push({ channel, payload, userId })
    return true
  }),
}))
jest.mock("@/lib/notifications/discord", () => ({
  sendWorkflowErrorDiscord: jest.fn(async (channel: string, payload: any, userId: string) => {
    sentDiscord.push({ channel, payload, userId })
    return true
  }),
}))
jest.mock("@/lib/notifications/sms", () => ({
  sendSMS: jest.fn(async (phone: string, body: string) => {
    sentSMS.push({ phone, body })
    return true
  }),
  formatPhoneNumber: jest.fn((p: string) => p),
}))

// The orchestrator imports the service client lazily via dynamic await.
// We jest.mock it to return whatever the test installed via setActiveSupabase.
let activeSupabase: any = null
jest.mock("@/utils/supabase/server", () => ({
  createSupabaseServiceClient: jest.fn(async () => activeSupabase),
  createSupabaseRouteHandlerClient: jest.fn(async () => activeSupabase),
}))

/**
 * Thin Supabase-shaped facade over a `pg.Client`. Supports just the
 * query patterns the failure-notification pipeline actually uses:
 *   - .from(t).select(cols).eq(col, val).single()
 *   - .from(t).select(cols).eq(col, val).maybeSingle()
 *   - .from(t).update(values).eq(col, val).is(col, null).select(cols).maybeSingle()
 *   - .from(t).insert(row)
 *
 * Returns Supabase-shaped { data, error } payloads.
 */
function makeSupabaseFacade(pgClient: any) {
  function table(t: string) {
    type WhereClause = { col: string; op: "eq" | "is"; val: any }
    const wheres: WhereClause[] = []

    const buildWhere = (
      values: any[]
    ): { sql: string; values: any[] } => {
      if (wheres.length === 0) return { sql: "", values }
      const parts: string[] = []
      const next: any[] = [...values]
      for (const w of wheres) {
        if (w.op === "is" && w.val === null) {
          parts.push(`"${w.col}" IS NULL`)
        } else {
          next.push(w.val)
          parts.push(`"${w.col}" = $${next.length}`)
        }
      }
      return { sql: ` WHERE ${parts.join(" AND ")}`, values: next }
    }

    const selectChain = (cols: string) => {
      const obj: any = {
        eq(col: string, val: any) {
          wheres.push({ col, op: "eq", val })
          return obj
        },
        async single() {
          const where = buildWhere([])
          const sql = `SELECT ${cols === "*" ? "*" : cols} FROM "${t}"${where.sql} LIMIT 1`
          try {
            const res = await pgClient.query(sql, where.values)
            if (res.rowCount === 0) return { data: null, error: { message: "Not found" } }
            return { data: res.rows[0], error: null }
          } catch (err: any) {
            return { data: null, error: { message: err?.message } }
          }
        },
        async maybeSingle() {
          const where = buildWhere([])
          const sql = `SELECT ${cols === "*" ? "*" : cols} FROM "${t}"${where.sql} LIMIT 1`
          try {
            const res = await pgClient.query(sql, where.values)
            return { data: res.rows[0] || null, error: null }
          } catch (err: any) {
            return { data: null, error: { message: err?.message } }
          }
        },
      }
      return obj
    }

    const updateChain = (values: Record<string, any>) => {
      const obj: any = {
        eq(col: string, val: any) {
          wheres.push({ col, op: "eq", val })
          return obj
        },
        is(col: string, val: any) {
          wheres.push({ col, op: "is", val })
          return obj
        },
        select(cols: string = "*") {
          // After .update(...).eq(...).is(...).select(cols).maybeSingle()
          return {
            async maybeSingle() {
              const setEntries = Object.entries(values)
              const setParts = setEntries.map(([k], i) => `"${k}" = $${i + 1}`)
              const setVals = setEntries.map(([, v]) => v)
              const where = buildWhere(setVals)
              const sql = `UPDATE "${t}" SET ${setParts.join(", ")}${where.sql} RETURNING ${cols}`
              try {
                const res = await pgClient.query(sql, where.values)
                return { data: res.rows[0] || null, error: null }
              } catch (err: any) {
                return { data: null, error: { message: err?.message } }
              }
            },
          }
        },
      }
      return obj
    }

    const insertOne = async (row: Record<string, any>) => {
      const cols = Object.keys(row)
      const placeholders = cols.map((_, i) => `$${i + 1}`)
      const vals = cols.map((k) => {
        const v = row[k]
        // jsonb columns need stringification
        if (k === "metadata" && v && typeof v === "object") return JSON.stringify(v)
        return v
      })
      const sql = `INSERT INTO "${t}" (${cols.map((c) => `"${c}"`).join(", ")}) VALUES (${placeholders.join(", ")})`
      try {
        await pgClient.query(sql, vals)
        return { data: null, error: null }
      } catch (err: any) {
        return { data: null, error: { message: err?.message } }
      }
    }

    return {
      select: selectChain,
      update: updateChain,
      async insert(row: any) {
        return await insertOne(row)
      },
    }
  }

  return { from: table }
}

describe("notifyWorkflowFailure — end-to-end against real Postgres", () => {
  beforeEach(() => {
    sentEmails.length = 0
    sentSlack.length = 0
    sentDiscord.length = 0
    sentSMS.length = 0
  })

  test("first call fans out + claims slot; second call short-circuits everything", async () => {
    if (!dbAvailable) {
      console.warn(`[error-notifications.infra] ${REQUIRES_DOCKER_NOTE}`)
      return
    }

    await withTestDb(async ({ client }) => {
      await bootstrapSchema(client)

      const wf = "11111111-1111-1111-1111-111111111111"
      const usr = "22222222-2222-2222-2222-222222222222"

      // Workflow row with channels enabled.
      const settings = {
        error_notifications_enabled: true,
        error_notification_email: true,
        error_notification_slack: true,
        error_notification_discord: true,
        error_notification_sms: true,
        error_notification_in_app: true,
        error_notification_channels: {
          email: "ops@example.com",
          slack_channel: "C123",
          discord_channel: "D456",
          sms_phone: "+15551234567",
        },
      }
      await client.query(
        `INSERT INTO workflows (id, user_id, name, settings) VALUES ($1, $2, 'Daily ingest', $3::jsonb)`,
        [wf, usr, JSON.stringify(settings)],
      )

      // Failed execution with a humanized classification persisted.
      const classification = {
        category: "auth",
        code: "AUTH_RECONNECT_REQUIRED",
        provider: "gmail",
        path: null,
        title: "Reconnect Gmail",
        description: "Your Gmail connection expired or was revoked.",
        hint: "Reconnect Gmail, then retry.",
        action: "reconnect",
        severity: "error",
        nodeId: "node_42",
        nodeName: "Send confirmation",
        firstFailedNodeId: "node_42",
        failedNodeCount: 1,
      }
      await client.query(
        `INSERT INTO workflow_execution_sessions
         (id, workflow_id, user_id, status, error_message, error_classification)
         VALUES ($1, $2, $3, 'failed', $4, $5::jsonb)`,
        ["exec_1", wf, usr, "401 Unauthorized", JSON.stringify(classification)],
      )

      activeSupabase = makeSupabaseFacade(client)

      // Re-import inside the test so the jest.mock'd module factory has
      // already run with the active supabase reference set up.
      const { notifyWorkflowFailure } = await import("@/lib/notifications/errorHandler")

      // First call — full fan-out
      const first = await notifyWorkflowFailure(activeSupabase, wf, {
        message: "401 Unauthorized",
        executionId: "exec_1",
      })
      expect(first.email).toBe(true)
      expect(first.slack).toBe(true)
      expect(first.discord).toBe(true)
      expect(first.sms).toBe(true)
      expect(first.in_app).toBe(true)

      // Each external channel got the humanized payload
      expect(sentEmails).toHaveLength(1)
      expect(sentEmails[0].payload.title).toBe("Reconnect Gmail")
      expect(sentSlack).toHaveLength(1)
      expect(sentSlack[0].payload.title).toBe("Reconnect Gmail")
      expect(sentDiscord).toHaveLength(1)
      expect(sentSMS).toHaveLength(1)
      expect(sentSMS[0].body).toContain("Reconnect Gmail")
      expect(sentSMS[0].body).not.toMatch(/https?:\/\//) // SMS terseness contract

      // DB state: in-app row inserted with deep link, claim stamped
      const inApp = await client.query(
        `SELECT user_id, type, title, action_url, action_label, metadata FROM notifications WHERE user_id = $1`,
        [usr],
      )
      expect(inApp.rowCount).toBe(1)
      expect(inApp.rows[0].type).toBe("workflow_failed")
      expect(inApp.rows[0].title).toBe("Reconnect Gmail")
      expect(inApp.rows[0].action_url).toContain("/integrations")
      expect(inApp.rows[0].action_label).toBe("Reconnect Gmail")

      const stamped = await client.query(
        `SELECT error_notifications_sent_at FROM workflow_execution_sessions WHERE id = 'exec_1'`,
      )
      expect(stamped.rows[0].error_notifications_sent_at).toBeTruthy()

      // Second call — should short-circuit on the dedup claim
      const second = await notifyWorkflowFailure(activeSupabase, wf, {
        message: "401 Unauthorized",
        executionId: "exec_1",
      })
      expect(second.email).toBe(false)
      expect(second.slack).toBe(false)
      expect(second.discord).toBe(false)
      expect(second.sms).toBe(false)
      expect(second.in_app).toBe(false)

      // Channels not re-fired
      expect(sentEmails).toHaveLength(1)
      expect(sentSlack).toHaveLength(1)
      expect(sentDiscord).toHaveLength(1)
      expect(sentSMS).toHaveLength(1)

      // Still exactly one in-app row
      const inAppAfter = await client.query(
        `SELECT count(*)::int AS n FROM notifications WHERE user_id = $1`,
        [usr],
      )
      expect(inAppAfter.rows[0].n).toBe(1)
    })
  })

  test("normal-with-errors finalization path: notify when status='failed' but no engine crash", async () => {
    // Reproduces the gap that this PR closed. workflowExecutionService now
    // calls notifyWorkflowFailure on the normal-with-errors path, so a
    // workflow that finished gracefully with failed nodes still notifies.
    if (!dbAvailable) {
      console.warn(`[error-notifications.infra] ${REQUIRES_DOCKER_NOTE}`)
      return
    }

    await withTestDb(async ({ client }) => {
      await bootstrapSchema(client)
      const wf = "11111111-1111-1111-1111-111111111111"
      const usr = "22222222-2222-2222-2222-222222222222"

      const settings = {
        error_notifications_enabled: true,
        error_notification_in_app: true,
        error_notification_email: false,
      }
      await client.query(
        `INSERT INTO workflows (id, user_id, name, settings) VALUES ($1, $2, 'wf', $3::jsonb)`,
        [wf, usr, JSON.stringify(settings)],
      )

      // Status='failed' but no engine crash (no thrown error). The
      // classification is the aggregate "Workflow completed with N error(s)"
      // shape — internal category, no specific CTA.
      const classification = {
        category: "internal",
        code: null,
        provider: null,
        path: null,
        title: "Unexpected error",
        description: "Workflow completed with 1 error(s)",
        hint: "Retrying may succeed.",
        action: null,
        severity: "error",
        nodeId: "node_a",
        nodeName: "Some step",
        firstFailedNodeId: "node_a",
        failedNodeCount: 1,
      }
      await client.query(
        `INSERT INTO workflow_execution_sessions
         (id, workflow_id, user_id, status, error_message, error_classification)
         VALUES ('exec_norm', $1, $2, 'failed', 'Workflow completed with 1 error(s)', $3::jsonb)`,
        [wf, usr, JSON.stringify(classification)],
      )

      activeSupabase = makeSupabaseFacade(client)
      const { notifyWorkflowFailure } = await import("@/lib/notifications/errorHandler")

      const result = await notifyWorkflowFailure(activeSupabase, wf, {
        message: "Workflow completed with 1 error(s)",
        executionId: "exec_norm",
      })
      expect(result.in_app).toBe(true)

      // The action=null branch falls back to a History deep link.
      const inApp = await client.query(
        `SELECT action_url, action_label FROM notifications WHERE user_id = $1`,
        [usr],
      )
      expect(inApp.rows[0].action_url).toContain("historyExecution=exec_norm")
      expect(inApp.rows[0].action_label).toBe("View execution")
    })
  })
})
