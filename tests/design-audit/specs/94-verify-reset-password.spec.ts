import { test } from '@playwright/test'
import { setTheme } from '../utils/theme'
import { waitForStable } from '../utils/stability'

const BASE = process.env.PLAYWRIGHT_BASE_URL || 'http://localhost:3000'

test('reset-password matches login styling', async ({ page }) => {
  test.setTimeout(60_000)
  await page.goto(`${BASE}/auth/reset-password`, { waitUntil: 'domcontentloaded' })
  await setTheme(page, 'light')
  await waitForStable(page)
  await page.setViewportSize({ width: 1280, height: 800 })
  await page.waitForTimeout(500)
  await page.screenshot({
    path: 'tests/design-audit/screenshots/verify/reset-password.png',
    fullPage: false,
    animations: 'disabled',
  })
  await page.setViewportSize({ width: 375, height: 812 })
  await page.waitForTimeout(500)
  await page.screenshot({
    path: 'tests/design-audit/screenshots/verify/reset-password-mobile.png',
    fullPage: false,
    animations: 'disabled',
  })
})
