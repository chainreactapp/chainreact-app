/**
 * Setup Stripe metered prices for task overage billing.
 *
 * Creates one shared Billing Meter (`event_name: 'task_overage'`) plus one metered
 * price per (tier × cycle) for Pro / Team / Business — 6 prices total, all linked
 * to the same meter. Reads the per-tier overage rate from `plans.limits.overageRate`
 * in the DB. Writes the resulting price IDs back into
 * `plans.stripe_metered_price_id_{monthly,yearly}`.
 *
 * Stripe API ≥ 2025-03-31.basil requires metered prices to be backed by a meter,
 * and usage must be reported via `billing.meterEvents.create` (NOT the legacy
 * `subscriptionItems.createUsageRecord`). See `lib/billing/overage-reporter.ts`.
 *
 * Idempotent: each price has a `lookup_key` like `task-overage-pro-monthly` and
 * the meter is keyed by `event_name`. Re-running the script will find existing
 * resources instead of creating duplicates.
 *
 * Mode: whichever Stripe key is in env (sk_test_... or sk_live_...). Same DB plans
 * table either way — flipping from test to live IDs requires re-running with a live key.
 *
 * Usage:
 *   npx tsx scripts/setup-stripe-metered-prices.ts
 *
 * Required env (from .env.local):
 *   STRIPE_CLIENT_SECRET, NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SECRET_KEY
 */

import Stripe from 'stripe'
import { createClient } from '@supabase/supabase-js'
import * as dotenv from 'dotenv'
import { resolve } from 'path'

dotenv.config({ path: resolve(process.cwd(), '.env.local') })

const stripeKey = process.env.STRIPE_CLIENT_SECRET
if (!stripeKey) {
  console.error('STRIPE_CLIENT_SECRET missing')
  process.exit(1)
}
const stripe = new Stripe(stripeKey, { apiVersion: '2025-05-28.basil' })

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SECRET_KEY!
)

const TIERS = ['pro', 'team', 'business'] as const
const CYCLES = [
  { name: 'monthly', interval: 'month' as const, dbColumn: 'stripe_metered_price_id_monthly' },
  { name: 'yearly', interval: 'year' as const, dbColumn: 'stripe_metered_price_id_yearly' },
]

// Shared meter event name. Must stay in sync with the reporter
// (lib/billing/overage-reporter.ts) — it sends events with this same name.
const METER_EVENT_NAME = 'task_overage'

async function findOrCreateMeter(): Promise<Stripe.Billing.Meter> {
  // Meters don't have lookup_keys; list and filter by event_name. Active+inactive both
  // returned by default — pick an active one if present.
  const list = await stripe.billing.meters.list({ limit: 100 })
  const existing = list.data.find(
    (m) => m.event_name === METER_EVENT_NAME && m.status === 'active',
  )
  if (existing) {
    console.log(`  Meter exists: ${existing.id} (event_name=${METER_EVENT_NAME})`)
    return existing
  }

  const meter = await stripe.billing.meters.create({
    display_name: 'ChainReact Task Overage',
    event_name: METER_EVENT_NAME,
    default_aggregation: { formula: 'sum' },
    customer_mapping: { type: 'by_id', event_payload_key: 'stripe_customer_id' },
    value_settings: { event_payload_key: 'value' },
  })
  console.log(`  Created meter: ${meter.id} (event_name=${METER_EVENT_NAME})`)
  return meter
}

function tierProductName(tier: string): string {
  const map: Record<string, string> = { pro: 'Pro', team: 'Team', business: 'Business' }
  return `ChainReact ${map[tier] ?? tier} Overage`
}

async function findOrCreateProduct(tier: string): Promise<Stripe.Product> {
  const lookupKey = `task-overage-product-${tier}`
  const list = await stripe.products.search({ query: `metadata['lookup_key']:'${lookupKey}'`, limit: 1 })
  if (list.data.length > 0) {
    console.log(`  Product exists: ${list.data[0].id} (${tier})`)
    return list.data[0]
  }
  const product = await stripe.products.create({
    name: tierProductName(tier),
    description: `Per-task overage charges for users on ChainReact ${tier} who opted into overage billing.`,
    metadata: { lookup_key: lookupKey, tier },
  })
  console.log(`  Created product: ${product.id} (${tier})`)
  return product
}

async function findOrCreatePrice(
  product: Stripe.Product,
  meterId: string,
  tier: string,
  cycle: typeof CYCLES[number],
  unitAmountDecimal: string,
): Promise<Stripe.Price> {
  const lookupKey = `task-overage-${tier}-${cycle.name}`

  // Stripe `prices.list({ lookup_keys: [...] })` returns active prices matching the keys
  const existing = await stripe.prices.list({ lookup_keys: [lookupKey], active: true, limit: 1 })
  if (existing.data.length > 0) {
    console.log(`  Price exists: ${existing.data[0].id} (${lookupKey})`)
    return existing.data[0]
  }

  // Meter-backed metered price. `aggregate_usage` is NOT allowed when `meter` is set —
  // aggregation is determined by the meter's `default_aggregation.formula`.
  const price = await stripe.prices.create({
    product: product.id,
    currency: 'usd',
    unit_amount_decimal: unitAmountDecimal,
    recurring: {
      interval: cycle.interval,
      usage_type: 'metered',
      meter: meterId,
    },
    billing_scheme: 'per_unit',
    lookup_key: lookupKey,
    nickname: `${tierProductName(tier)} ${cycle.name}`,
    metadata: { tier, cycle: cycle.name },
  })
  console.log(`  Created price: ${price.id} (${lookupKey}) at ${unitAmountDecimal}¢/task`)
  return price
}

async function main() {
  console.log(`Stripe key mode: ${stripeKey!.startsWith('sk_test_') ? 'TEST' : stripeKey!.startsWith('sk_live_') ? 'LIVE' : 'UNKNOWN'}`)
  console.log()

  // Read overage rates from plans table
  const { data: plans, error } = await supabase
    .from('plans')
    .select('id, name, limits')
    .in('name', TIERS as unknown as string[])

  if (error || !plans) {
    console.error('Failed to read plans:', error)
    process.exit(1)
  }

  // One shared meter for all tier × cycle prices.
  console.log('Meter:')
  const meter = await findOrCreateMeter()
  console.log()

  for (const tier of TIERS) {
    const plan = plans.find((p) => p.name === tier)
    if (!plan) {
      console.error(`Plan ${tier} not found in DB — skipping`)
      continue
    }
    const overageRate = (plan.limits as { overageRate?: number } | null)?.overageRate
    if (!overageRate || overageRate <= 0) {
      console.error(`Plan ${tier} has no overageRate in limits.overageRate — skipping`)
      continue
    }

    // Stripe `unit_amount_decimal` is in cents as a string with up to 12 decimal places.
    // overageRate is dollars/task. e.g. 0.025 → "2.5" cents per task.
    const unitAmountDecimal = (overageRate * 100).toFixed(4).replace(/\.?0+$/, '')

    console.log(`Tier: ${tier} (rate $${overageRate}/task = ${unitAmountDecimal}¢)`)
    const product = await findOrCreateProduct(tier)

    const updates: Record<string, string> = {}
    for (const cycle of CYCLES) {
      const price = await findOrCreatePrice(product, meter.id, tier, cycle, unitAmountDecimal)
      updates[cycle.dbColumn] = price.id
    }

    const { error: updateError } = await supabase
      .from('plans')
      .update(updates)
      .eq('id', plan.id)

    if (updateError) {
      console.error(`  Failed to update plans row for ${tier}:`, updateError.message)
    } else {
      console.log(`  Updated plans.${tier}: monthly=${updates.stripe_metered_price_id_monthly}, yearly=${updates.stripe_metered_price_id_yearly}`)
    }
    console.log()
  }

  console.log('Done.')
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
