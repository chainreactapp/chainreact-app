/**
 * Setup Stripe subscription products + prices for Pro / Team / Business.
 *
 * Creates:
 *   - 3 Stripe Products (one per tier)
 *   - 6 Stripe Prices (each tier × monthly + yearly)
 *
 * Reads price_monthly and price_yearly from the DB plans table:
 *   - price_monthly is the dollars-per-month for monthly billing (e.g. $19/mo)
 *   - price_yearly is the dollars-per-month effective rate when billed annually
 *     (e.g. $15/mo = $180/yr lump sum)
 *
 * Writes back stripe_price_id_monthly and stripe_price_id_yearly to plans.
 *
 * Idempotent via lookup_keys:
 *   product → metadata.lookup_key = `subscription-product-{tier}`
 *   price   → lookup_key = `subscription-{tier}-{cycle}` (e.g. subscription-pro-monthly)
 *
 * Re-running is safe — existing products + prices with the same lookup_key are
 * reused. If you previously created prices manually in the Dashboard without a
 * lookup_key, the script will NOT find them and will create new ones; clean up
 * the manual ones in Stripe Dashboard before re-running.
 *
 * Mode: whichever Stripe key is in env (sk_test_... or sk_live_...). Same DB
 * either way — flipping from test to live IDs requires re-running with a live key.
 *
 * Usage:
 *   npx tsx scripts/setup-stripe-prices.ts        (or `npm run setup-stripe`)
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
  {
    name: 'monthly' as const,
    interval: 'month' as const,
    dbColumn: 'stripe_price_id_monthly' as const,
    /** monthly price = price_monthly × 100 cents */
    centsFromPlan: (priceMonthly: number, _priceYearly: number) => Math.round(priceMonthly * 100),
  },
  {
    name: 'yearly' as const,
    interval: 'year' as const,
    dbColumn: 'stripe_price_id_yearly' as const,
    /** yearly lump sum = price_yearly × 12 × 100 cents (price_yearly is effective $/mo) */
    centsFromPlan: (_priceMonthly: number, priceYearly: number) => Math.round(priceYearly * 12 * 100),
  },
]

function tierProductName(tier: string): string {
  const map: Record<string, string> = { pro: 'Pro', team: 'Team', business: 'Business' }
  return `ChainReact ${map[tier] ?? tier}`
}

async function findOrCreateProduct(tier: string, description: string | null): Promise<Stripe.Product> {
  const lookupKey = `subscription-product-${tier}`
  const list = await stripe.products.search({
    query: `metadata['lookup_key']:'${lookupKey}'`,
    limit: 1,
  })
  if (list.data.length > 0) {
    console.log(`  Product exists: ${list.data[0].id} (${tier})`)
    return list.data[0]
  }
  const product = await stripe.products.create({
    name: tierProductName(tier),
    description: description ?? `ChainReact ${tier} subscription.`,
    metadata: { lookup_key: lookupKey, tier },
  })
  console.log(`  Created product: ${product.id} (${tier})`)
  return product
}

async function findOrCreatePrice(
  product: Stripe.Product,
  tier: string,
  cycle: typeof CYCLES[number],
  unitAmount: number,
): Promise<Stripe.Price> {
  const lookupKey = `subscription-${tier}-${cycle.name}`

  const existing = await stripe.prices.list({ lookup_keys: [lookupKey], active: true, limit: 1 })
  if (existing.data.length > 0) {
    const found = existing.data[0]
    if (found.unit_amount !== unitAmount || found.recurring?.interval !== cycle.interval) {
      console.warn(
        `  ⚠ Existing price ${found.id} (${lookupKey}) has different shape ` +
        `(amount=${found.unit_amount}, interval=${found.recurring?.interval}). ` +
        `Manual cleanup required if you want to update pricing — Stripe prices are immutable. ` +
        `Workaround: rename the lookup_key on the old price in Dashboard, then re-run this script.`
      )
    } else {
      console.log(`  Price exists: ${found.id} (${lookupKey})`)
    }
    return found
  }

  const dollars = (unitAmount / 100).toFixed(2)
  const annualSuffix = cycle.name === 'yearly' ? `/yr` : `/mo`
  const price = await stripe.prices.create({
    product: product.id,
    currency: 'usd',
    unit_amount: unitAmount,
    recurring: {
      interval: cycle.interval,
    },
    lookup_key: lookupKey,
    nickname: `${tierProductName(tier)} ${cycle.name} ($${dollars}${annualSuffix})`,
    metadata: { tier, cycle: cycle.name },
    tax_behavior: 'exclusive',
  })
  console.log(`  Created price: ${price.id} (${lookupKey}) at $${dollars}${annualSuffix}`)
  return price
}

async function main() {
  const mode = stripeKey!.startsWith('sk_test_') ? 'TEST' : stripeKey!.startsWith('sk_live_') ? 'LIVE' : 'UNKNOWN'
  console.log(`Stripe key mode: ${mode}`)
  console.log()

  const { data: plans, error } = await supabase
    .from('plans')
    .select('id, name, description, price_monthly, price_yearly, stripe_price_id_monthly, stripe_price_id_yearly')
    .in('name', TIERS as unknown as string[])

  if (error || !plans) {
    console.error('Failed to read plans:', error)
    process.exit(1)
  }

  for (const tier of TIERS) {
    const plan = plans.find((p) => p.name === tier)
    if (!plan) {
      console.error(`Plan ${tier} not found in DB — skipping`)
      continue
    }
    const priceMonthly = Number(plan.price_monthly ?? 0)
    const priceYearly = Number(plan.price_yearly ?? 0)
    if (priceMonthly <= 0 || priceYearly <= 0) {
      console.error(`Plan ${tier} has invalid prices — skipping`)
      continue
    }

    console.log(`Tier: ${tier} ($${priceMonthly}/mo billed monthly, $${priceYearly}/mo effective when billed annually)`)
    const product = await findOrCreateProduct(tier, plan.description ?? null)

    const updates: Record<string, string> = {}
    for (const cycle of CYCLES) {
      const unitAmount = cycle.centsFromPlan(priceMonthly, priceYearly)
      const price = await findOrCreatePrice(product, tier, cycle, unitAmount)
      updates[cycle.dbColumn] = price.id
    }

    // Skip the DB write when nothing changed (avoid touching a row that was
    // already correct and triggering audit-log noise).
    const noChange =
      updates.stripe_price_id_monthly === plan.stripe_price_id_monthly &&
      updates.stripe_price_id_yearly === plan.stripe_price_id_yearly

    if (noChange) {
      console.log(`  ✓ plans.${tier} already in sync`)
    } else {
      const { error: updateError } = await supabase
        .from('plans')
        .update(updates)
        .eq('id', plan.id)

      if (updateError) {
        console.error(`  Failed to update plans row for ${tier}:`, updateError.message)
      } else {
        console.log(`  Updated plans.${tier}: monthly=${updates.stripe_price_id_monthly}, yearly=${updates.stripe_price_id_yearly}`)
      }
    }
    console.log()
  }

  console.log('Done.')
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
