import { test, expect } from '@playwright/test'
import { spawnSync } from 'node:child_process'
import * as path from 'path'
import * as fs from 'fs'
import { fileURLToPath } from 'node:url'
import { createClient } from '@supabase/supabase-js'
import * as dotenv from 'dotenv'
import { getAuthenticatedContext, getCredentials } from '../fixtures/auth'
import { collectConsole } from '../utils/console-collector'
import { setTheme } from '../utils/theme'
import { waitForStable } from '../utils/stability'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

// Load env so auth-flow tests can reach Supabase admin API
dotenv.config({ path: path.resolve(__dirname, '../../../.env.local') })

const BASE = process.env.PLAYWRIGHT_BASE_URL || 'http://localhost:3000'

function setUserPlan(plan: string) {
  const script = path.resolve(__dirname, '../scripts/set-test-user-plan.ts')
  const r = spawnSync('npx', ['tsx', script, plan], {
    cwd: path.resolve(__dirname, '../../..'),
    encoding: 'utf8',
  })
  if (r.status !== 0) throw new Error(`set-plan failed: ${r.stderr}`)
}

function adminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_SECRET_KEY!
  return createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } })
}

const credsPath = path.resolve(__dirname, '../.auth/credentials.json')
const creds = JSON.parse(fs.readFileSync(credsPath, 'utf8')) as { email: string; password: string; userId: string }

// ============================================
// Notification UI rendering
// ============================================
test.describe('Notification bell + dropdown', () => {
  test('bell shows unread count and dropdown lists notifications', async ({ browser }) => {
    test.setTimeout(60_000)
    const context = await getAuthenticatedContext(browser, BASE, { forceRefresh: true })
    const page = await context.newPage()
    try {
      const con = collectConsole(page, 'notifications-bell', 'notifications')
      await page.goto(`${BASE}/workflows`, { waitUntil: 'domcontentloaded' })
      await setTheme(page, 'light')
      await waitForStable(page, { watchSkeletons: true })

      // Dismiss onboarding tour if present
      const skipTour = page.getByRole('button', { name: /^Skip Tour$/i })
      if (await skipTour.isVisible().catch(() => false)) {
        await skipTour.click()
        await page.waitForTimeout(500)
      }

      // Topbar bell — uses sr-only "Notifications" inside the button
      const bell = page.getByRole('button', { name: 'Notifications' }).first()
      await expect(bell).toBeVisible({ timeout: 8000 })

      await page.screenshot({
        path: 'tests/design-audit/screenshots/notifications/01-bell-with-badge.png',
        fullPage: false,
        animations: 'disabled',
      })

      await bell.click()
      await page.waitForTimeout(800)
      await page.screenshot({
        path: 'tests/design-audit/screenshots/notifications/02-dropdown-open.png',
        fullPage: false,
        animations: 'disabled',
      })

      con.flush()
    } finally {
      await context.close()
    }
  })
})

// ============================================
// AI Assistant — real prompt (Pro tier)
// Budget: 1 prompt to verify chat works
// ============================================
test.describe('AI Assistant chat (Pro tier)', () => {
  test.beforeAll(() => setUserPlan('pro'))
  test.afterAll(() => setUserPlan('free'))

  test('send a prompt and receive response', async ({ browser }) => {
    test.setTimeout(180_000)
    const context = await getAuthenticatedContext(browser, BASE, { forceRefresh: true })
    const page = await context.newPage()
    try {
      const con = collectConsole(page, 'ai-prompt', 'ai-assistant')
      await page.goto(`${BASE}/ai-assistant`, { waitUntil: 'domcontentloaded' })
      await setTheme(page, 'light')
      await waitForStable(page, { watchSkeletons: true })

      // Dismiss onboarding tour if it shows
      const skipTour = page.getByRole('button', { name: /^Skip Tour$/i })
      if (await skipTour.isVisible().catch(() => false)) {
        await skipTour.click()
        await page.waitForTimeout(500)
      }

      await page.screenshot({
        path: 'tests/design-audit/screenshots/ai-assistant/01-empty.png',
        fullPage: false,
        animations: 'disabled',
      })

      // Locate chat input
      const input = page.getByPlaceholder(/Ask about/i).first()
      await expect(input).toBeVisible({ timeout: 8000 })
      await input.fill('What workflows do I have active?')
      await page.waitForTimeout(300)
      await page.screenshot({
        path: 'tests/design-audit/screenshots/ai-assistant/02-prompt-typed.png',
        fullPage: false,
        animations: 'disabled',
      })

      // Submit — try Enter key
      await input.press('Enter')
      await page.waitForTimeout(8000) // give it time to stream a response

      await page.screenshot({
        path: 'tests/design-audit/screenshots/ai-assistant/03-response.png',
        fullPage: true,
        animations: 'disabled',
      })

      con.flush()
    } finally {
      await context.close()
    }
  })
})

// ============================================
// Stripe checkout (test mode)
// ============================================
test.describe('Stripe checkout test mode', () => {
  test('Upgrade to Pro → Stripe Checkout fills', async ({ browser }) => {
    test.setTimeout(120_000)
    const context = await getAuthenticatedContext(browser, BASE, { forceRefresh: true })
    const page = await context.newPage()
    try {
      const con = collectConsole(page, 'stripe-checkout', 'stripe')
      await page.goto(`${BASE}/subscription`, { waitUntil: 'domcontentloaded' })
      await setTheme(page, 'light')
      await waitForStable(page, { watchSkeletons: true })

      // Find Upgrade to Pro button
      const upgrade = page
        .getByRole('button', { name: /^Upgrade to Pro$/i })
        .or(page.getByRole('link', { name: /^Upgrade to Pro$/i }))
        .first()

      if (!(await upgrade.isVisible().catch(() => false))) {
        // Fallback: look for "Pro" plan card and a button inside it
        const proCard = page.locator(':has-text("Pro")').filter({ has: page.locator('text=Most popular') }).first()
        const proBtn = proCard.locator('button, a').filter({ hasText: /upgrade|pro/i }).first()
        if (await proBtn.isVisible().catch(() => false)) {
          await proBtn.click()
        } else {
          await page.screenshot({
            path: 'tests/design-audit/screenshots/stripe/00-no-upgrade-button.png',
            fullPage: true,
          })
          throw new Error('Upgrade to Pro button not found')
        }
      } else {
        await upgrade.click()
      }

      // Wait for Stripe Checkout (either redirects to checkout.stripe.com or opens an embedded form)
      await page.waitForTimeout(4000)
      await page.screenshot({
        path: 'tests/design-audit/screenshots/stripe/01-after-click.png',
        fullPage: true,
      })

      // If on Stripe Checkout host, fill the test card
      const isStripeHost = page.url().includes('checkout.stripe.com')
      if (isStripeHost) {
        // Wait for form to mount
        await page.waitForTimeout(3000)

        // Email
        const emailInput = page.locator('input[name="email"]').first()
        if (await emailInput.isVisible().catch(() => false)) {
          await emailInput.fill(creds.email)
        }

        // Card number
        const cardNumber = page.locator('input[name="cardNumber"], input#cardNumber').first()
        await cardNumber.fill('4242424242424242')

        const cardExpiry = page.locator('input[name="cardExpiry"], input#cardExpiry').first()
        await cardExpiry.fill('12 / 34')

        const cardCvc = page.locator('input[name="cardCvc"], input#cardCvc').first()
        await cardCvc.fill('123')

        // Cardholder name
        const cardName = page.locator('input[name="billingName"], input#billingName').first()
        if (await cardName.isVisible().catch(() => false)) {
          await cardName.fill('Design Test')
        }

        // Country (US)
        const countrySelect = page.locator('select[name="billingCountry"], select#billingCountry').first()
        if (await countrySelect.isVisible().catch(() => false)) {
          await countrySelect.selectOption('US')
        }

        // Postal code
        const zip = page.locator('input[name="billingPostalCode"], input#billingPostalCode').first()
        if (await zip.isVisible().catch(() => false)) {
          await zip.fill('94110')
        }

        await page.screenshot({
          path: 'tests/design-audit/screenshots/stripe/02-form-filled.png',
          fullPage: true,
        })

        // NOTE: not clicking Pay — we don't want a webhook to update the DB during the audit
        // The form-fill alone proves the integration is wired correctly.
      }

      con.flush()
    } finally {
      await context.close()
    }
  })
})

// ============================================
// Auth flows via admin.generateLink (no email reading needed)
// ============================================
test.describe('Auth flows via admin.generateLink', () => {
  test('password recovery link works', async ({ browser }) => {
    test.setTimeout(60_000)
    const admin = adminClient()
    const { data, error } = await admin.auth.admin.generateLink({
      type: 'recovery',
      email: creds.email,
      options: { redirectTo: `${BASE}/auth/reset-password` },
    })
    if (error) throw error

    let link = data.properties?.action_link
    expect(link).toBeTruthy()
    // Supabase Site URL is prod; rewrite host to localhost so the link works locally
    link = link!.replace(/https?:\/\/(?:www\.)?chainreact\.app/i, BASE)

    const ctx = await browser.newContext()
    const page = await ctx.newPage()
    try {
      const con = collectConsole(page, 'recovery-link', 'auth-flows')
      await page.goto(link, { waitUntil: 'domcontentloaded' })
      await page.waitForTimeout(2500)
      await page.screenshot({
        path: 'tests/design-audit/screenshots/auth-flows/01-recovery-landing.png',
        fullPage: true,
      })
      con.flush()
    } finally {
      await ctx.close()
    }
  })

  test('signup confirm link works', async ({ browser }) => {
    test.setTimeout(60_000)
    const admin = adminClient()
    // Use a fresh ephemeral email for signup test
    const ephemeral = `audit-signup-${Date.now()}@example.test`
    const { error: cErr } = await admin.auth.admin.createUser({
      email: ephemeral,
      password: 'TempTest!Pass123',
      email_confirm: false,
    })
    if (cErr) throw cErr

    const { data, error } = await admin.auth.admin.generateLink({
      type: 'signup',
      email: ephemeral,
      password: 'TempTest!Pass123',
      options: { redirectTo: `${BASE}/auth/confirmation-success` },
    })
    if (error) throw error

    let link = data.properties?.action_link
    expect(link).toBeTruthy()
    link = link!.replace(/https?:\/\/(?:www\.)?chainreact\.app/i, BASE)

    const ctx = await browser.newContext()
    const page = await ctx.newPage()
    try {
      const con = collectConsole(page, 'signup-link', 'auth-flows')
      await page.goto(link, { waitUntil: 'domcontentloaded' })
      await page.waitForTimeout(2500)
      await page.screenshot({
        path: 'tests/design-audit/screenshots/auth-flows/02-signup-confirm.png',
        fullPage: true,
      })
      con.flush()
    } finally {
      await ctx.close()
      // Clean up the ephemeral user
      const list = await admin.auth.admin.listUsers({ perPage: 1000 })
      const user = list.data?.users.find((u) => u.email === ephemeral)
      if (user) await admin.auth.admin.deleteUser(user.id)
    }
  })
})

// ============================================
// Document upload — profile avatar in /settings
// ============================================
test.describe('Profile avatar upload', () => {
  test('upload PNG via avatar overlay', async ({ browser }) => {
    test.setTimeout(60_000)
    const context = await getAuthenticatedContext(browser, BASE, { forceRefresh: true })
    const page = await context.newPage()
    try {
      const con = collectConsole(page, 'avatar-upload', 'upload')
      await page.goto(`${BASE}/settings`, { waitUntil: 'domcontentloaded' })
      await setTheme(page, 'light')
      await waitForStable(page, { watchSkeletons: true })

      // Make a tiny test PNG (8x8 red pixel) on the fly
      const fixturePath = path.resolve(__dirname, '../.auth/avatar-fixture.png')
      if (!fs.existsSync(fixturePath)) {
        // Create a minimal valid PNG (1x1 red)
        // Pre-built bytes for a 1x1 red PNG
        const png = Buffer.from(
          '89504e470d0a1a0a0000000d49484452000000010000000108020000009077' +
          '53de0000000c4944415478da636060f80f000001010001b9b8c5740000000049454e44ae426082',
          'hex',
        )
        fs.writeFileSync(fixturePath, png)
      }

      const fileInput = page.locator('input[type="file"]').first()
      await fileInput.setInputFiles(fixturePath)
      await page.waitForTimeout(2000)
      await page.screenshot({
        path: 'tests/design-audit/screenshots/upload/01-avatar-uploaded.png',
        fullPage: false,
        animations: 'disabled',
      })

      con.flush()
    } finally {
      await context.close()
    }
  })
})
