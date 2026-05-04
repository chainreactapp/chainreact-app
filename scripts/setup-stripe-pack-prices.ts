/**
 * Setup Stripe one-time prices for extra task packs.
 *
 * Creates one Product + one Price per tier (Pro / Team / Business). The price
 * is `mode: 'payment'` (one-time, not recurring). Reads pack_size +
 * pack_price_cents from the DB plans table; writes the resulting Stripe price
 * IDs back into plans.stripe_pack_price_id.
 *
 * Idempotent via lookup_keys: re-running finds existing prices instead of
 * creating duplicates.
 *
 * Mode: whichever Stripe key is in env (sk_test_... or sk_live_...).
 *
 * Usage:
 *   npx tsx scripts/setup-stripe-pack-prices.ts
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

function tierProductName(tier: string): string {
  const map: Record<string, string> = { pro: 'Pro', team: 'Team', business: 'Business' }
  return `ChainReact ${map[tier] ?? tier} Task Pack`
}

async function findOrCreateProduct(tier: string, packSize: number): Promise<Stripe.Product> {
  const lookupKey = `task-pack-product-${tier}`
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
    description: `One-time pack of ${packSize.toLocaleString()} extra tasks for users on ChainReact ${tier}.`,
    metadata: { lookup_key: lookupKey, tier, pack_size: String(packSize) },
  })
  console.log(`  Created product: ${product.id} (${tier})`)
  return product
}

async function findOrCreatePrice(
  product: Stripe.Product,
  tier: string,
  packSize: number,
  packPriceCents: number,
): Promise<Stripe.Price> {
  const lookupKey = `task-pack-${tier}`

  const existing = await stripe.prices.list({ lookup_keys: [lookupKey], active: true, limit: 1 })
  if (existing.data.length > 0) {
    console.log(`  Price exists: ${existing.data[0].id} (${lookupKey})`)
    return existing.data[0]
  }

  const price = await stripe.prices.create({
    product: product.id,
    currency: 'usd',
    unit_amount: packPriceCents,
    // No `recurring` — one-time price, used with checkout `mode: payment`.
    lookup_key: lookupKey,
    nickname: `${tierProductName(tier)} ($${(packPriceCents / 100).toFixed(2)})`,
    metadata: { tier, pack_size: String(packSize) },
  })
  console.log(`  Created price: ${price.id} (${lookupKey}) at $${(packPriceCents / 100).toFixed(2)}`)
  return price
}

async function main() {
  console.log(`Stripe key mode: ${stripeKey!.startsWith('sk_test_') ? 'TEST' : stripeKey!.startsWith('sk_live_') ? 'LIVE' : 'UNKNOWN'}`)
  console.log()

  const { data: plans, error } = await supabase
    .from('plans')
    .select('id, name, pack_size, pack_price_cents')
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
    if (!plan.pack_size || !plan.pack_price_cents) {
      console.error(`Plan ${tier} missing pack_size or pack_price_cents — skipping`)
      continue
    }

    console.log(`Tier: ${tier} (${plan.pack_size.toLocaleString()} tasks for $${(plan.pack_price_cents / 100).toFixed(2)})`)
    const product = await findOrCreateProduct(tier, plan.pack_size)
    const price = await findOrCreatePrice(product, tier, plan.pack_size, plan.pack_price_cents)

    const { error: updateError } = await supabase
      .from('plans')
      .update({ stripe_pack_price_id: price.id })
      .eq('id', plan.id)

    if (updateError) {
      console.error(`  Failed to update plans row for ${tier}:`, updateError.message)
    } else {
      console.log(`  Updated plans.${tier}.stripe_pack_price_id = ${price.id}`)
    }
    console.log()
  }

  console.log('Done.')
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
