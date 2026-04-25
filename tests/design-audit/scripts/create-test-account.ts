import { createClient } from '@supabase/supabase-js'
import * as crypto from 'crypto'
import * as fs from 'fs'
import * as path from 'path'
import { fileURLToPath } from 'node:url'
import * as dotenv from 'dotenv'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

dotenv.config({ path: path.resolve(__dirname, '../../../.env.local') })

const EMAIL = 'design-test+claude@chainreactapp.com'
const DEV_PROJECT_REF = 'xzwsdwllmrnrgbltibxt'

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const SERVICE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_SECRET_KEY

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error('[fatal] Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local')
  process.exit(1)
}

if (!SUPABASE_URL.includes(DEV_PROJECT_REF)) {
  console.error(
    `[SAFETY] Expected dev Supabase (${DEV_PROJECT_REF}) but got ${SUPABASE_URL}. Aborting.`,
  )
  process.exit(1)
}

async function main() {
  const admin = createClient(SUPABASE_URL!, SERVICE_KEY!, {
    auth: { autoRefreshToken: false, persistSession: false },
  })

  const { data: existingList, error: listErr } = await admin.auth.admin.listUsers({ perPage: 1000 })
  if (listErr) throw listErr
  const existing = existingList?.users.find((u) => u.email === EMAIL)

  const password = crypto.randomBytes(24).toString('base64url')

  if (existing) {
    const { error } = await admin.auth.admin.updateUserById(existing.id, {
      password,
      email_confirm: true,
    })
    if (error) throw error
    writeCreds({ email: EMAIL, password, userId: existing.id })
    console.log(`[ok] Reset password for existing user ${EMAIL} (id=${existing.id})`)
    return
  }

  const { data, error } = await admin.auth.admin.createUser({
    email: EMAIL,
    password,
    email_confirm: true,
  })
  if (error) throw error
  writeCreds({ email: EMAIL, password, userId: data.user!.id })
  console.log(`[ok] Created user ${EMAIL} (id=${data.user!.id})`)
}

function writeCreds(creds: { email: string; password: string; userId: string }) {
  const dir = path.resolve(__dirname, '../.auth')
  fs.mkdirSync(dir, { recursive: true })
  const file = path.join(dir, 'credentials.json')
  fs.writeFileSync(file, JSON.stringify(creds, null, 2))
  fs.chmodSync(file, 0o600)
  console.log(`[ok] Wrote credentials to ${file} (mode 0600)`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
