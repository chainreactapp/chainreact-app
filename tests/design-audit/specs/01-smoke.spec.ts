import { test, expect } from '@playwright/test'
import { getAuthenticatedContext } from '../fixtures/auth'
import { captureRoute } from '../utils/capture'
import { collectConsole } from '../utils/console-collector'

const BASE = process.env.PLAYWRIGHT_BASE_URL || 'http://localhost:3001'

test.describe('Phase 1 smoke', () => {
  test.describe.configure({ mode: 'serial' })
  test.setTimeout(180_000)

  test('landing page loads and captures in both themes', async ({ page }) => {
    const con = collectConsole(page, 'landing', 'smoke')
    await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' })
    await page.waitForTimeout(500)
    await captureRoute(page, 'landing', 'smoke', { fullPage: true })
    con.flush()
    expect(page.url()).toContain(BASE)
  })

  test('login flow reaches an authenticated page', async ({ browser }) => {
    const context = await getAuthenticatedContext(browser, BASE, { forceRefresh: true })
    const page = await context.newPage()
    const con = collectConsole(page, 'post-login', 'smoke')
    await page.goto(`${BASE}/workflows`, { waitUntil: 'domcontentloaded' })
    await captureRoute(page, 'workflows', 'smoke', { fullPage: true, watchSkeletons: true })
    con.flush()
    expect(page.url()).toContain('/workflows')
    await context.close()
  })
})
