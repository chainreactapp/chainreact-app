import type { Page } from '@playwright/test'

export type StabilityOptions = {
  timeoutMs?: number
  /** If true, wait for `.animate-pulse` skeletons to disappear (up to timeoutMs). */
  watchSkeletons?: boolean
  /** Optional CSS selector that must be visible before we consider the page loaded. */
  contentSelector?: string
}

/**
 * Best-effort wait for the page to look stable before screenshot.
 * Public routes: short wait (3s), ignore `.animate-pulse` (often decorative glow).
 * Auth'd routes: longer wait (8s), treat `.animate-pulse` as real skeleton and wait for it.
 */
export async function waitForStable(page: Page, opts: StabilityOptions = {}) {
  const timeoutMs = opts.timeoutMs ?? (opts.watchSkeletons ? 8000 : 3000)
  const watchSkeletons = opts.watchSkeletons ?? false

  await page.waitForLoadState('load', { timeout: timeoutMs }).catch(() => {})

  if (opts.contentSelector) {
    await page
      .waitForSelector(opts.contentSelector, { state: 'visible', timeout: timeoutMs })
      .catch(() => {})
  }

  await page
    .waitForFunction(
      ({ watchSkeletons: watch }) => {
        const isVisible = (el: Element) => {
          const rect = (el as HTMLElement).getBoundingClientRect()
          if (rect.width === 0 || rect.height === 0) return false
          const style = window.getComputedStyle(el as HTMLElement)
          return style.visibility !== 'hidden' && style.display !== 'none'
        }

        const nodes = Array.from(document.querySelectorAll('body *')) as Element[]
        for (const el of nodes) {
          const text = (el.textContent ?? '').trim()
          if (text === 'Loading...' && isVisible(el)) return false
        }

        const alwaysWatch = ['[aria-busy="true"]', '.animate-spin']
        for (const sel of alwaysWatch) {
          const matches = Array.from(document.querySelectorAll(sel))
          if (matches.some(isVisible)) return false
        }

        if (watch) {
          const skeletons = Array.from(document.querySelectorAll('.animate-pulse, [data-skeleton]'))
          if (skeletons.some(isVisible)) return false
        }

        return true
      },
      { watchSkeletons },
      { timeout: timeoutMs, polling: 200 },
    )
    .catch(() => {})

  await page.waitForTimeout(200)
}
