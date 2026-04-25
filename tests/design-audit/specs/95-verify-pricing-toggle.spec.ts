import { test } from '@playwright/test'
import { getAuthenticatedContext } from '../fixtures/auth'
import { setTheme } from '../utils/theme'
import { waitForStable } from '../utils/stability'

const BASE = process.env.PLAYWRIGHT_BASE_URL || 'http://localhost:3000'

test.describe('Verify subscription pricing toggle', () => {
  test('strike-through visible only on Annual', async ({ browser }) => {
    test.setTimeout(120_000)
    const context = await getAuthenticatedContext(browser, BASE, { forceRefresh: true })
    const page = await context.newPage()
    try {
      await page.goto(`${BASE}/subscription`, { waitUntil: 'domcontentloaded' })
      await setTheme(page, 'light')
      await waitForStable(page, { watchSkeletons: true })
      await page.setViewportSize({ width: 1280, height: 800 })
      await page.waitForTimeout(500)

      // Annual is default per the screenshot — capture as-is
      await page.screenshot({
        path: 'tests/design-audit/screenshots/verify/pricing-annual.png',
        fullPage: true,
        animations: 'disabled',
      })

      // Click Monthly toggle
      const monthly = page.getByRole('button', { name: /^Monthly$/ }).first()
      if (await monthly.isVisible()) {
        await monthly.click()
        await page.waitForTimeout(500)
        await page.screenshot({
          path: 'tests/design-audit/screenshots/verify/pricing-monthly.png',
          fullPage: true,
          animations: 'disabled',
        })
      }

      // Click back to Annual
      const annual = page.getByRole('button', { name: /^Annual/ }).first()
      if (await annual.isVisible()) {
        await annual.click()
        await page.waitForTimeout(500)
      }
    } finally {
      await context.close()
    }
  })
})
