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
const admin = createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } })

const credsFile = path.resolve(__dirname, '../.auth/credentials.json')
const creds = JSON.parse(fs.readFileSync(credsFile, 'utf8')) as { userId: string }
const userId = creds.userId

const action = process.argv[2] // 'seed' | 'clear'

if (action === 'clear') {
  const { error } = await admin.from('notifications').delete().eq('user_id', userId)
  if (error) console.error(error)
  else console.log(`[ok] Cleared notifications for ${userId}`)
  process.exit(0)
}

const samples = [
  {
    user_id: userId,
    type: 'integration_disconnected',
    title: 'Slack connection needs attention',
    message: 'Your Slack token expired. Reconnect to keep workflows running.',
    action_url: '/connections',
    action_label: 'Reconnect',
    is_read: false,
  },
  {
    user_id: userId,
    type: 'execution_failed',
    title: 'Workflow "Customer onboarding" failed',
    message: 'The HTTP request step returned 500. Click to view the run.',
    action_url: '/workflows',
    action_label: 'View run',
    is_read: false,
  },
  {
    user_id: userId,
    type: 'system',
    title: 'Pro trial ends in 3 days',
    message: 'Upgrade now to keep AI Assistant, Analytics, and unlimited workflows.',
    action_url: '/subscription',
    action_label: 'Upgrade',
    is_read: false,
  },
  {
    user_id: userId,
    type: 'team_invitation',
    title: 'You were invited to "Design Test Team"',
    message: 'Accept the invite to start collaborating.',
    action_url: '/teams',
    action_label: 'Accept',
    is_read: true,
  },
]

const { error } = await admin.from('notifications').insert(samples)
if (error) {
  console.error('[err]', error)
  process.exit(1)
}
console.log(`[ok] Inserted ${samples.length} notifications for ${userId}`)
