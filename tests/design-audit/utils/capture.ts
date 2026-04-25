import type { Page } from '@playwright/test'
import * as fs from 'fs'
import * as path from 'path'
import { fileURLToPath } from 'node:url'
import { BREAKPOINTS } from '../fixtures/breakpoints'
import { setTheme } from './theme'
import { waitForStable } from './stability'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

export type CaptureOptions = {
  themes?: Array<'light' | 'dark'>
  fullPage?: boolean
  viewportOnly?: boolean
  /** When true, waitForStable treats `.animate-pulse` as a real skeleton and waits for it. */
  watchSkeletons?: boolean
  /** Optional CSS selector that must be visible before we capture. */
  contentSelector?: string
}

/**
 * Captures a route at all breakpoints × themes.
 * Reloads once per theme (setTheme reloads), then resizes without reloading between breakpoints.
 */
export async function captureRoute(
  page: Page,
  slug: string,
  phase: string,
  options: CaptureOptions = {},
) {
  const themes = options.themes ?? ['light', 'dark']
  const doFullPage = options.fullPage !== false
  const doViewport = options.viewportOnly !== false
  const { watchSkeletons, contentSelector } = options

  const dir = path.join(ROOT, 'screenshots', phase, slug)
  fs.mkdirSync(dir, { recursive: true })

  for (const mode of themes) {
    await setTheme(page, mode)
    await waitForStable(page, { watchSkeletons, contentSelector })

    for (const bp of BREAKPOINTS) {
      await page.setViewportSize({ width: bp.width, height: bp.height })
      await page.waitForTimeout(250)

      if (doViewport) {
        await page.screenshot({
          path: path.join(dir, `${bp.name}-${mode}-viewport.png`),
          fullPage: false,
          animations: 'disabled',
        })
      }

      if (doFullPage) {
        await page.screenshot({
          path: path.join(dir, `${bp.name}-${mode}-fullpage.png`),
          fullPage: true,
          animations: 'disabled',
        })
      }
    }
  }
}
