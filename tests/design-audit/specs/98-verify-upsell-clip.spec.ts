import { test } from '@playwright/test'
import { getAuthenticatedContext } from '../fixtures/auth'
import { setTheme } from '../utils/theme'
import { waitForStable } from '../utils/stability'

const BASE = process.env.PLAYWRIGHT_BASE_URL || 'http://localhost:3000'

const ROUTES = ['/ai-assistant', '/analytics']
const SIZES = [
  { name: 'mobile', width: 375, height: 812 },
  { name: 'laptop', width: 1280, height: 800 },
  { name: 'wide', width: 1920, height: 1080 },
]

test.describe('Verify upsell card no longer clips top', () => {
  for (const routePath of ROUTES) {
    const slug = routePath.replace(/\//g, '').replace(/^$/, 'root')
    test(`${slug}`, async ({ browser }) => {
      test.setTimeout(90_000)
      const context = await getAuthenticatedContext(browser, BASE)
      const page = await context.newPage()
      try {
        await page.goto(`${BASE}${routePath}`, { waitUntil: 'domcontentloaded' })
        await setTheme(page, 'light')
        await waitForStable(page, { watchSkeletons: true })

        for (const bp of SIZES) {
          await page.setViewportSize({ width: bp.width, height: bp.height })
          await page.waitForTimeout(300)
          await page.screenshot({
            path: `tests/design-audit/screenshots/verify/upsell-${slug}/${bp.name}-light.png`,
            fullPage: false,
            animations: 'disabled',
          })
        }
      } finally {
        await context.close()
      }
    })
  }
})
