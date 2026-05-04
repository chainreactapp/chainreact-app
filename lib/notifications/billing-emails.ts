/**
 * Billing notification emails.
 *
 * Plain-text emails sent by the /api/cron/usage-alerts cron:
 *   - threshold_80         — user has used 80% of monthly tasks
 *   - threshold_100        — user is at or past their plan limit
 *   - overage_activated    — first overage charge in the current period
 *   - pack_depleted        — task pack balance hit zero (after having balance)
 *
 * Each helper composes subject + body and forwards to lib/notifications/email.ts
 * sendEmail. No React Email templates yet — keep emails text-only for v1.
 */

import { sendEmail } from '@/lib/notifications/email'

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || 'https://chainreact.app'

function settingsUrl() {
  return `${APP_URL}/subscription`
}

export async function sendThreshold80Email(args: {
  to: string
  tasksUsed: number
  tasksLimit: number
  plan: string
}) {
  const pct = Math.round((args.tasksUsed / args.tasksLimit) * 100)
  const subject = `You've used ${pct}% of your ChainReact tasks this month`
  const text = [
    `Hi,`,
    ``,
    `You've used ${args.tasksUsed.toLocaleString()} of your ${args.tasksLimit.toLocaleString()} monthly tasks (${pct}%) on the ${args.plan} plan.`,
    ``,
    `If you'll exceed your limit before the next reset, you can:`,
    `  • Enable overage billing to keep running at the per-task rate`,
    `  • Buy a one-time task pack`,
    `  • Upgrade your plan`,
    ``,
    `Manage your subscription: ${settingsUrl()}`,
    ``,
    `— ChainReact`,
  ].join('\n')
  return sendEmail(args.to, subject, text)
}

export async function sendThreshold100Email(args: {
  to: string
  tasksLimit: number
  plan: string
  overageEnabled: boolean
}) {
  const subject = `You've reached your ChainReact monthly task limit`
  const text = [
    `Hi,`,
    ``,
    `You've used all ${args.tasksLimit.toLocaleString()} of your monthly tasks on the ${args.plan} plan.`,
    ``,
    args.overageEnabled
      ? `Overage billing is enabled — your workflows will keep running, billed at your plan's per-task rate.`
      : `Workflows that need more tasks are now blocked. To keep running:\n  • Enable overage billing\n  • Buy a one-time task pack\n  • Upgrade your plan`,
    ``,
    `Manage your subscription: ${settingsUrl()}`,
    ``,
    `— ChainReact`,
  ].join('\n')
  return sendEmail(args.to, subject, text)
}

export async function sendOverageActivatedEmail(args: {
  to: string
  plan: string
  overageRate: number
  capMultiplier: number
  tasksLimit: number
}) {
  const subject = `Overage billing has started for your ChainReact account`
  const cap = Math.floor(args.tasksLimit * args.capMultiplier)
  const text = [
    `Hi,`,
    ``,
    `Your workflows have started running on overage. Each task past your monthly limit is billed at $${args.overageRate.toFixed(3)}.`,
    ``,
    `Your overage cap is ${args.capMultiplier.toFixed(1)}× your plan limit (up to ${cap.toLocaleString()} tasks/month total before workflows pause).`,
    ``,
    `Adjust the cap or disable overage anytime: ${settingsUrl()}`,
    ``,
    `— ChainReact`,
  ].join('\n')
  return sendEmail(args.to, subject, text)
}

export async function sendPackDepletedEmail(args: {
  to: string
  plan: string
  autoBuyEnabled: boolean
}) {
  const subject = `Your ChainReact task pack balance is empty`
  const text = [
    `Hi,`,
    ``,
    `You've used up your task pack balance.`,
    ``,
    args.autoBuyEnabled
      ? `Auto-buy is enabled — the next workflow that exceeds your plan + overage cap will charge your saved card for another pack.`
      : `To keep running past your plan limit, you can buy another pack or enable auto-buy.`,
    ``,
    `Manage packs: ${settingsUrl()}`,
    ``,
    `— ChainReact`,
  ].join('\n')
  return sendEmail(args.to, subject, text)
}
