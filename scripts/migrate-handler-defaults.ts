/**
 * PR-G0 — CLI runner for the handler-defaults backfill framework.
 *
 * Runs the entries currently in
 * `lib/workflows/migrations/handlerDefaultsBackfillRegistry.ts` against
 * the connected Supabase project. Idempotent — safe to re-run.
 *
 * Usage:
 *   tsx scripts/migrate-handler-defaults.ts                    # apply all entries
 *   tsx scripts/migrate-handler-defaults.ts --dry-run          # preview
 *   tsx scripts/migrate-handler-defaults.ts --pr=PR-G2         # only PR-G2 entries
 *   tsx scripts/migrate-handler-defaults.ts --pr=PR-G2,PR-G3   # specific PRs
 *
 * Environment:
 *   SUPABASE_URL          (required)
 *   SUPABASE_SECRET_KEY   (required, service-role key)
 *
 * Contract: learning/docs/handler-contracts.md Q11.
 */

import { createClient } from '@supabase/supabase-js'

import {
  HANDLER_DEFAULTS_BACKFILL_REGISTRY,
  runHandlerDefaultsBackfill,
} from '../lib/workflows/migrations'

interface CliArgs {
  dryRun: boolean
  prs: string[] | undefined
}

function parseArgs(argv: readonly string[]): CliArgs {
  const args: CliArgs = { dryRun: false, prs: undefined }
  for (const raw of argv.slice(2)) {
    if (raw === '--dry-run' || raw === '-n') {
      args.dryRun = true
      continue
    }
    if (raw.startsWith('--pr=')) {
      const list = raw.slice('--pr='.length)
      args.prs = list.split(',').map((s) => s.trim()).filter(Boolean)
      continue
    }
    console.error(`Unknown argument: ${raw}`)
    process.exit(2)
  }
  return args
}

async function main() {
  const supabaseUrl = process.env.SUPABASE_URL
  const supabaseServiceKey = process.env.SUPABASE_SECRET_KEY
  if (!supabaseUrl || !supabaseServiceKey) {
    console.error('Missing SUPABASE_URL or SUPABASE_SECRET_KEY')
    process.exit(1)
  }

  const supabase = createClient(supabaseUrl, supabaseServiceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })

  const cli = parseArgs(process.argv)

  console.log('--- handler-defaults backfill ---')
  console.log(`  registry size: ${HANDLER_DEFAULTS_BACKFILL_REGISTRY.length}`)
  console.log(`  selected PRs:  ${cli.prs ? cli.prs.join(',') : '(all)'}`)
  console.log(`  dry run:       ${cli.dryRun}`)

  if (HANDLER_DEFAULTS_BACKFILL_REGISTRY.length === 0) {
    console.log('Registry is empty (no PR-Gn entries appended yet) — nothing to do.')
    return
  }

  const result = await runHandlerDefaultsBackfill({
    supabase: supabase as any,
    dryRun: cli.dryRun,
    prs: cli.prs,
  })

  console.log('--- result ---')
  console.log(`  scanned:      ${result.scanned}`)
  console.log(`  rowsUpdated:  ${result.rowsUpdated}${result.dryRun ? ' (dry run — nothing persisted)' : ''}`)
  console.log('  per entry:')
  for (const [key, count] of Object.entries(result.byEntry)) {
    console.log(`    ${key}: ${count}`)
  }
}

main().catch((err) => {
  console.error('handler-defaults backfill failed:', err)
  process.exit(1)
})
