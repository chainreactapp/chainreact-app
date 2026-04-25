import type { Page } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import * as fs from 'fs'
import * as path from 'path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

export type AxeSummary = {
  slug: string
  url: string
  criticalCount: number
  seriousCount: number
  moderateCount: number
  minorCount: number
  totalViolations: number
}

export async function runAxe(page: Page, slug: string, phase: string): Promise<AxeSummary> {
  const builder = new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'best-practice'])
    .disableRules([
      // color-contrast is noisy on gradients and next-themes transitions; we re-enable in per-page specs
      'color-contrast',
    ])

  const results = await builder.analyze()

  const dir = path.join(ROOT, 'reports', phase)
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(
    path.join(dir, `${slug}-axe.json`),
    JSON.stringify(results, null, 2),
  )

  const summary: AxeSummary = {
    slug,
    url: page.url(),
    criticalCount: results.violations.filter((v) => v.impact === 'critical').length,
    seriousCount: results.violations.filter((v) => v.impact === 'serious').length,
    moderateCount: results.violations.filter((v) => v.impact === 'moderate').length,
    minorCount: results.violations.filter((v) => v.impact === 'minor').length,
    totalViolations: results.violations.length,
  }

  const summaryPath = path.join(dir, 'axe-summary.jsonl')
  fs.appendFileSync(summaryPath, JSON.stringify(summary) + '\n')

  return summary
}
