import { test, expect } from '@playwright/test'
import { getAuthenticatedContext } from '../fixtures/auth'
import { captureRoute } from '../utils/capture'
import { collectConsole } from '../utils/console-collector'
import { setTheme } from '../utils/theme'
import { waitForStable } from '../utils/stability'

const BASE = process.env.PLAYWRIGHT_BASE_URL || 'http://localhost:3000'

const ROUTES = ['/workflows', '/connections', '/ai-assistant']

test.describe('Verify mobile hamburger + off-canvas sidebar', () => {
  for (const routePath of ROUTES) {
    const slug = routePath.replace(/\//g, '').replace(/^$/, 'root')
    test(`${slug} at mobile`, async ({ browser }) => {
      test.setTimeout(120_000)
      const context = await getAuthenticatedContext(browser, BASE)
      const page = await context.newPage()
      try {
        const con = collectConsole(page, `${slug}-verify-mobile`, 'verify')
        await page.goto(`${BASE}${routePath}`, { waitUntil: 'domcontentloaded' })
        await waitForStable(page, { watchSkeletons: true })
        await setTheme(page, 'light')
        await waitForStable(page, { watchSkeletons: true })

        // Closed-drawer capture at mobile
        await page.setViewportSize({ width: 375, height: 812 })
        await page.waitForTimeout(300)
        await page.screenshot({
          path: `tests/design-audit/screenshots/verify/${slug}/mobile-light-closed.png`,
          fullPage: false,
          animations: 'disabled',
        })

        // Now open the drawer via the hamburger
        const menuBtn = page.getByRole('button', { name: /open navigation menu/i })
        await expect(menuBtn).toBeVisible()
        await menuBtn.click()
        await page.waitForTimeout(300)
        await page.screenshot({
          path: `tests/design-audit/screenshots/verify/${slug}/mobile-light-open.png`,
          fullPage: false,
          animations: 'disabled',
        })

        con.flush()
      } finally {
        await context.close()
      }
    })
  }
})
