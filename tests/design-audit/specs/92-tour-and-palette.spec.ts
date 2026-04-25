import { test, expect } from '@playwright/test'
import { getAuthenticatedContext } from '../fixtures/auth'
import { collectConsole } from '../utils/console-collector'
import { setTheme } from '../utils/theme'
import { waitForStable } from '../utils/stability'

const BASE = process.env.PLAYWRIGHT_BASE_URL || 'http://localhost:3000'

test.describe('Onboarding tour walkthrough (mobile)', () => {
  test('walk through all 8 steps', async ({ browser }) => {
    test.setTimeout(180_000)
    const context = await getAuthenticatedContext(browser, BASE, { forceRefresh: true })
    const page = await context.newPage()
    try {
      const con = collectConsole(page, 'tour', 'tour')
      await page.setViewportSize({ width: 375, height: 812 })
      await page.goto(`${BASE}/workflows`, { waitUntil: 'domcontentloaded' })
      await setTheme(page, 'light')
      await waitForStable(page, { watchSkeletons: true })

      // Walk steps
      for (let step = 1; step <= 8; step++) {
        await page.waitForTimeout(500)
        await page.screenshot({
          path: `tests/design-audit/screenshots/tour/step-${step}.png`,
          fullPage: false,
          animations: 'disabled',
        })

        // Click Next or Done — final step usually says Done/Finish/Get Started
        const next = page
          .getByRole('button', { name: /^Next$/i })
          .or(page.getByRole('button', { name: /^(Done|Finish|Get started|Got it)$/i }))
          .first()

        if (await next.isVisible().catch(() => false)) {
          await next.click()
        } else {
          break
        }
      }

      con.flush()
    } finally {
      await context.close()
    }
  })
})

test.describe('Command palette (Cmd+K)', () => {
  test('open palette and type', async ({ browser }) => {
    test.setTimeout(60_000)
    const context = await getAuthenticatedContext(browser, BASE, { forceRefresh: true })
    const page = await context.newPage()
    try {
      const con = collectConsole(page, 'palette', 'palette')
      await page.goto(`${BASE}/workflows`, { waitUntil: 'domcontentloaded' })
      await setTheme(page, 'light')
      await waitForStable(page, { watchSkeletons: true })
      await page.setViewportSize({ width: 1280, height: 800 })

      // Try keyboard shortcut first
      await page.keyboard.press('Meta+k')
      await page.waitForTimeout(800)
      await page.screenshot({
        path: 'tests/design-audit/screenshots/palette/01-opened.png',
        fullPage: false,
        animations: 'disabled',
      })

      // Type a query
      const input = page.locator('[cmdk-input], input[placeholder*="ype"], input[placeholder*="earch"]').first()
      if (await input.isVisible().catch(() => false)) {
        await input.fill('settings')
        await page.waitForTimeout(500)
        await page.screenshot({
          path: 'tests/design-audit/screenshots/palette/02-typed-settings.png',
          fullPage: false,
          animations: 'disabled',
        })
      }

      // Close palette via Escape
      await page.keyboard.press('Escape')
      await page.waitForTimeout(300)

      con.flush()
    } finally {
      await context.close()
    }
  })
})
