import type { ConsoleMessage, Page } from '@playwright/test'
import * as fs from 'fs'
import * as path from 'path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

export type ConsoleEntry = {
  type: string
  text: string
  locationUrl?: string
  timestamp: number
}

export function collectConsole(page: Page, slug: string, phase: string) {
  const entries: ConsoleEntry[] = []

  const onConsole = (msg: ConsoleMessage) => {
    const t = msg.type()
    if (t === 'error' || t === 'warning' || t === 'warn') {
      entries.push({
        type: t,
        text: msg.text(),
        locationUrl: msg.location()?.url,
        timestamp: Date.now(),
      })
    }
  }

  const onPageError = (err: Error) => {
    entries.push({
      type: 'pageerror',
      text: `${err.name}: ${err.message}`,
      timestamp: Date.now(),
    })
  }

  page.on('console', onConsole)
  page.on('pageerror', onPageError)

  return {
    entries,
    flush() {
      const dir = path.join(ROOT, 'reports', phase)
      fs.mkdirSync(dir, { recursive: true })
      fs.writeFileSync(
        path.join(dir, `${slug}-console.json`),
        JSON.stringify(entries, null, 2),
      )
      return entries
    },
    detach() {
      page.off('console', onConsole)
      page.off('pageerror', onPageError)
    },
  }
}
