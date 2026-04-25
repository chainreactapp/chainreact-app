import type { Page } from '@playwright/test'
import * as fs from 'fs'
import * as path from 'path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

export type LinkResult = {
  href: string
  status: number | null
  redirected: boolean
  ok: boolean
  error?: string
}

/** Collects external hrefs from the page and HEAD-checks each. */
export async function checkExternalLinks(
  page: Page,
  slug: string,
  phase: string,
): Promise<LinkResult[]> {
  const origin = new URL(page.url()).origin

  const hrefs: string[] = await page.$$eval('a[href]', (anchors) =>
    anchors
      .map((a) => (a as HTMLAnchorElement).href)
      .filter((h) => h && !h.startsWith('javascript:') && !h.startsWith('mailto:')),
  )

  const external = Array.from(new Set(hrefs.filter((h) => !h.startsWith(origin))))

  const results: LinkResult[] = []
  for (const href of external) {
    try {
      const res = await fetch(href, { method: 'HEAD', redirect: 'follow' })
      results.push({
        href,
        status: res.status,
        redirected: res.redirected,
        ok: res.ok,
      })
    } catch (err: any) {
      results.push({
        href,
        status: null,
        redirected: false,
        ok: false,
        error: String(err?.message ?? err),
      })
    }
  }

  const dir = path.join(ROOT, 'reports', phase)
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(
    path.join(dir, `${slug}-links.json`),
    JSON.stringify(results, null, 2),
  )

  return results
}
