import type { Browser, BrowserContext, Page } from '@playwright/test'
import * as fs from 'fs'
import * as path from 'path'
import { fileURLToPath } from 'node:url'

const AUTH_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../.auth')
const CRED_FILE = path.join(AUTH_DIR, 'credentials.json')
const STORAGE_FILE = path.join(AUTH_DIR, 'storageState.json')

export type Credentials = { email: string; password: string; userId: string }

export function getCredentials(): Credentials {
  if (!fs.existsSync(CRED_FILE)) {
    throw new Error(
      `No credentials at ${CRED_FILE}. Run: npx tsx tests/design-audit/scripts/create-test-account.ts`,
    )
  }
  return JSON.parse(fs.readFileSync(CRED_FILE, 'utf8')) as Credentials
}

export async function loginViaUi(page: Page, baseUrl: string) {
  const { email, password } = getCredentials()
  await page.goto(`${baseUrl}/auth/login`, { waitUntil: 'networkidle' })

  await page.waitForSelector('#email', { state: 'visible', timeout: 5000 })
  await page.locator('#email').fill(email)
  await page.locator('#password').fill(password)

  // The form debounces a /api/auth/check-provider request on email change;
  // wait for it to settle so the Sign In button isn't disabled.
  await page.waitForTimeout(900)

  const submit = page.getByRole('button', { name: 'Sign In', exact: true })
  await submit.waitFor({ state: 'visible' })
  await submit.click()

  await page.waitForURL(/\/(workflows|dashboard|new|home|builder|onboarding)/, {
    timeout: 20000,
  })
}

export async function getAuthenticatedContext(
  browser: Browser,
  baseUrl: string,
  opts: { forceRefresh?: boolean } = {},
): Promise<BrowserContext> {
  if (!opts.forceRefresh && fs.existsSync(STORAGE_FILE)) {
    return browser.newContext({ storageState: STORAGE_FILE })
  }

  fs.mkdirSync(AUTH_DIR, { recursive: true })

  const context = await browser.newContext()
  const page = await context.newPage()
  await loginViaUi(page, baseUrl)
  await context.storageState({ path: STORAGE_FILE })
  fs.chmodSync(STORAGE_FILE, 0o600)
  await page.close()
  return context
}
