import { ActionResult } from '../index'
import { makeShopifyGraphQLRequest, validateShopifyIntegration } from '@/app/api/integrations/shopify/data/utils'
import { getIntegrationById } from '../../executeNode'
import { resolveValue } from '../core/resolveValue'
import { requireExplicitField } from '../core/requireExplicitField'
import { logger } from '@/lib/utils/logger'
import { extractNumericId, toOrderGid } from './graphqlHelpers'

/**
 * Update Shopify Order Status (GraphQL)
 * Updates an order by fulfilling it, canceling it, adding tags, or adding notes
 */
export async function updateShopifyOrderStatus(
  config: any,
  userId: string,
  input: Record<string, any>
): Promise<ActionResult> {
  try {
    // Q11 — notify_customer triggers a customer-facing email (fulfilled,
    // cancelled, etc.). Customer-notification expectations depend on the
    // status transition, so the previous silent default `false` was both
    // hidden behavior AND a guess. Workflow author must explicitly choose
    // true / false. Runs before integration lookup so a misconfigured
    // workflow fails fast.
    const missingRequired = requireExplicitField(config, 'notify_customer')
    if (missingRequired) return missingRequired as unknown as ActionResult

    // 1. Get and validate integration
    const integrationId = await resolveValue(config.integration_id || config.integrationId, input)
    const integration = await getIntegrationById(integrationId, { userId })
    validateShopifyIntegration(integration)

    // 2. Resolve all config values
    const selectedStore = config.shopify_store ? await resolveValue(config.shopify_store, input) : undefined
    const orderId = await resolveValue(config.order_id, input)
    const action = await resolveValue(config.action, input)
    const tags = (action === 'add_tags' && config.tags) ? await resolveValue(config.tags, input) : undefined
    const note = (action === 'add_note' && config.note) ? await resolveValue(config.note, input) : undefined
    const notifyCustomer = config.notify_customer

    // 3. Convert to GID format
    const orderGid = toOrderGid(orderId)
    const numericId = extractNumericId(orderGid)

    logger.info('[Shopify GraphQL] Updating order status:', { orderId: orderGid, action })

    let result: any
    let statusMessage = ''

    // 4. Perform the requested action
    switch (action) {
      case 'fulfill': {
        // Query for fulfillment orders
        const fulfillmentOrderQuery = `
          query getOrderFulfillmentOrders($id: ID!) {
            order(id: $id) {
              id
              fulfillmentOrders(first: 10) {
                edges {
                  node {
                    id
                    status
                    lineItems(first: 50) {
                      edges {
                        node {
                          id
                          remainingQuantity
                        }
                      }
                    }
                  }
                }
              }
            }
          }
        `

        const orderData = await makeShopifyGraphQLRequest(
          integration,
          fulfillmentOrderQuery,
          { id: orderGid },
          selectedStore
        )

        if (!orderData?.order) {
          throw new Error(`Order not found: ${orderGid}`)
        }

        const fulfillmentOrders = (orderData.order.fulfillmentOrders?.edges || []).map((edge: any) => edge.node)

        if (!fulfillmentOrders || fulfillmentOrders.length === 0) {
          throw new Error('No fulfillment orders found for this order')
        }

        const fulfillmentOrder = fulfillmentOrders.find((fo: any) =>
          fo.status === 'OPEN' || fo.status === 'SCHEDULED'
        ) || fulfillmentOrders[0]

        const fulfillmentOrderLineItems = fulfillmentOrder.lineItems.edges
          .filter((edge: any) => edge.node.remainingQuantity > 0)
          .map((edge: any) => ({
            id: edge.node.id,
            quantity: edge.node.remainingQuantity
          }))

        const fulfillmentMutation = `
          mutation fulfillmentCreateV2($fulfillment: FulfillmentV2Input!) {
            fulfillmentCreateV2(fulfillment: $fulfillment) {
              fulfillment {
                id
                status
                createdAt
              }
              userErrors {
                field
                message
              }
            }
          }
        `

        result = await makeShopifyGraphQLRequest(integration, fulfillmentMutation, {
          fulfillment: {
            lineItemsByFulfillmentOrder: [
              {
                fulfillmentOrderId: fulfillmentOrder.id,
                fulfillmentOrderLineItems
              }
            ],
            notifyCustomer
          }
        }, selectedStore)

        statusMessage = 'fulfilled'
        break
      }

      case 'cancel': {
        const cancelMutation = `
          mutation orderCancel($orderId: ID!, $notifyCustomer: Boolean, $reason: OrderCancelReason!, $refund: Boolean!, $restock: Boolean!) {
            orderCancel(orderId: $orderId, notifyCustomer: $notifyCustomer, reason: $reason, refund: $refund, restock: $restock) {
              orderCancelUserErrors {
                field
                message
              }
            }
          }
        `

        result = await makeShopifyGraphQLRequest(integration, cancelMutation, {
          orderId: orderGid,
          notifyCustomer,
          reason: 'OTHER',
          refund: false, // Don't automatically refund
          restock: true  // Restock items by default
        }, selectedStore)

        statusMessage = 'cancelled'
        break
      }

      case 'add_tags': {
        if (!tags) {
          throw new Error('Tags are required for add_tags action')
        }

        // Get existing tags
        const orderQuery = `
          query getOrder($id: ID!) {
            order(id: $id) {
              id
              tags
            }
          }
        `

        const orderData = await makeShopifyGraphQLRequest(integration, orderQuery, { id: orderGid }, selectedStore)

        if (!orderData?.order) {
          throw new Error(`Order not found: ${orderGid}`)
        }

        const existingTags = orderData.order.tags || []
        const newTagsArray = tags.split(',').map((t: string) => t.trim())
        const mergedTags = [...new Set([...existingTags, ...newTagsArray])]

        const updateMutation = `
          mutation orderUpdate($input: OrderInput!) {
            orderUpdate(input: $input) {
              order {
                id
                tags
              }
              userErrors {
                field
                message
              }
            }
          }
        `

        result = await makeShopifyGraphQLRequest(integration, updateMutation, {
          input: {
            id: orderGid,
            tags: mergedTags
          }
        }, selectedStore)

        statusMessage = 'tags added'
        break
      }

      case 'add_note': {
        if (!note) {
          throw new Error('Note is required for add_note action')
        }

        // Get existing note
        const orderQuery = `
          query getOrder($id: ID!) {
            order(id: $id) {
              id
              note
            }
          }
        `

        const orderData = await makeShopifyGraphQLRequest(integration, orderQuery, { id: orderGid }, selectedStore)

        if (!orderData?.order) {
          throw new Error(`Order not found: ${orderGid}`)
        }

        const existingNote = orderData.order.note || ''
        const updatedNote = existingNote ? `${existingNote}\n\n${note}` : note

        const updateMutation = `
          mutation orderUpdate($input: OrderInput!) {
            orderUpdate(input: $input) {
              order {
                id
                note
              }
              userErrors {
                field
                message
              }
            }
          }
        `

        result = await makeShopifyGraphQLRequest(integration, updateMutation, {
          input: {
            id: orderGid,
            note: updatedNote
          }
        }, selectedStore)

        statusMessage = 'note added'
        break
      }

      default:
        throw new Error(`Unknown action: ${action}`)
    }

    return {
      success: true,
      output: {
        success: true,
        order_id: numericId,
        order_gid: orderGid,
        status: statusMessage,
        updated_at: new Date().toISOString()
      },
      message: `Order ${statusMessage} successfully`
    }
  } catch (error: any) {
    logger.error('[Shopify GraphQL] Update order status error:', error)
    return {
      success: false,
      output: { success: false },
      message: error.message || 'Failed to update order status'
    }
  }
}
