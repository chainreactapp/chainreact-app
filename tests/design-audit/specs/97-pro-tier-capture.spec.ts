import { test, expect } from '@playwright/test'
import { getAuthenticatedContext } from '../fixtures/auth'
import { captureRoute } from '../utils/capture'
import { collectConsole } from '../utils/console-collector'

const BASE = process.env.PLAYWRIGHT_BASE_URL || 'http://localhost:3000'

const ROUTES = [
  { slug: 'ai-assistant', path: '/ai-assistant' },
  { slug: 'analytics', path: '/analytics' },
  { slug: 'teams', path: '/teams' },
  { slug: 'org', path: '/org' },
]

test.describe('Pro-tier capture', () => {
  test.describe.configure({ mode: 'serial' })

  for (const route of ROUTES) {
    test(`[pro] ${route.slug}`, async ({ browser }) => {
      test.setTimeout(180_000)
      // Force a fresh auth context so the upgraded plan is reflected in new session cookies
      const context = await getAuthenticatedContext(browser, BASE, { forceRefresh: true })
      const page = await context.newPage()
      try {
        const con = collectConsole(page, route.slug, 'pro')
        await page.goto(`${BASE}${route.path}`, { waitUntil: 'domcontentloaded' })
        await captureRoute(page, route.slug, 'pro', { watchSkeletons: true })
        con.flush()
        expect(page.url()).toContain(BASE)
      } finally {
        await context.close()
      }
    })
  }
})
