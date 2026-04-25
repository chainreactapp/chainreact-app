import { test, devices } from '@playwright/test'
import { getCredentials } from '../fixtures/auth'
import { setTheme } from '../utils/theme'
import { waitForStable } from '../utils/stability'

const BASE = process.env.PLAYWRIGHT_BASE_URL || 'http://localhost:3000'

const PUBLIC_ROUTES = ['/', '/pricing', '/auth/login', '/auth/register']
const AUTH_ROUTES = ['/workflows', '/connections', '/settings']

// Use iPhone 14 viewport on chromium (webkit project not configured in playwright.config.ts)
const iphone = devices['iPhone 14']
test.use({
  viewport: iphone.viewport,
  userAgent: iphone.userAgent,
  deviceScaleFactor: iphone.deviceScaleFactor,
  isMobile: iphone.isMobile,
  hasTouch: iphone.hasTouch,
})

for (const path of PUBLIC_ROUTES) {
  const slug = path === '/' ? 'landing' : path.replace(/\//g, '-').replace(/^-/, '')
  test(`[webkit-public] ${slug}`, async ({ page }) => {
    test.setTimeout(60_000)
    await page.goto(`${BASE}${path}`, { waitUntil: 'domcontentloaded' })
    await setTheme(page, 'light')
    await waitForStable(page)
    await page.screenshot({
      path: `tests/design-audit/screenshots/webkit/${slug}-light.png`,
      fullPage: false,
      animations: 'disabled',
    })
  })
}

for (const path of AUTH_ROUTES) {
  const slug = path.replace(/\//g, '-').replace(/^-/, '')
  test(`[webkit-auth] ${slug}`, async ({ page, context }) => {
    test.setTimeout(120_000)
    const { email, password } = getCredentials()
    await page.goto(`${BASE}/auth/login`, { waitUntil: 'networkidle' })
    await page.locator('#email').fill(email)
    await page.locator('#password').fill(password)
    await page.waitForTimeout(900)
    await page.getByRole('button', { name: 'Sign In', exact: true }).click()
    await page.waitForURL(/\/(workflows|dashboard|new|home)/, { timeout: 20000 })
    await page.goto(`${BASE}${path}`, { waitUntil: 'domcontentloaded' })
    await setTheme(page, 'light')
    await waitForStable(page, { watchSkeletons: true })
    await page.screenshot({
      path: `tests/design-audit/screenshots/webkit/${slug}-light.png`,
      fullPage: false,
      animations: 'disabled',
    })
  })
}
