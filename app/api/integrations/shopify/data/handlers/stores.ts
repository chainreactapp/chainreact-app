/**
 * Shopify Stores Handler
 * Returns list of connected Shopify stores from integration metadata
 */

import { ShopifyIntegration, ShopifyStore, ShopifyDataHandler } from '../types'
import { logger } from '@/lib/utils/logger'

export const getShopifyStores: ShopifyDataHandler<ShopifyStore[]> = async (
  integration: ShopifyIntegration
): Promise<ShopifyStore[]> => {
  try {
    const metadata = integration.metadata as any

    // Get stores from metadata
    const stores = metadata?.stores || []

    // No multi-store metadata yet — fall back to the single-store domain
    // written by the OAuth callback (or the test-fixture metadata.shop key).
    if (stores.length === 0) {
      const singleShop = metadata?.shop || integration.shop_domain
      if (singleShop) {
        logger.info('[Shopify] Using single-store domain (no multi-store metadata)')
        return [{
          shop: singleShop,
          name: singleShop,
          id: singleShop,
          value: singleShop,
          label: singleShop
        }]
      }
    }

    // Map stores to include value/label for select fields
    // IMPORTANT: Use 'shop' (domain) as the value, not numeric 'id'
    const mappedStores = stores.map((store: any) => ({
      ...store,
      value: store.shop, // The shop domain (e.g., "mystore.myshopify.com")
      label: store.name || store.shop, // Display name or fallback to domain
      id: store.id // Keep the numeric ID for reference
    }))

    logger.info(`✅ [Shopify] Returning ${mappedStores.length} connected stores`)
    return mappedStores

  } catch (error: any) {
    logger.error('❌ [Shopify] Error fetching stores:', error)
    throw new Error(error.message || 'Error fetching Shopify stores')
  }
}
