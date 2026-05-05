/**
 * Infra test (PR-F item 8): email delivery capture.
 *
 * The production email sender (`lib/notifications/email.ts`) uses
 * Resend exclusively — there is no SMTP path today, so MailHog can't
 * directly capture production code's outbound mail without changing
 * `sendEmail`. Per PR-F guardrails ("Do not change handler defaults"
 * and "Keep mocks only at external network boundaries not covered by
 * Docker services"), this file pins two complementary contracts:
 *
 *   A. Production `sendEmail` constructs the right Resend payload —
 *      verified by mocking ONLY the Resend HTTP boundary. The
 *      payload-shape contract (from, to, subject, text, html) is
 *      what downstream notification reliability depends on.
 *
 *   B. The mailHarness correctly captures complex SMTP messages
 *      (multi-recipient, custom headers, body content). This proves
 *      the harness is ready when an SMTP-based code path lands —
 *      e.g., a future workflow action that emits SMTP, or a Resend
 *      replacement.
 *
 * The MailHog tests skip cleanly when Docker isn't running. The
 * Resend payload tests have no infra dependency.
 */

import * as net from 'net'
import {
  clearMessages,
  getMessages,
  isMailHogAvailable,
} from '../helpers/mailHarness'

const REQUIRES_DOCKER_NOTE =
  '(skipped: mailhog not reachable — run `npm run test:infra:up`)'

const SMTP_HOST = process.env.TEST_MAILHOG_SMTP_HOST || '127.0.0.1'
const SMTP_PORT = Number(process.env.TEST_MAILHOG_SMTP_PORT || 1025)

let mailAvailable = false
beforeAll(async () => {
  mailAvailable = await isMailHogAvailable()
  if (mailAvailable) await clearMessages()
})

// ─── A. Production sendEmail Resend-payload contract ────────────────

describe('lib/notifications/email — Resend payload construction', () => {
  // Mock Resend at the HTTP boundary so we can inspect the payload
  // sendEmail builds without making a real Resend API call.
  let capturedPayload: any = null
  let resendCallCount = 0

  jest.mock('resend', () => ({
    Resend: jest.fn().mockImplementation(() => ({
      emails: {
        send: jest.fn(async (payload: any) => {
          capturedPayload = payload
          resendCallCount += 1
          return { data: { id: 'mock-resend-msg-id' }, error: null }
        }),
      },
    })),
  }))

  beforeAll(() => {
    process.env.RESEND_API_KEY = 'test-resend-key'
  })

  beforeEach(() => {
    capturedPayload = null
    resendCallCount = 0
  })

  test('sendEmail builds a Resend payload with from / to / subject / text / html', async () => {
    const { sendEmail } = await import('@/lib/notifications/email')

    const ok = await sendEmail(
      'recipient@chainreact.test',
      'Workflow alert',
      'Plain text body',
      '<p>HTML body</p>',
    )

    expect(ok).toBe(true)
    expect(resendCallCount).toBe(1)
    expect(capturedPayload).toBeTruthy()
    expect(capturedPayload.to).toEqual(['recipient@chainreact.test'])
    expect(capturedPayload.subject).toBe('Workflow alert')
    expect(capturedPayload.text).toBe('Plain text body')
    expect(capturedPayload.html).toBe('<p>HTML body</p>')
    expect(capturedPayload.from).toMatch(/chainreact/i)
  })

  test('sendEmail rejects an invalid recipient before calling Resend', async () => {
    const { sendEmail } = await import('@/lib/notifications/email')

    const ok = await sendEmail('not-an-email', 'subj', 'body')
    expect(ok).toBe(false)
    expect(resendCallCount).toBe(0)
  })

  test('sendEmail returns false (does NOT throw) when RESEND_API_KEY is missing', async () => {
    const original = process.env.RESEND_API_KEY
    delete process.env.RESEND_API_KEY
    try {
      // Force a fresh module load so the early check in sendEmail
      // (line 37 of source) re-reads the env.
      jest.resetModules()
      const { sendEmail } = await import('@/lib/notifications/email')
      const ok = await sendEmail('alice@chainreact.test', 'subj', 'body')
      expect(ok).toBe(false)
    } finally {
      process.env.RESEND_API_KEY = original
    }
  })

  test('sendEmail auto-generates HTML from text body when html is omitted', async () => {
    jest.resetModules()
    process.env.RESEND_API_KEY = 'test-resend-key'
    const { sendEmail } = await import('@/lib/notifications/email')

    await sendEmail('alice@chainreact.test', 'Issue', 'plain alert text')
    expect(capturedPayload.html).toBeTruthy()
    // Default template wraps the message in a styled HTML doc.
    expect(capturedPayload.html).toContain('plain alert text')
    expect(capturedPayload.html).toContain('<!DOCTYPE html>')
  })

  // ─── sendWorkflowErrorEmail — humanized failure template ────────────
  //
  // The new humanized email is the user's first contact with a workflow
  // failure for any push channel they've configured. It must:
  //   - Surface the classified title in the subject and the HTML hero
  //   - Render the description, hint, failed-step label, and CTA button
  //   - Include the raw technical details inside a collapsed <details>
  //     so support / power users can copy them
  //   - Drop sections cleanly when classification fields are absent
  //   - Color the alert card by severity ('error' red vs 'warning' amber)
  //   - HTML-escape every classification field to neutralize XSS from
  //     attacker-controlled error messages

  describe('sendWorkflowErrorEmail — humanized failure payload', () => {
    function fullPayload(overrides: any = {}): any {
      return {
        subject: 'Reconnect Gmail: Daily ingest',
        title: 'Reconnect Gmail',
        description: 'Your Gmail connection expired or was revoked.',
        hint: 'Reconnect Gmail, then retry the workflow.',
        cta: {
          label: 'Reconnect Gmail',
          url: 'https://app.test/integrations',
        },
        severity: 'error',
        workflowId: 'wf_1',
        workflowName: 'Daily ingest',
        executionId: 'exec_1',
        technicalDetails: '401 Unauthorized: Invalid Credentials',
        failedStepName: 'Send confirmation email',
        ...overrides,
      }
    }

    test('full payload — all sections rendered in plain text and HTML', async () => {
      jest.resetModules()
      process.env.RESEND_API_KEY = 'test-resend-key'
      const { sendWorkflowErrorEmail } = await import('@/lib/notifications/email')

      const ok = await sendWorkflowErrorEmail('ops@chainreact.test', fullPayload())
      expect(ok).toBe(true)
      expect(capturedPayload).toBeTruthy()

      // Subject = humanized title : workflow name
      expect(capturedPayload.subject).toBe('Reconnect Gmail: Daily ingest')

      // Plain-text body has every section in order
      expect(capturedPayload.text).toContain('Reconnect Gmail — workflow "Daily ingest"')
      expect(capturedPayload.text).toContain('Your Gmail connection expired or was revoked.')
      expect(capturedPayload.text).toContain('Reconnect Gmail, then retry the workflow.')
      expect(capturedPayload.text).toContain(
        'Reconnect Gmail: https://app.test/integrations',
      )
      expect(capturedPayload.text).toContain('Technical details:')
      expect(capturedPayload.text).toContain('401 Unauthorized: Invalid Credentials')

      // HTML carries the same content, plus the structural pieces:
      // accent label, hero h1, description paragraph, failed-step block,
      // hint italic, CTA button (anchor with the CTA url), workflow + exec
      // metadata footer, collapsed Technical details <details>.
      const html = capturedPayload.html as string
      expect(html).toContain('Workflow failed')
      expect(html).toContain('<h1')
      expect(html).toContain('Reconnect Gmail')
      expect(html).toContain('Your Gmail connection expired or was revoked.')
      expect(html).toContain('Failed step:')
      expect(html).toContain('Send confirmation email')
      expect(html).toContain('Reconnect Gmail, then retry the workflow.')
      expect(html).toContain('href="https://app.test/integrations"')
      expect(html).toContain('Daily ingest')
      expect(html).toContain('Execution ID:')
      expect(html).toContain('exec_1')
      expect(html).toContain('<details')
      expect(html).toContain('Technical details')
      expect(html).toContain('401 Unauthorized: Invalid Credentials')
    })

    test("severity 'error' uses red accent palette", async () => {
      jest.resetModules()
      process.env.RESEND_API_KEY = 'test-resend-key'
      const { sendWorkflowErrorEmail } = await import('@/lib/notifications/email')

      await sendWorkflowErrorEmail('ops@chainreact.test', fullPayload({ severity: 'error' }))
      const html = capturedPayload.html as string
      expect(html).toContain('#dc2626') // red accent
      expect(html).toContain('#fef2f2') // red accent bg
      expect(html).not.toContain('#d97706') // no amber
    })

    test("severity 'warning' uses amber accent palette", async () => {
      jest.resetModules()
      process.env.RESEND_API_KEY = 'test-resend-key'
      const { sendWorkflowErrorEmail } = await import('@/lib/notifications/email')

      await sendWorkflowErrorEmail(
        'ops@chainreact.test',
        fullPayload({
          severity: 'warning',
          subject: 'Duplicate run with different inputs: Daily ingest',
          title: 'Duplicate run with different inputs',
          cta: null,
        }),
      )
      const html = capturedPayload.html as string
      expect(html).toContain('#d97706') // amber accent
      expect(html).toContain('#fffbeb') // amber accent bg
      expect(html).not.toContain('#dc2626') // no red
    })

    test('cta=null — no anchor button rendered', async () => {
      jest.resetModules()
      process.env.RESEND_API_KEY = 'test-resend-key'
      const { sendWorkflowErrorEmail } = await import('@/lib/notifications/email')

      await sendWorkflowErrorEmail('ops@chainreact.test', fullPayload({ cta: null }))

      // Plain text drops the "<label>: <url>" line entirely
      expect(capturedPayload.text).not.toMatch(/https?:\/\/app\.test\/integrations/)
      // HTML has no anchor with the integrations URL
      const html = capturedPayload.html as string
      expect(html).not.toContain('href="https://app.test/integrations"')
    })

    test('hint=null — italic hint paragraph is omitted from HTML', async () => {
      jest.resetModules()
      process.env.RESEND_API_KEY = 'test-resend-key'
      const { sendWorkflowErrorEmail } = await import('@/lib/notifications/email')

      await sendWorkflowErrorEmail('ops@chainreact.test', fullPayload({ hint: null }))

      expect(capturedPayload.text).not.toContain('Reconnect Gmail, then retry')
      // The HTML rule for the hint paragraph uses font-style: italic. Ensure
      // the specific copy is gone.
      const html = capturedPayload.html as string
      expect(html).not.toContain('Reconnect Gmail, then retry the workflow.')
    })

    test('technicalDetails=null — collapsed Technical Details block omitted', async () => {
      jest.resetModules()
      process.env.RESEND_API_KEY = 'test-resend-key'
      const { sendWorkflowErrorEmail } = await import('@/lib/notifications/email')

      await sendWorkflowErrorEmail(
        'ops@chainreact.test',
        fullPayload({ technicalDetails: null }),
      )

      expect(capturedPayload.text).not.toContain('Technical details:')
      const html = capturedPayload.html as string
      expect(html).not.toContain('<details')
      expect(html).not.toContain('Technical details</summary>')
    })

    test('failedStepName=null — Failed step block omitted', async () => {
      jest.resetModules()
      process.env.RESEND_API_KEY = 'test-resend-key'
      const { sendWorkflowErrorEmail } = await import('@/lib/notifications/email')

      await sendWorkflowErrorEmail(
        'ops@chainreact.test',
        fullPayload({ failedStepName: null }),
      )
      const html = capturedPayload.html as string
      expect(html).not.toContain('Failed step:')
    })

    test('executionId=null — Execution ID line omitted from HTML metadata', async () => {
      jest.resetModules()
      process.env.RESEND_API_KEY = 'test-resend-key'
      const { sendWorkflowErrorEmail } = await import('@/lib/notifications/email')

      await sendWorkflowErrorEmail(
        'ops@chainreact.test',
        fullPayload({ executionId: null }),
      )
      const html = capturedPayload.html as string
      expect(html).not.toContain('Execution ID:')
    })

    test('escapes HTML in classification fields (XSS guard)', async () => {
      // An attacker-controlled provider error string must not be able to
      // inject script tags / break out of the alert-card div. Every
      // user-supplied field in renderWorkflowErrorEmailHtml goes through
      // escapeHtml.
      jest.resetModules()
      process.env.RESEND_API_KEY = 'test-resend-key'
      const { sendWorkflowErrorEmail } = await import('@/lib/notifications/email')

      const malicious = '<script>alert("xss")</script>'
      const maliciousUrl = 'https://evil.test/?x=<script>alert(1)</script>'

      await sendWorkflowErrorEmail(
        'ops@chainreact.test',
        fullPayload({
          title: malicious,
          description: malicious,
          hint: malicious,
          failedStepName: malicious,
          workflowName: malicious,
          executionId: malicious,
          technicalDetails: malicious,
          cta: { label: malicious, url: maliciousUrl },
        }),
      )

      const html = capturedPayload.html as string
      // The literal <script> tag must never appear in rendered HTML.
      expect(html).not.toContain('<script>alert("xss")</script>')
      expect(html).not.toContain('<script>alert(1)</script>')
      // The escaped form should appear instead (everywhere the field
      // is rendered — title, description, hint, failed-step, workflowName,
      // executionId, technicalDetails, cta label/url).
      expect(html).toContain('&lt;script&gt;')
    })
  })
})

// ─── B. MailHog harness richer-capture contract ─────────────────────

/**
 * Send an SMTP message via raw socket. Used to exercise the harness's
 * capture surface beyond what the PR-E smoke test covered. Production
 * code does NOT emit SMTP today — this verifies the harness is ready
 * for when one lands.
 */
async function sendSmtpMessage(opts: {
  from: string
  to: string[]
  subject: string
  body: string
  customHeaders?: Record<string, string>
}): Promise<void> {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection(SMTP_PORT, SMTP_HOST)
    let step = 0
    const send = (line: string) => {
      socket.write(line + '\r\n')
    }
    const greetingHandled = () => {
      step++
      send('HELO chainreact-test')
    }
    socket.on('data', () => {
      if (step === 0) {
        greetingHandled()
      } else if (step === 1) {
        send(`MAIL FROM:<${opts.from}>`)
        step++
      } else if (step >= 2 && step < 2 + opts.to.length) {
        send(`RCPT TO:<${opts.to[step - 2]}>`)
        step++
      } else if (step === 2 + opts.to.length) {
        send('DATA')
        step++
      } else if (step === 3 + opts.to.length) {
        send(`From: ${opts.from}`)
        send(`To: ${opts.to.join(', ')}`)
        send(`Subject: ${opts.subject}`)
        for (const [k, v] of Object.entries(opts.customHeaders ?? {})) {
          send(`${k}: ${v}`)
        }
        send('')
        send(opts.body)
        send('.')
        step++
      } else if (step === 4 + opts.to.length) {
        send('QUIT')
        step++
      } else {
        socket.end()
      }
    })
    socket.on('end', () => resolve())
    socket.on('error', reject)
  })
}

async function waitForMessages(n: number, timeoutMs = 1500): Promise<any[]> {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    const msgs = await getMessages()
    if (msgs.length >= n) return msgs
    await new Promise((r) => setTimeout(r, 50))
  }
  return getMessages()
}

describe('mailHarness — richer captures', () => {
  test('captures a multi-recipient message with all addresses on the To line', async () => {
    if (!mailAvailable) {
      console.warn(`[email-delivery.infra] ${REQUIRES_DOCKER_NOTE}`)
      return
    }

    await clearMessages()
    await sendSmtpMessage({
      from: 'sender@chainreact.test',
      to: ['alice@chainreact.test', 'bob@chainreact.test'],
      subject: 'Multi recipient',
      body: 'hello team',
    })

    const msgs = await waitForMessages(1)
    expect(msgs).toHaveLength(1)
    const m = msgs[0]
    expect(m.subject).toBe('Multi recipient')
    expect(m.to).toEqual(
      expect.arrayContaining(['alice@chainreact.test', 'bob@chainreact.test']),
    )
    expect(m.body).toContain('hello team')
  })

  test('captures custom headers (e.g. X-Workflow-Id) for downstream assertions', async () => {
    if (!mailAvailable) {
      console.warn(`[email-delivery.infra] ${REQUIRES_DOCKER_NOTE}`)
      return
    }

    await clearMessages()
    await sendSmtpMessage({
      from: 'sender@chainreact.test',
      to: ['inspector@chainreact.test'],
      subject: 'Custom headers',
      body: 'check the headers',
      customHeaders: {
        'X-Workflow-Id': 'wf-abc-123',
        'X-Trace-Id': 'trace-xyz',
      },
    })

    const msgs = await waitForMessages(1)
    expect(msgs).toHaveLength(1)
    const headers = msgs[0].headers
    // MailHog lower-cases header keys via the harness's normalizer.
    expect(headers['x-workflow-id']?.[0]).toBe('wf-abc-123')
    expect(headers['x-trace-id']?.[0]).toBe('trace-xyz')
  })

  test('clearMessages drops every captured message between runs', async () => {
    if (!mailAvailable) {
      console.warn(`[email-delivery.infra] ${REQUIRES_DOCKER_NOTE}`)
      return
    }

    await clearMessages()
    expect(await getMessages()).toHaveLength(0)

    await sendSmtpMessage({
      from: 's@x.test',
      to: ['r@x.test'],
      subject: 'before clear',
      body: 'b',
    })
    await waitForMessages(1)

    await clearMessages()
    expect(await getMessages()).toHaveLength(0)
  })
})
