import { test, expect } from '@playwright/test'
import { getAuthenticatedContext } from '../fixtures/auth'
import { captureRoute } from '../utils/capture'
import { collectConsole } from '../utils/console-collector'
import { appRoutes, publicRoutes } from '../fixtures/routes'

const BASE = process.env.PLAYWRIGHT_BASE_URL || 'http://localhost:3000'
const PHASE = 'baseline'

test.describe('Phase 2 baseline — public routes', () => {
  test.describe.configure({ mode: 'serial' })

  for (const route of publicRoutes()) {
    if (route.needsSeed) continue
    test(`[public] ${route.slug}`, async ({ page }) => {
      test.setTimeout(90_000)
      const con = collectConsole(page, route.slug, PHASE)
      const resp = await page
        .goto(`${BASE}${route.path}`, { waitUntil: 'domcontentloaded', timeout: 20_000 })
        .catch(() => null)
      if (resp && resp.ok()) {
        await captureRoute(page, route.slug, PHASE, { watchSkeletons: false })
      }
      con.flush()
      expect(page.url()).toContain(BASE)
    })
  }
})

test.describe('Phase 2 baseline — authenticated routes', () => {
  test.describe.configure({ mode: 'serial' })

  for (const route of appRoutes()) {
    if (route.needsSeed) continue
    test(`[auth] ${route.slug}`, async ({ browser }) => {
      test.setTimeout(180_000)
      const context = await getAuthenticatedContext(browser, BASE)
      const page = await context.newPage()
      try {
        const con = collectConsole(page, route.slug, PHASE)
        const resp = await page
          .goto(`${BASE}${route.path}`, { waitUntil: 'domcontentloaded', timeout: 20_000 })
          .catch(() => null)
        if (resp) {
          await captureRoute(page, route.slug, PHASE, { watchSkeletons: true })
        }
        con.flush()
        expect(page.url()).toContain(BASE)
      } finally {
        await context.close()
      }
    })
  }
})
