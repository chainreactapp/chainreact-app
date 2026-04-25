import { createClient } from '@supabase/supabase-js'
import * as path from 'path'
import { fileURLToPath } from 'node:url'
import * as dotenv from 'dotenv'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
dotenv.config({ path: path.resolve(__dirname, '../../../.env.local') })

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!
const SERVICE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_SECRET_KEY!
const DEV_REF = 'xzwsdwllmrnrgbltibxt'
const EMAIL = 'design-test+claude@chainreactapp.com'

if (!SUPABASE_URL.includes(DEV_REF)) {
  console.error(`[SAFETY] Expected ${DEV_REF}, got ${SUPABASE_URL}. Abort.`)
  process.exit(1)
}

const plan = process.argv[2]
if (!plan || !['free', 'pro', 'team', 'business', 'enterprise'].includes(plan)) {
  console.error('usage: set-test-user-plan.ts <free|pro|team|business|enterprise>')
  process.exit(1)
}

const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
})

const { data: u, error: uErr } = await admin.auth.admin.listUsers({ perPage: 1000 })
if (uErr) { console.error(uErr); process.exit(1) }
const user = u.users.find((x) => x.email === EMAIL)
if (!user) { console.error(`user ${EMAIL} not found`); process.exit(1) }

const { error } = await admin
  .from('user_profiles')
  .update({ plan })
  .eq('id', user.id)

if (error) {
  console.error('[err] update failed:', error.message)
  // Some schemas use `profiles` table
  const { error: e2 } = await admin.from('profiles').update({ plan }).eq('id', user.id)
  if (e2) {
    console.error('[err] profiles update also failed:', e2.message)
    process.exit(1)
  }
  console.log(`[ok] Set ${EMAIL} plan=${plan} (on profiles table)`)
} else {
  console.log(`[ok] Set ${EMAIL} plan=${plan} (on user_profiles table)`)
}
