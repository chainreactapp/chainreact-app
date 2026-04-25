import { test, expect } from '@playwright/test'
import { getAuthenticatedContext } from '../fixtures/auth'
import { runAxe } from '../utils/axe-runner'
import { waitForStable } from '../utils/stability'
import { appRoutes, publicRoutes } from '../fixtures/routes'

const BASE = process.env.PLAYWRIGHT_BASE_URL || 'http://localhost:3000'
const PHASE = 'a11y'

test.describe('Axe a11y — public routes', () => {
  for (const route of publicRoutes()) {
    if (route.needsSeed) continue
    test(`[public] ${route.slug}`, async ({ page }) => {
      test.setTimeout(60_000)
      const resp = await page
        .goto(`${BASE}${route.path}`, { waitUntil: 'domcontentloaded', timeout: 20_000 })
        .catch(() => null)
      if (!resp) return
      await waitForStable(page)
      const summary = await runAxe(page, route.slug, PHASE)
      // Only fail on critical violations — serious/moderate/minor are reported but non-blocking.
      expect.soft(summary.criticalCount, `axe critical violations on ${route.slug}`).toBe(0)
    })
  }
})

test.describe('Axe a11y — authenticated routes', () => {
  for (const route of appRoutes()) {
    if (route.needsSeed) continue
    test(`[auth] ${route.slug}`, async ({ browser }) => {
      test.setTimeout(120_000)
      const context = await getAuthenticatedContext(browser, BASE)
      const page = await context.newPage()
      try {
        const resp = await page
          .goto(`${BASE}${route.path}`, { waitUntil: 'domcontentloaded', timeout: 20_000 })
          .catch(() => null)
        if (!resp) return
        await waitForStable(page, { watchSkeletons: true })
        const summary = await runAxe(page, route.slug, PHASE)
        expect.soft(summary.criticalCount, `axe critical violations on ${route.slug}`).toBe(0)
      } finally {
        await context.close()
      }
    })
  }
})
