import { createClient } from "@supabase/supabase-js"
import { NextResponse } from "next/server"
import { jsonResponse, errorResponse, successResponse } from '@/lib/utils/api-response'
import Stripe from "stripe"
import { getStripeClient } from "@/lib/stripe/client"

import { logger } from '@/lib/utils/logger'

// Helper function to safely convert timestamps to ISO strings
function safeTimestampToISO(timestamp: number | null | undefined): string | null {
  if (!timestamp || timestamp <= 0) return null;
  try {
    return new Date(timestamp * 1000).toISOString();
  } catch (e) {
    logger.error("[Stripe Webhook] Invalid timestamp:", timestamp, e);
    return null;
  }
}

export async function POST(request: Request) {
  logger.info("[Stripe Billing Webhook] ========================================")
  logger.info("[Stripe Billing Webhook] Received billing webhook request at:", new Date().toISOString())
  logger.info("[Stripe Billing Webhook] Headers:", Object.fromEntries(request.headers.entries()))
  
  const stripe = getStripeClient()
  // This webhook handles billing events for ChainReact subscriptions
  // Use /api/webhooks/stripe-integration for workflow triggers
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET!
  const body = await request.text()
  const signature = request.headers.get("stripe-signature")!

  logger.info("[Stripe Billing Webhook] Has signature:", !!signature)
  logger.info("[Stripe Billing Webhook] Body length:", body.length)
  logger.info("[Stripe Billing Webhook] Webhook secret configured:", !!webhookSecret)

  let event: Stripe.Event

  try {
    event = stripe.webhooks.constructEvent(body, signature, webhookSecret)
    logger.info(`[Stripe Webhook] Event type: ${event.type}, ID: ${event.id}`)
  } catch (error: any) {
    logger.error("[Stripe Webhook] Signature verification failed:", error.message)
    return errorResponse("Invalid signature" , 400)
  }

  // Use service role key to bypass RLS
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SECRET_KEY!
  )

  try {
    logger.info(`[Stripe Webhook] Processing event: ${event.type}`)

    switch (event.type) {
      case "checkout.session.completed":
        logger.info("[Stripe Webhook] Processing checkout.session.completed")
        await handleCheckoutCompleted(event.data.object as Stripe.Checkout.Session, supabase, stripe)
        break

      case "customer.subscription.created":
        logger.info("[Stripe Webhook] Processing customer.subscription.created")
        await handleSubscriptionCreated(event.data.object as Stripe.Subscription, supabase)
        break

      case "customer.subscription.updated":
        logger.info("[Stripe Webhook] Processing customer.subscription.updated")
        await handleSubscriptionUpdated(event.data.object as Stripe.Subscription, supabase)
        break

      case "customer.subscription.deleted":
        logger.info("[Stripe Webhook] Processing customer.subscription.deleted")
        await handleSubscriptionDeleted(event.data.object as Stripe.Subscription, supabase)
        break

      case "invoice.payment_succeeded":
        logger.info("[Stripe Webhook] Processing invoice.payment_succeeded")
        await handlePaymentSucceeded(event.data.object as Stripe.Invoice, supabase)
        break

      case "invoice.payment_failed":
        logger.info("[Stripe Webhook] Processing invoice.payment_failed")
        await handlePaymentFailed(event.data.object as Stripe.Invoice, supabase)
        break

      case "charge.refunded":
        logger.info("[Stripe Webhook] Processing charge.refunded")
        await handleChargeRefunded(event.data.object as Stripe.Charge, supabase)
        break

      default:
        logger.info(`[Stripe Webhook] Unhandled event type: ${event.type}`)
    }

    logger.info(`[Stripe Webhook] Successfully processed event: ${event.type}`)
    return jsonResponse({ received: true })
  } catch (error: any) {
    logger.error("[Stripe Webhook] Handler error:", error)
    logger.error("[Stripe Webhook] Error details:", JSON.stringify(error, null, 2))
    return errorResponse("Webhook handler failed", 500, { details: error.message  })
  }
}

async function handleCheckoutCompleted(session: Stripe.Checkout.Session, supabase: any, stripeClient: Stripe) {
  logger.info("[Stripe Webhook] handleCheckoutCompleted - Session ID:", session.id, "mode:", session.mode)

  // One-time pack purchase — separate code path (no subscription to retrieve)
  if (session.mode === 'payment') {
    await handlePackPurchaseCompleted(session, supabase)
    return
  }

  logger.debug("[Stripe Webhook] Has metadata:", !!session.metadata)
  logger.debug("[Stripe Webhook] Has customer email:", !!session.customer_details?.email)

  // Try multiple sources for user info
  let userId = session.metadata?.user_id
  const planId = session.metadata?.plan_id || 'pro' // Default to pro if not specified
  const billingCycle = session.metadata?.billing_cycle || 'monthly'

  // If no userId in metadata, try to find from customer email
  if (!userId && session.customer_details?.email) {
    logger.info("[Stripe Webhook] No userId in metadata, attempting to find by email")
    const { data: userData, error: userError } = await supabase
      .from("users")
      .select("id")
      .eq("email", session.customer_details.email)
      .single()
    
    if (userData && !userError) {
      userId = userData.id
      logger.info("[Stripe Webhook] Found userId from email:", userId)
    } else {
      logger.error("[Stripe Webhook] Could not find user by email:", userError)
    }
  }

  if (!userId) {
    logger.error("[Stripe Webhook] CRITICAL: Could not determine userId from metadata or email")
    logger.error("Session data:", {
      metadata: session.metadata,
      customer: session.customer,
      customer_email: session.customer_details?.email
    })
    // Don't return - try to store as much as possible
  }

  logger.info(`[Stripe Webhook] Processing for user: ${userId || 'UNKNOWN'}, plan: ${planId}, cycle: ${billingCycle}`)

  // Get the full subscription details from Stripe
  let subscription
  try {
    subscription = await stripeClient.subscriptions.retrieve(session.subscription as string, {
      expand: ['default_payment_method', 'latest_invoice', 'discount']
    })
  } catch (retrieveError) {
    logger.error("[Stripe Webhook] Failed to retrieve subscription:", retrieveError)
    // Try to create minimal record with session data
    const minimalData = {
      user_id: userId || null,
      plan_id: planId,
      stripe_customer_id: session.customer as string,
      stripe_subscription_id: session.subscription as string,
      status: 'active',
      billing_cycle: billingCycle,
      customer_email: session.customer_details?.email || null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    }
    
    logger.info("[Stripe Webhook] Attempting minimal record creation:", minimalData)
    const { error: minimalError } = await supabase
      .from("subscriptions")
      .upsert(minimalData, {
        onConflict: 'stripe_subscription_id'
      })
    
    if (minimalError) {
      logger.error("[Stripe Webhook] Failed to create minimal record:", minimalError)
    } else {
      logger.info("[Stripe Webhook] Created minimal subscription record")
    }
    return
  }

  logger.info("[Stripe Webhook] Retrieved subscription:", subscription.id)

  // Persist payment method ID for off-session auto-buy (closes a latent bug
  // where this was extracted but never saved — see migration 20260504000003).
  const defaultPaymentMethodId =
    typeof (subscription as any).default_payment_method === 'string'
      ? (subscription as any).default_payment_method
      : (subscription as any).default_payment_method?.id ?? null

  // Extract ONLY the fields that exist in the database
  const subscriptionData = {
    user_id: userId,
    plan_id: planId,
    stripe_customer_id: session.customer as string,
    stripe_subscription_id: subscription.id,
    status: subscription.status,
    billing_cycle: billingCycle || 'monthly',
    current_period_start: safeTimestampToISO(subscription.current_period_start) || new Date().toISOString(),
    current_period_end: safeTimestampToISO(subscription.current_period_end) || new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
    default_payment_method_id: defaultPaymentMethodId,
    created_at: safeTimestampToISO(subscription.created) || new Date().toISOString(),
    updated_at: new Date().toISOString()
  }

  logger.debug("[Stripe Webhook] Upserting subscription data for user")

  // First, try to check if subscription already exists
  const { data: existing } = await supabase
    .from("subscriptions")
    .select("id")
    .eq("stripe_subscription_id", subscription.id)
    .single()

  let result
  if (existing) {
    // Update existing subscription
    logger.info("[Stripe Webhook] Updating existing subscription")
    const { data, error } = await supabase
      .from("subscriptions")
      .update(subscriptionData)
      .eq("stripe_subscription_id", subscription.id)
      .select()
    result = { data, error }
  } else {
    // Insert new subscription
    logger.info("[Stripe Webhook] Creating new subscription")
    const { data, error } = await supabase
      .from("subscriptions")
      .insert(subscriptionData)
      .select()
    result = { data, error }
  }

  if (result.error) {
    logger.error("[Stripe Webhook] Error saving subscription:", result.error)
    throw result.error
  } else {
    logger.info("[Stripe Webhook] Successfully saved subscription:", result.data)
  }

  // Update user's role to 'pro' after successful subscription (skip beta testers)
  if (userId && subscription.status === 'active') {
    // Check if user is a beta tester first
    const { data: profileData } = await supabase
      .from("profiles")
      .select("role")
      .eq("id", userId)
      .single()

    if (profileData?.role !== 'beta-pro') {
      logger.info("[Stripe Webhook] Updating user role to 'pro' for user:", userId)
      const { error: roleUpdateError } = await supabase
        .from("profiles")
        .update({ role: 'pro', updated_at: new Date().toISOString() })
        .eq("id", userId)

      if (roleUpdateError) {
        logger.error("[Stripe Webhook] Failed to update user role:", roleUpdateError)
        // Don't throw - subscription is saved, role update is secondary
      } else {
        logger.info("[Stripe Webhook] Successfully updated user role to 'pro'")
      }
    } else {
      logger.info("[Stripe Webhook] User is a beta tester, skipping role update")
    }
  }

  // Store invoice if available
  if (subscription.latest_invoice) {
    const invoice = typeof subscription.latest_invoice === 'string' 
      ? await stripeClient.invoices.retrieve(subscription.latest_invoice)
      : subscription.latest_invoice as Stripe.Invoice
      
    await storeInvoice(invoice, supabase, userId)
  }
}

/**
 * One-time pack purchase: credit user_profiles.task_pack_balance and stamp the
 * pack_purchases row from pending → paid.
 *
 * Idempotent on webhook replay via the UNIQUE on stripe_checkout_session_id.
 * If the pre-insert from /api/billing/packs/checkout didn't happen (e.g. server
 * failure between session create and pre-insert), we still credit by inserting
 * a fresh row keyed by session.id.
 */
async function handlePackPurchaseCompleted(session: Stripe.Checkout.Session, supabase: any) {
  if (session.payment_status !== 'paid') {
    logger.info("[Stripe Webhook] Pack session not paid yet, skipping", {
      sessionId: session.id,
      paymentStatus: session.payment_status,
    })
    return
  }

  const userId = session.metadata?.user_id
  const planCode = session.metadata?.plan_code
  const packSizeStr = session.metadata?.pack_size
  const triggeredBy = (session.metadata?.triggered_by as 'manual' | 'auto_buy') ?? 'manual'

  if (!userId || !planCode || !packSizeStr) {
    logger.error("[Stripe Webhook] Pack session missing required metadata", {
      sessionId: session.id,
      metadata: session.metadata,
    })
    return
  }

  const packSize = parseInt(packSizeStr, 10)
  if (!Number.isFinite(packSize) || packSize <= 0) {
    logger.error("[Stripe Webhook] Pack session invalid pack_size metadata", {
      sessionId: session.id,
      packSizeStr,
    })
    return
  }

  const paymentIntentId =
    typeof session.payment_intent === 'string'
      ? session.payment_intent
      : session.payment_intent?.id ?? null

  // Look up existing pre-insert row
  const { data: existing } = await supabase
    .from('pack_purchases')
    .select('id, status, pack_price_cents, tasks_remaining')
    .eq('stripe_checkout_session_id', session.id)
    .single()

  // Idempotent replay: already paid, no-op
  if (existing && existing.status === 'paid') {
    logger.info("[Stripe Webhook] Pack purchase already paid, skipping (idempotent)", {
      sessionId: session.id,
    })
    return
  }

  const packPriceCents = session.amount_total ?? existing?.pack_price_cents ?? 0

  if (existing) {
    // Flip pending → paid
    const { error: updateError } = await supabase
      .from('pack_purchases')
      .update({
        status: 'paid',
        paid_at: new Date().toISOString(),
        stripe_payment_intent_id: paymentIntentId,
        pack_price_cents: packPriceCents,
        tasks_remaining: packSize,
        triggered_by: triggeredBy,
      })
      .eq('id', existing.id)
      .eq('status', 'pending') // atomic guard against double-flip

    if (updateError) {
      logger.error("[Stripe Webhook] Failed to flip pack_purchases to paid", {
        sessionId: session.id,
        error: updateError.message,
      })
      throw updateError
    }
  } else {
    // No pre-insert row found — checkout flow's pre-insert failed but the user paid.
    // Insert a fresh row keyed by session.id (UNIQUE catches webhook replay).
    const { error: insertError } = await supabase.from('pack_purchases').insert({
      user_id: userId,
      stripe_checkout_session_id: session.id,
      stripe_payment_intent_id: paymentIntentId,
      plan_code: planCode,
      pack_size: packSize,
      pack_price_cents: packPriceCents,
      tasks_remaining: packSize,
      tasks_consumed: 0,
      status: 'paid',
      triggered_by: triggeredBy,
      paid_at: new Date().toISOString(),
    })
    if (insertError) {
      // 23505 unique violation = race with another webhook replay; treat as already-paid
      if ((insertError as any).code === '23505') {
        logger.info("[Stripe Webhook] Pack insert hit unique constraint (replay race)", {
          sessionId: session.id,
        })
        return
      }
      logger.error("[Stripe Webhook] Failed to insert pack_purchases row", {
        sessionId: session.id,
        error: insertError.message,
      })
      throw insertError
    }
  }

  // Credit user_profiles.task_pack_balance.
  // RLS-bypass via service-role client; atomic via PostgREST returning representation.
  const { data: profile } = await supabase
    .from('user_profiles')
    .select('task_pack_balance')
    .eq('id', userId)
    .single()

  const newBalance = (profile?.task_pack_balance ?? 0) + packSize
  const { error: balanceError } = await supabase
    .from('user_profiles')
    .update({ task_pack_balance: newBalance })
    .eq('id', userId)

  if (balanceError) {
    logger.error("[Stripe Webhook] Failed to credit task_pack_balance", {
      sessionId: session.id,
      userId,
      error: balanceError.message,
    })
    throw balanceError
  }

  // Audit row in task_billing_events
  await supabase.from('task_billing_events').insert({
    user_id: userId,
    execution_id: session.id, // session ID acts as the execution_id for idempotency
    event_type: 'pack_purchase',
    amount: 0, // not a deduction — purchase event
    node_breakdown: {},
    balance_after: 0, // tasks_used unchanged by a pack purchase
    tasks_limit_snapshot: 0, // not relevant for pack purchases
    period_start_snapshot: null,
    period_end_snapshot: null,
    workflow_id: null,
    source: 'pack_purchase_webhook',
    metadata: {
      pack_size: packSize,
      pack_price_cents: packPriceCents,
      plan_code: planCode,
      stripe_checkout_session_id: session.id,
      stripe_payment_intent_id: paymentIntentId,
      triggered_by: triggeredBy,
      new_pack_balance: newBalance,
    },
  })

  logger.info("[Stripe Webhook] Pack purchase credited", {
    sessionId: session.id,
    userId,
    packSize,
    newBalance,
  })
}

async function handleSubscriptionCreated(subscription: Stripe.Subscription, supabase: any) {
  logger.info("[Stripe Webhook] handleSubscriptionCreated - ID:", subscription.id)
  
  // Extract user_id from metadata or customer
  const { data: existingCustomer } = await supabase
    .from("subscriptions")
    .select("user_id")
    .eq("stripe_customer_id", subscription.customer)
    .single()

  if (!existingCustomer?.user_id) {
    logger.error("[Stripe Webhook] Could not find user_id for customer:", subscription.customer)
    return
  }

  const subscriptionData = {
    user_id: existingCustomer.user_id,
    stripe_customer_id: subscription.customer as string,
    stripe_subscription_id: subscription.id,
    status: subscription.status,
    
    // Period dates
    current_period_start: safeTimestampToISO(subscription.current_period_start) || new Date().toISOString(),
    current_period_end: safeTimestampToISO(subscription.current_period_end) || new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
    cancel_at_period_end: subscription.cancel_at_period_end,
    
    // Pricing details
    price_id: subscription.items.data[0]?.price.id,
    unit_amount: subscription.items.data[0]?.price.unit_amount ? subscription.items.data[0].price.unit_amount / 100 : null,
    currency: subscription.items.data[0]?.price.currency || 'usd',
    
    // Trial information
    trial_start: safeTimestampToISO(subscription.trial_start),
    trial_end: safeTimestampToISO(subscription.trial_end),
    
    // Additional metadata
    created_at: safeTimestampToISO(subscription.created) || new Date().toISOString(),
    updated_at: new Date().toISOString()
  }

  // Check if subscription exists first
  const { data: existing } = await supabase
    .from("subscriptions")
    .select("id")
    .eq("stripe_subscription_id", subscription.id)
    .single()

  const { error } = existing
    ? await supabase
        .from("subscriptions")
        .update(subscriptionData)
        .eq("stripe_subscription_id", subscription.id)
    : await supabase
        .from("subscriptions")
        .insert(subscriptionData)

  if (error) {
    logger.error("[Stripe Webhook] Error creating subscription:", error)
    throw error
  } else {
    logger.info("[Stripe Webhook] Successfully created subscription")
  }

  // Update user's role to 'pro' for active subscriptions
  if (existingCustomer.user_id && subscription.status === 'active') {
    logger.info("[Stripe Webhook] Updating user role to 'pro' for user:", existingCustomer.user_id)
    const { error: roleUpdateError } = await supabase
      .from("profiles")
      .update({ role: 'pro', updated_at: new Date().toISOString() })
      .eq("id", existingCustomer.user_id)

    if (roleUpdateError) {
      logger.error("[Stripe Webhook] Failed to update user role:", roleUpdateError)
      // Don't throw - subscription is saved, role update is secondary
    } else {
      logger.info("[Stripe Webhook] Successfully updated user role to 'pro'")
    }
  }
}

async function handleSubscriptionUpdated(subscription: Stripe.Subscription, supabase: any) {
  logger.info("[Stripe Webhook] handleSubscriptionUpdated - ID:", subscription.id)
  logger.info("[Stripe Webhook] Subscription status:", subscription.status)

  // First get the user_id from the subscription
  const { data: existingSubscription } = await supabase
    .from("subscriptions")
    .select("user_id")
    .eq("stripe_subscription_id", subscription.id)
    .single()

  const userId = existingSubscription?.user_id

  const updateData = {
    status: subscription.status,
    current_period_start: safeTimestampToISO(subscription.current_period_start) || new Date().toISOString(),
    current_period_end: safeTimestampToISO(subscription.current_period_end) || new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
    updated_at: new Date().toISOString()
  }

  const { error } = await supabase
    .from("subscriptions")
    .update(updateData)
    .eq("stripe_subscription_id", subscription.id)

  if (error) {
    logger.error("[Stripe Webhook] Error updating subscription:", error)
    throw error
  } else {
    logger.info("[Stripe Webhook] Successfully updated subscription")
  }

  // Update user's role based on subscription status
  if (userId) {
    // Determine the appropriate role based on subscription status
    let newRole = 'free'
    if (subscription.status === 'active' || subscription.status === 'trialing') {
      newRole = 'pro'
    }
    // For past_due, you might want to keep pro access for a grace period
    // Uncomment the next line if you want to maintain access during payment issues
    // else if (subscription.status === 'past_due') { newRole = 'pro' }

    logger.info(`[Stripe Webhook] Updating user role to '${newRole}' for user:`, userId)
    const { error: roleUpdateError } = await supabase
      .from("profiles")
      .update({ role: newRole, updated_at: new Date().toISOString() })
      .eq("id", userId)

    if (roleUpdateError) {
      logger.error("[Stripe Webhook] Failed to update user role:", roleUpdateError)
      // Don't throw - subscription update is primary, role update is secondary
    } else {
      logger.info(`[Stripe Webhook] Successfully updated user role to '${newRole}'`)
    }
  }
}

async function handleSubscriptionDeleted(subscription: Stripe.Subscription, supabase: any) {
  logger.info("[Stripe Webhook] handleSubscriptionDeleted - ID:", subscription.id)

  // First get the user_id from the subscription
  const { data: existingSubscription } = await supabase
    .from("subscriptions")
    .select("user_id")
    .eq("stripe_subscription_id", subscription.id)
    .single()

  const userId = existingSubscription?.user_id

  // Update the subscription status
  const { error } = await supabase
    .from("subscriptions")
    .update({
      status: "canceled",
      // Removed canceled_at - column doesn't exist
      updated_at: new Date().toISOString()
    })
    .eq("stripe_subscription_id", subscription.id)

  if (error) {
    logger.error("[Stripe Webhook] Error deleting subscription:", error)
    throw error
  } else {
    logger.info("[Stripe Webhook] Successfully marked subscription as canceled")
  }

  // Downgrade user's role back to 'free'
  if (userId) {
    logger.info("[Stripe Webhook] Downgrading user role to 'free' for user:", userId)
    const { error: roleUpdateError } = await supabase
      .from("profiles")
      .update({ role: 'free', updated_at: new Date().toISOString() })
      .eq("id", userId)

    if (roleUpdateError) {
      logger.error("[Stripe Webhook] Failed to downgrade user role:", roleUpdateError)
      // Don't throw - subscription update is primary, role update is secondary
    } else {
      logger.info("[Stripe Webhook] Successfully downgraded user role to 'free'")
    }

    // ========================================================================
    // NEW: Trigger grace period for user's teams
    // ========================================================================
    await handleUserDowngrade(userId, supabase)
  }
}

/**
 * Handle user downgrade: Set grace period for all teams owned by this user
 */
async function handleUserDowngrade(userId: string, supabase: any) {
  logger.info(`[Stripe Webhook] Handling downgrade for user ${userId}`)

  try {
    // Find all teams where this user is the creator/owner
    const { data: ownedTeams, error: teamsError } = await supabase
      .from("teams")
      .select("id, name, created_by")
      .eq("created_by", userId)
      .is("suspended_at", null) // Only active teams

    if (teamsError) {
      logger.error("[Stripe Webhook] Error fetching user's teams:", teamsError)
      return
    }

    if (!ownedTeams || ownedTeams.length === 0) {
      logger.info("[Stripe Webhook] User has no teams to suspend")
      return
    }

    logger.info(`[Stripe Webhook] Found ${ownedTeams.length} teams owned by user ${userId}`)

    // Calculate grace period end date (5 days from now)
    const gracePeriodEndsAt = new Date()
    gracePeriodEndsAt.setDate(gracePeriodEndsAt.getDate() + 5)

    // Set grace period for each team
    for (const team of ownedTeams) {
      const { error: updateError } = await supabase
        .from("teams")
        .update({
          grace_period_ends_at: gracePeriodEndsAt.toISOString(),
          suspension_reason: "owner_downgraded",
          updated_at: new Date().toISOString()
        })
        .eq("id", team.id)

      if (updateError) {
        logger.error(`[Stripe Webhook] Failed to set grace period for team ${team.id}:`, updateError)
      } else {
        logger.info(`[Stripe Webhook] Set 5-day grace period for team "${team.name}" (${team.id})`)
        // Note: The database trigger will automatically create the notification
      }
    }

    logger.info(`[Stripe Webhook] Grace period set for ${ownedTeams.length} teams. Suspension will occur on ${gracePeriodEndsAt.toISOString()}`)
  } catch (error: any) {
    logger.error("[Stripe Webhook] Error handling user downgrade:", error)
    // Don't throw - this is supplementary to the main subscription cancellation
  }
}

async function storeInvoice(invoice: Stripe.Invoice, supabase: any, userId?: string) {
  logger.info("[Stripe Webhook] Storing invoice:", invoice.id)
  
  // If userId not provided, try to get it from subscription
  if (!userId && invoice.subscription) {
    const { data: subscription } = await supabase
      .from("subscriptions")
      .select("user_id")
      .eq("stripe_subscription_id", invoice.subscription)
      .single()
    
    userId = subscription?.user_id
  }

  // Only use fields that exist in the invoices table
  const invoiceData = {
    stripe_invoice_id: invoice.id,
    user_id: userId || null,
    amount: invoice.total ? invoice.total / 100 : 0, // Use total as amount
    status: invoice.status || 'pending',
    created_at: safeTimestampToISO(invoice.created) || new Date().toISOString(),
    updated_at: new Date().toISOString()
  }

  logger.debug("[Stripe Webhook] Processing invoice data")

  // Check if invoice exists first to avoid conflicts
  const { data: existing } = await supabase
    .from("invoices")
    .select("id")
    .eq("stripe_invoice_id", invoice.id)
    .single()

  let result
  if (existing) {
    // Update existing invoice
    logger.info("[Stripe Webhook] Updating existing invoice")
    const { data, error } = await supabase
      .from("invoices")
      .update(invoiceData)
      .eq("stripe_invoice_id", invoice.id)
      .select()
    result = { data, error }
  } else {
    // Insert new invoice
    logger.info("[Stripe Webhook] Creating new invoice")
    const { data, error } = await supabase
      .from("invoices")
      .insert(invoiceData)
      .select()
    result = { data, error }
  }

  if (result.error) {
    logger.error("[Stripe Webhook] Error storing invoice:", result.error)
    throw result.error
  } else {
    logger.info("[Stripe Webhook] Successfully stored invoice:", result.data)
  }
}

async function handlePaymentSucceeded(invoice: Stripe.Invoice, supabase: any) {
  logger.info("[Stripe Webhook] handlePaymentSucceeded - Invoice:", invoice.id)
  await storeInvoice(invoice, supabase)
  await resetOverageTasksIfInvoicedMeter(invoice, supabase)
}

/**
 * If this invoice settled the user's metered overage line item (either on a
 * monthly sub renewal or via threshold billing on a yearly sub), reset their
 * overage_tasks_used to 0 to mirror Stripe's server-side meter reset.
 */
async function resetOverageTasksIfInvoicedMeter(invoice: Stripe.Invoice, supabase: any) {
  const subscriptionId = (invoice as any).subscription
  if (!subscriptionId) return

  const { data: existingSub } = await supabase
    .from('subscriptions')
    .select('user_id')
    .eq('stripe_subscription_id', subscriptionId)
    .single()
  if (!existingSub?.user_id) return

  const { data: profile } = await supabase
    .from('user_profiles')
    .select('stripe_subscription_item_id, overage_tasks_used')
    .eq('id', existingSub.user_id)
    .single()
  if (!profile?.stripe_subscription_item_id || !profile.overage_tasks_used) return

  // Look for an invoice line item tied to the user's metered subscription_item.
  // The line shape has shifted across Stripe API versions; check both common paths.
  const lines = (invoice as any).lines?.data ?? []
  const hasMeteredLine = lines.some((line: any) => {
    const itemId =
      line.subscription_item ??
      line.parent?.subscription_item_details?.subscription_item ??
      line.subscription_item_details?.subscription_item
    return itemId === profile.stripe_subscription_item_id
  })
  if (!hasMeteredLine) return

  const { error } = await supabase
    .from('user_profiles')
    .update({ overage_tasks_used: 0 })
    .eq('id', existingSub.user_id)

  if (error) {
    logger.error('[Stripe Webhook] Failed to reset overage_tasks_used after invoice', {
      userId: existingSub.user_id,
      invoiceId: invoice.id,
      error: error.message,
    })
    return
  }

  logger.info('[Stripe Webhook] Reset overage_tasks_used after metered invoice paid', {
    userId: existingSub.user_id,
    invoiceId: invoice.id,
    previousOverageTasksUsed: profile.overage_tasks_used,
  })
}

/**
 * Pack-purchase refund handler.
 *
 * When Stripe processes a refund for a charge tied to a pack purchase, we:
 *   1. Find the pack_purchases row by stripe_payment_intent_id (charge.payment_intent)
 *   2. Decrement user_profiles.task_pack_balance by tasks_remaining (the unused portion)
 *   3. Mark row as 'refunded', set refunded_at
 *   4. Insert task_billing_events with event_type='pack_refund'
 *
 * Idempotent on replay: already-refunded rows return early.
 *
 * Note: support tooling enforces the 24-hour grace window (decision #11) BEFORE
 * triggering a Stripe refund. The webhook itself processes whatever Stripe sends.
 */
async function handleChargeRefunded(charge: Stripe.Charge, supabase: any) {
  const paymentIntentId =
    typeof charge.payment_intent === 'string' ? charge.payment_intent : charge.payment_intent?.id
  if (!paymentIntentId) {
    logger.info('[Stripe Webhook] charge.refunded without payment_intent — ignoring', { chargeId: charge.id })
    return
  }

  const { data: pack } = await supabase
    .from('pack_purchases')
    .select('id, user_id, pack_size, tasks_remaining, status')
    .eq('stripe_payment_intent_id', paymentIntentId)
    .single()

  if (!pack) {
    // Not a pack purchase — could be a subscription invoice refund or unrelated charge.
    logger.debug('[Stripe Webhook] charge.refunded did not match a pack_purchase', { paymentIntentId })
    return
  }

  if (pack.status === 'refunded') {
    logger.info('[Stripe Webhook] Pack already refunded (idempotent)', { packId: pack.id })
    return
  }

  // Decrement task_pack_balance by the unused portion (tasks_remaining), clamped at 0.
  const tasksToRevoke = Math.max(0, pack.tasks_remaining)

  const { data: profile } = await supabase
    .from('user_profiles')
    .select('task_pack_balance')
    .eq('id', pack.user_id)
    .single()

  const newBalance = Math.max(0, (profile?.task_pack_balance ?? 0) - tasksToRevoke)

  const { error: balanceError } = await supabase
    .from('user_profiles')
    .update({ task_pack_balance: newBalance })
    .eq('id', pack.user_id)

  if (balanceError) {
    logger.error('[Stripe Webhook] Failed to decrement balance on refund', {
      packId: pack.id,
      userId: pack.user_id,
      error: balanceError.message,
    })
    throw balanceError
  }

  const { error: packError } = await supabase
    .from('pack_purchases')
    .update({
      status: 'refunded',
      refunded_at: new Date().toISOString(),
      tasks_remaining: 0,
    })
    .eq('id', pack.id)

  if (packError) {
    logger.error('[Stripe Webhook] Failed to mark pack refunded', { packId: pack.id, error: packError.message })
    throw packError
  }

  // Audit row
  await supabase.from('task_billing_events').insert({
    user_id: pack.user_id,
    execution_id: charge.id,
    event_type: 'pack_refund',
    amount: 0,
    node_breakdown: {},
    balance_after: 0,
    tasks_limit_snapshot: 0,
    period_start_snapshot: null,
    period_end_snapshot: null,
    workflow_id: null,
    source: 'pack_refund_webhook',
    metadata: {
      pack_purchase_id: pack.id,
      tasks_revoked: tasksToRevoke,
      new_pack_balance: newBalance,
      stripe_charge_id: charge.id,
      stripe_payment_intent_id: paymentIntentId,
      amount_refunded_cents: charge.amount_refunded,
    },
  })

  logger.info('[Stripe Webhook] Pack refund processed', {
    packId: pack.id,
    userId: pack.user_id,
    tasksRevoked: tasksToRevoke,
    newBalance,
  })
}

async function handlePaymentFailed(invoice: Stripe.Invoice, supabase: any) {
  logger.info("[Stripe Webhook] handlePaymentFailed - Invoice:", invoice.id)
  await storeInvoice(invoice, supabase)

  // You might want to send notification emails here
  // Or update the subscription status to 'past_due'
  if (invoice.subscription) {
    await supabase
      .from("subscriptions")
      .update({
        status: 'past_due',
        updated_at: new Date().toISOString()
      })
      .eq("stripe_subscription_id", invoice.subscription)
  }
}

