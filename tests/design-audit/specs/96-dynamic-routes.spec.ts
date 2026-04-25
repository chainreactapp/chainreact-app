import { test, expect } from '@playwright/test'
import * as fs from 'fs'
import * as path from 'path'
import { fileURLToPath } from 'node:url'
import { getAuthenticatedContext } from '../fixtures/auth'
import { captureRoute } from '../utils/capture'
import { collectConsole } from '../utils/console-collector'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const BASE = process.env.PLAYWRIGHT_BASE_URL || 'http://localhost:3000'
const seedsFile = path.resolve(__dirname, '../.auth/seeds.json')
if (!fs.existsSync(seedsFile)) {
  throw new Error(`No seeds at ${seedsFile}. Run scripts/seed-dynamic-data.ts first.`)
}
const seeds = JSON.parse(fs.readFileSync(seedsFile, 'utf8')) as {
  orgSlug: string
  teamSlug: string
}

const ROUTES = [
  { slug: 'team-detail', path: `/teams/${seeds.teamSlug}` },
  { slug: 'team-members', path: `/teams/${seeds.teamSlug}/members` },
  { slug: 'org-settings', path: `/org/${seeds.orgSlug}/settings` },
]

test.describe('Dynamic-route capture', () => {
  test.describe.configure({ mode: 'serial' })

  for (const route of ROUTES) {
    test(`[dynamic] ${route.slug}`, async ({ browser }) => {
      test.setTimeout(180_000)
      const context = await getAuthenticatedContext(browser, BASE, { forceRefresh: true })
      const page = await context.newPage()
      try {
        const con = collectConsole(page, route.slug, 'dynamic')
        await page.goto(`${BASE}${route.path}`, { waitUntil: 'domcontentloaded' })
        await captureRoute(page, route.slug, 'dynamic', { watchSkeletons: true })
        con.flush()
        expect(page.url()).toContain(BASE)
      } finally {
        await context.close()
      }
    })
  }
})
