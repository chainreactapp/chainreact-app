import { createClient } from '@supabase/supabase-js'
import * as path from 'path'
import * as fs from 'fs'
import { fileURLToPath } from 'node:url'
import * as dotenv from 'dotenv'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
dotenv.config({ path: path.resolve(__dirname, '../../../.env.local') })

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!
const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_SECRET_KEY!
const DEV_REF = 'xzwsdwllmrnrgbltibxt'

if (!url.includes(DEV_REF)) {
  console.error(`[SAFETY] Expected ${DEV_REF}, got ${url}`)
  process.exit(1)
}

const credsFile = path.resolve(__dirname, '../.auth/credentials.json')
const creds = JSON.parse(fs.readFileSync(credsFile, 'utf8')) as { userId: string }
const userId = creds.userId

const admin = createClient(url, key, {
  auth: { autoRefreshToken: false, persistSession: false },
})

const ORG_SLUG = 'design-test-org'
const TEAM_SLUG = 'design-test-team'

// Find or create organization
let orgId: string
const { data: existingOrg } = await admin
  .from('organizations')
  .select('id, slug')
  .eq('slug', ORG_SLUG)
  .maybeSingle()

if (existingOrg) {
  orgId = existingOrg.id
  console.log(`[ok] Org ${ORG_SLUG} exists (id=${orgId})`)
} else {
  const { data: newOrg, error: orgErr } = await admin
    .from('organizations')
    .insert({
      name: 'Design Test Org',
      slug: ORG_SLUG,
      owner_id: userId,
      description: 'Seeded for design-audit dynamic-route capture',
    })
    .select('id')
    .single()
  if (orgErr) { console.error('org create failed:', orgErr); process.exit(1) }
  orgId = newOrg.id
  console.log(`[ok] Created org ${ORG_SLUG} (id=${orgId})`)

  // Add membership
  await admin.from('organization_members').upsert(
    { organization_id: orgId, user_id: userId, role: 'owner' },
    { onConflict: 'organization_id,user_id' },
  )
}

// Find or create team
let teamId: string
const { data: existingTeam } = await admin
  .from('teams')
  .select('id, slug')
  .eq('slug', TEAM_SLUG)
  .maybeSingle()

if (existingTeam) {
  teamId = existingTeam.id
  console.log(`[ok] Team ${TEAM_SLUG} exists (id=${teamId})`)
} else {
  const { data: newTeam, error: teamErr } = await admin
    .from('teams')
    .insert({
      organization_id: orgId,
      name: 'Design Test Team',
      slug: TEAM_SLUG,
      description: 'Seeded for design-audit dynamic-route capture',
      created_by: userId,
    })
    .select('id')
    .single()
  if (teamErr) { console.error('team create failed:', teamErr); process.exit(1) }
  teamId = newTeam.id
  console.log(`[ok] Created team ${TEAM_SLUG} (id=${teamId})`)

  await admin.from('team_members').upsert(
    { team_id: teamId, user_id: userId, role: 'owner' },
    { onConflict: 'team_id,user_id' },
  )
}

// Write seed file for fixture consumption
const seedFile = path.resolve(__dirname, '../.auth/seeds.json')
fs.writeFileSync(seedFile, JSON.stringify({ orgSlug: ORG_SLUG, teamSlug: TEAM_SLUG, orgId, teamId }, null, 2))
fs.chmodSync(seedFile, 0o600)
console.log(`[ok] Wrote seeds to ${seedFile}`)
