import type { Page } from '@playwright/test'

export async function setTheme(page: Page, theme: 'light' | 'dark') {
  await page.evaluate((t) => {
    try {
      localStorage.setItem('theme', t)
    } catch {
      // ignore
    }
  }, theme)

  await page.reload({ waitUntil: 'domcontentloaded' })

  await page.waitForFunction(
    (t) => (t === 'dark') === document.documentElement.classList.contains('dark'),
    theme,
    { timeout: 3000 },
  ).catch(() => {
    // next-themes may be mid-hydration on some routes; fall through and let the caller capture
  })
}
