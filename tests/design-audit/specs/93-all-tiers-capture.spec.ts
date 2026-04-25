import { test, expect } from '@playwright/test'
import { spawnSync } from 'node:child_process'
import * as path from 'path'
import { fileURLToPath } from 'node:url'
import { getAuthenticatedContext } from '../fixtures/auth'
import { captureRoute } from '../utils/capture'
import { collectConsole } from '../utils/console-collector'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const BASE = process.env.PLAYWRIGHT_BASE_URL || 'http://localhost:3000'

const ROUTES = [
  { slug: 'ai-assistant', path: '/ai-assistant' },
  { slug: 'analytics', path: '/analytics' },
  { slug: 'teams', path: '/teams' },
  { slug: 'org', path: '/org' },
  { slug: 'subscription', path: '/subscription' },
]

const TIERS = ['pro', 'team', 'business', 'enterprise', 'free'] as const

function setUserPlan(plan: string) {
  const script = path.resolve(__dirname, '../scripts/set-test-user-plan.ts')
  const r = spawnSync('npx', ['tsx', script, plan], {
    cwd: path.resolve(__dirname, '../../..'),
    stdio: 'pipe',
    encoding: 'utf8',
  })
  if (r.status !== 0) throw new Error(`set-plan ${plan} failed: ${r.stderr}`)
}

for (const tier of TIERS.slice(0, 4)) {
  test.describe(`Tier capture: ${tier}`, () => {
    test.describe.configure({ mode: 'serial' })

    test.beforeAll(() => {
      setUserPlan(tier)
    })

    for (const route of ROUTES) {
      test(`[${tier}] ${route.slug}`, async ({ browser }) => {
        test.setTimeout(120_000)
        const context = await getAuthenticatedContext(browser, BASE, { forceRefresh: true })
        const page = await context.newPage()
        try {
          const con = collectConsole(page, `${tier}-${route.slug}`, 'tiers')
          await page.goto(`${BASE}${route.path}`, { waitUntil: 'domcontentloaded' })
          await captureRoute(page, `${tier}-${route.slug}`, 'tiers', { watchSkeletons: true })
          con.flush()
          expect(page.url()).toContain(BASE)
        } finally {
          await context.close()
        }
      })
    }
  })
}

test.describe('Revert to free', () => {
  test('revert', () => { setUserPlan('free') })
})
