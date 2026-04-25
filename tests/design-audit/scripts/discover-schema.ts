import { createClient } from '@supabase/supabase-js'
import * as path from 'path'
import { fileURLToPath } from 'node:url'
import * as dotenv from 'dotenv'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
dotenv.config({ path: path.resolve(__dirname, '../../../.env.local') })

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!
const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_SECRET_KEY!
const admin = createClient(url, key, {
  auth: { autoRefreshToken: false, persistSession: false },
})

for (const t of ['teams', 'organizations', 'support_tickets', 'team_members', 'organization_members']) {
  const { data, error } = await admin.from(t).select('*').limit(1)
  console.log(`-- ${t}:`, error?.message ?? `OK (${data?.length ?? 0} sample row)`)
  if (data && data[0]) console.log('   columns:', Object.keys(data[0]).join(', '))
}
