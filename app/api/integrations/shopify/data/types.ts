/**
 * Shopify Data API Types
 */

export interface ShopifyStore {
  shop: string // Shop domain (e.g., "store.myshopify.com")
  name: string // Display name
  id: string // Shopify shop ID
}

export interface ShopifyIntegration {
  id: string
  user_id: string
  provider: string
  status: 'connected' | 'disconnected' | 'error'
  access_token: string
  shop_domain?: string // Canonical single-store domain — written by the OAuth callback
  metadata?: {
    // Forward-compat multi-store fields. No writer populates these yet;
    // adding multi-store support requires the OAuth callback to fan out
    // shop list + active selection here.
    stores?: ShopifyStore[]
    active_store?: string
    // Test-fixture single-store key — see __tests__/helpers/actionTestHarness.ts.
    shop?: string
  }
  created_at: string
  updated_at: string
}

export interface ShopifyCollection {
  id: string
  title: string
  handle: string
  products_count?: number
}

export interface ShopifyLocation {
  id: string
  name: string
  address1?: string
  city?: string
  active: boolean
}

export interface ShopifyProduct {
  id: string
  title: string
  vendor?: string
  product_type?: string
  status: string
  variants?: ShopifyVariant[] // Array of variants for this product
  options?: Array<{ id: string; name: string; position: number; values: string[] }> // Product options for variant creation
}

export interface ShopifyVariant {
  id: string
  value: string
  label: string
  product_id: string
  title: string
  price: string
  sku?: string
  inventory_quantity?: number
  available: boolean
}

export interface ShopifyCustomer {
  id: string
  email: string
  first_name?: string
  last_name?: string
  orders_count: number
  total_spent: string
}

export interface ShopifyApiError extends Error {
  status?: number
  code?: string
}

export type ShopifyDataHandler<T = any> = (
  integration: ShopifyIntegration,
  options?: any
) => Promise<T>
