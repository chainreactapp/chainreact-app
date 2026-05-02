import { ShoppingBag, Package, Users, TrendingUp, FileText, AlertCircle, DollarSign, CheckCircle, ShoppingCart } from "lucide-react"
import { NodeComponent } from "../../types"

/**
 * Shopify Integration
 *
 * Triggers:
 * - New Order
 * - New Paid Order
 * - Order Fulfilled
 * - New Abandoned Cart
 * - Order Updated
 * - New Customer
 * - Product Updated
 * - Inventory Level Low
 *
 * Actions:
 * - Create Order
 * - Update Order Status
 * - Create Product
 * - Update Product
 * - Update Inventory
 * - Create Customer
 * - Update Customer
 * - Add Order Note
 * - Create Fulfillment
 * - Create Product Variant
 * - Update Product Variant
 */

// Store selector field - shown first in all Shopify nodes for multi-store support
const STORE_SELECTOR_FIELD = {
  name: "shopify_store",
  label: "Shopify Store",
  type: "select" as const,
  dynamic: "shopify_stores",
  required: true,
  loadOnMount: true,
  supportsAI: true,
  placeholder: "Select a store...",
  description: "Select which Shopify store to use for this action/trigger",
  connectButton: true
}

export const shopifyNodes: NodeComponent[] = [
  // ============================================================================
  // TRIGGERS
  // ============================================================================
  {
    type: "shopify_trigger_new_order",
    title: "New Order",
    description: "Triggers when a new order is created in your Shopify store",
    icon: ShoppingBag,
    providerId: "shopify",
    category: "E-commerce",
    isTrigger: true,
    producesOutput: true,
    requiredScopes: ["read_orders"],
    configSchema: [
      STORE_SELECTOR_FIELD,
      {
        name: "fulfillment_status",
        label: "Fulfillment Status Filter (Optional)",
        type: "select",
        required: false,
        dependsOn: "shopify_store",
        hidden: {
          $deps: ["shopify_store"],
          $condition: { shopify_store: { $exists: false } }
        },
        options: [
          { label: "Any Status", value: "any" },
          { label: "Fulfilled", value: "fulfilled" },
          { label: "Unfulfilled", value: "unfulfilled" },
          { label: "Partially Fulfilled", value: "partial" },
        ],
        defaultValue: "any",
        description: "Only trigger for orders with this fulfillment status",
        connectButton: true
      },
      {
        name: "financial_status",
        label: "Payment Status Filter (Optional)",
        type: "select",
        required: false,
        dependsOn: "shopify_store",
        hidden: {
          $deps: ["shopify_store"],
          $condition: { shopify_store: { $exists: false } }
        },
        options: [
          { label: "Any Status", value: "any" },
          { label: "Paid", value: "paid" },
          { label: "Pending", value: "pending" },
          { label: "Authorized", value: "authorized" },
          { label: "Refunded", value: "refunded" },
        ],
        defaultValue: "any",
        description: "Only trigger for orders with this payment status",
        connectButton: true
      },
    ],
    outputSchema: [
      { name: "order_id", label: "Order ID", type: "string", description: "Unique identifier for the order" },
      { name: "order_number", label: "Order Number", type: "number", description: "Human-readable order number" },
      { name: "customer_email", label: "Customer Email", type: "string", description: "Email address of the customer" },
      { name: "customer_name", label: "Customer Name", type: "string", description: "Full name of the customer" },
      { name: "total_price", label: "Total Price", type: "number", description: "Total price of the order" },
      { name: "currency", label: "Currency", type: "string", description: "Currency code (e.g., USD, EUR)" },
      { name: "fulfillment_status", label: "Fulfillment Status", type: "string", description: "Current fulfillment status" },
      { name: "financial_status", label: "Payment Status", type: "string", description: "Current payment status" },
      { name: "line_items", label: "Line Items", type: "array", description: "Array of products in the order" },
      { name: "created_at", label: "Created At", type: "string", description: "When the order was created (ISO 8601)" },
    ],
  },
  {
    type: "shopify_trigger_new_paid_order",
    title: "New Paid Order",
    description: "Triggers when a new order is created with payment confirmed",
    icon: DollarSign,
    providerId: "shopify",
    category: "E-commerce",
    isTrigger: true,
    producesOutput: true,
    requiredScopes: ["read_orders"],
    configSchema: [
      STORE_SELECTOR_FIELD,
      {
        name: "fulfillment_status",
        label: "Fulfillment Status Filter (Optional)",
        type: "select",
        required: false,
        dependsOn: "shopify_store",
        hidden: {
          $deps: ["shopify_store"],
          $condition: { shopify_store: { $exists: false } }
        },
        options: [
          { label: "Any Status", value: "any" },
          { label: "Fulfilled", value: "fulfilled" },
          { label: "Unfulfilled", value: "unfulfilled" },
          { label: "Partially Fulfilled", value: "partial" },
        ],
        defaultValue: "any",
        description: "Only trigger for orders with this fulfillment status",
        connectButton: true
      },
    ],
    outputSchema: [
      { name: "order_id", label: "Order ID", type: "string", description: "Unique identifier for the order" },
      { name: "order_number", label: "Order Number", type: "number", description: "Human-readable order number" },
      { name: "customer_email", label: "Customer Email", type: "string", description: "Email address of the customer" },
      { name: "customer_name", label: "Customer Name", type: "string", description: "Full name of the customer" },
      { name: "total_price", label: "Total Price", type: "number", description: "Total price of the order" },
      { name: "currency", label: "Currency", type: "string", description: "Currency code (e.g., USD, EUR)" },
      { name: "fulfillment_status", label: "Fulfillment Status", type: "string", description: "Current fulfillment status" },
      { name: "financial_status", label: "Payment Status", type: "string", description: "Will always be 'paid' for this trigger" },
      { name: "line_items", label: "Line Items", type: "array", description: "Array of products in the order" },
      { name: "shipping_address", label: "Shipping Address", type: "object", description: "Customer's shipping address" },
      { name: "billing_address", label: "Billing Address", type: "object", description: "Customer's billing address" },
      { name: "created_at", label: "Created At", type: "string", description: "When the order was created (ISO 8601)" },
    ],
  },
  {
    type: "shopify_trigger_order_fulfilled",
    title: "Order Fulfilled",
    description: "Triggers when an order is completely fulfilled",
    icon: CheckCircle,
    providerId: "shopify",
    category: "E-commerce",
    isTrigger: true,
    producesOutput: true,
    requiredScopes: ["read_orders"],
    configSchema: [
      STORE_SELECTOR_FIELD,
      {
        name: "notificationOnly",
        label: "Trigger Configuration",
        type: "select",
        required: false,
        dependsOn: "shopify_store",
        hidden: {
          $deps: ["shopify_store"],
          $condition: { shopify_store: { $exists: false } }
        },
        options: [{ value: "all", label: "Trigger for all fulfilled orders" }],
        defaultValue: "all",
        description: "This trigger will fire whenever an order's fulfillment status changes to fulfilled",
        connectButton: true
      }
    ],
    outputSchema: [
      { name: "order_id", label: "Order ID", type: "string", description: "Unique identifier for the order" },
      { name: "order_number", label: "Order Number", type: "number", description: "Human-readable order number" },
      { name: "customer_email", label: "Customer Email", type: "string", description: "Email address of the customer" },
      { name: "customer_name", label: "Customer Name", type: "string", description: "Full name of the customer" },
      { name: "total_price", label: "Total Price", type: "number", description: "Total price of the order" },
      { name: "currency", label: "Currency", type: "string", description: "Currency code (e.g., USD, EUR)" },
      { name: "fulfillment_status", label: "Fulfillment Status", type: "string", description: "Will always be 'fulfilled' for this trigger" },
      { name: "financial_status", label: "Payment Status", type: "string", description: "Current payment status" },
      { name: "line_items", label: "Line Items", type: "array", description: "Array of products in the order" },
      { name: "tracking_number", label: "Tracking Number", type: "string", description: "Shipping tracking number (if available)" },
      { name: "tracking_url", label: "Tracking URL", type: "string", description: "Shipping tracking URL (if available)" },
      { name: "fulfilled_at", label: "Fulfilled At", type: "string", description: "When the order was fulfilled (ISO 8601)" },
    ],
  },
  {
    type: "shopify_trigger_abandoned_cart",
    title: "New Abandoned Cart",
    description: "Triggers when a customer abandons their shopping cart",
    icon: ShoppingCart,
    providerId: "shopify",
    category: "E-commerce",
    isTrigger: true,
    producesOutput: true,
    requiredScopes: ["read_checkouts"],
    configSchema: [
      STORE_SELECTOR_FIELD,
      {
        name: "minimum_value",
        label: "Minimum Cart Value (Optional)",
        type: "number",
        required: false,
        dependsOn: "shopify_store",
        hidden: {
          $deps: ["shopify_store"],
          $condition: { shopify_store: { $exists: false } }
        },
        placeholder: "50.00",
        description: "Only trigger for carts above this value (e.g., 50.00)",
        connectButton: true
      },
    ],
    outputSchema: [
      { name: "checkout_id", label: "Checkout ID", type: "string", description: "Unique identifier for the abandoned checkout" },
      { name: "cart_token", label: "Cart Token", type: "string", description: "Token to recover the cart" },
      { name: "customer_email", label: "Customer Email", type: "string", description: "Email address of the customer" },
      { name: "customer_name", label: "Customer Name", type: "string", description: "Full name of the customer (if available)" },
      { name: "total_price", label: "Total Price", type: "number", description: "Total value of the abandoned cart" },
      { name: "currency", label: "Currency", type: "string", description: "Currency code (e.g., USD, EUR)" },
      { name: "line_items", label: "Line Items", type: "array", description: "Array of products in the cart" },
      { name: "abandoned_checkout_url", label: "Recovery URL", type: "string", description: "URL to recover the abandoned cart" },
      { name: "created_at", label: "Created At", type: "string", description: "When the cart was created (ISO 8601)" },
      { name: "updated_at", label: "Updated At", type: "string", description: "When the cart was last updated (ISO 8601)" },
    ],
  },
  {
    type: "shopify_trigger_order_updated",
    title: "Order Updated",
    description: "Triggers when an existing order is updated",
    icon: FileText,
    providerId: "shopify",
    category: "E-commerce",
    isTrigger: true,
    producesOutput: true,
    requiredScopes: ["read_orders"],
    configSchema: [
      STORE_SELECTOR_FIELD,
      {
        name: "watch_field",
        label: "Watch For Changes In",
        type: "multi_select",
        required: false,
        dependsOn: "shopify_store",
        hidden: {
          $deps: ["shopify_store"],
          $condition: { shopify_store: { $exists: false } }
        },
        options: [
          { label: "Fulfillment Status", value: "fulfillment_status" },
          { label: "Payment Status", value: "financial_status" },
          { label: "Tags", value: "tags" },
          { label: "Notes", value: "note" },
        ],
        description: "Only trigger when these fields change (leave empty to trigger on any change)",
        supportsAI: true,
        connectButton: true
      },
    ],
    outputSchema: [
      { name: "order_id", label: "Order ID", type: "string", description: "Unique identifier for the order" },
      { name: "order_number", label: "Order Number", type: "number", description: "Human-readable order number" },
      { name: "customer_email", label: "Customer Email", type: "string", description: "Email address of the customer" },
      { name: "fulfillment_status", label: "Fulfillment Status", type: "string", description: "Current fulfillment status" },
      { name: "financial_status", label: "Payment Status", type: "string", description: "Current payment status" },
      { name: "tags", label: "Tags", type: "string", description: "Tags associated with the order" },
      { name: "updated_at", label: "Updated At", type: "string", description: "When the order was last updated (ISO 8601)" },
    ],
  },
  {
    type: "shopify_trigger_new_customer",
    title: "New Customer",
    description: "Triggers when a new customer is created",
    icon: Users,
    providerId: "shopify",
    category: "E-commerce",
    isTrigger: true,
    producesOutput: true,
    requiredScopes: ["read_customers"],
    configSchema: [
      STORE_SELECTOR_FIELD,
      {
        name: "notificationOnly",
        label: "Trigger Configuration",
        type: "select",
        required: false,
        dependsOn: "shopify_store",
        hidden: {
          $deps: ["shopify_store"],
          $condition: { shopify_store: { $exists: false } }
        },
        options: [{ value: "all", label: "Trigger for all new customers" }],
        defaultValue: "all",
        description: "This trigger will fire whenever a new customer is created in your Shopify store",
        connectButton: true
      }
    ],
    outputSchema: [
      { name: "customer_id", label: "Customer ID", type: "string", description: "Unique identifier for the customer" },
      { name: "email", label: "Email", type: "string", description: "Customer's email address" },
      { name: "first_name", label: "First Name", type: "string", description: "Customer's first name" },
      { name: "last_name", label: "Last Name", type: "string", description: "Customer's last name" },
      { name: "phone", label: "Phone", type: "string", description: "Customer's phone number" },
      { name: "orders_count", label: "Orders Count", type: "number", description: "Total number of orders placed" },
      { name: "total_spent", label: "Total Spent", type: "number", description: "Total amount spent by customer" },
      { name: "created_at", label: "Created At", type: "string", description: "When the customer was created (ISO 8601)" },
    ],
  },
  {
    type: "shopify_trigger_product_updated",
    title: "Product Updated",
    description: "Triggers when a product is created or updated",
    icon: Package,
    providerId: "shopify",
    category: "E-commerce",
    isTrigger: true,
    producesOutput: true,
    requiredScopes: ["read_products"],
    configSchema: [
      STORE_SELECTOR_FIELD,
      {
        name: "collection_id",
        label: "Collection Filter (Optional)",
        type: "select",
        dynamic: "shopify_collections",
        required: false,
        dependsOn: "shopify_store",
        hidden: {
          $deps: ["shopify_store"],
          $condition: { shopify_store: { $exists: false } }
        },
        loadOnMount: true,
        placeholder: "All collections",
        description: "Only trigger for products in this collection",
        connectButton: true
      },
    ],
    outputSchema: [
      { name: "product_id", label: "Product ID", type: "string", description: "Unique identifier for the updated product" },
      { name: "title", label: "Title", type: "string", description: "The updated title of the product" },
      { name: "vendor", label: "Vendor", type: "string", description: "The vendor/brand of the product" },
      { name: "product_type", label: "Product Type", type: "string", description: "The type/category of the product" },
      { name: "status", label: "Status", type: "string", description: "Current status of the product (active, draft, archived)" },
      { name: "variants", label: "Variants", type: "array", description: "Array of product variants with pricing and inventory data" },
      { name: "updated_at", label: "Updated At", type: "string", description: "Timestamp when the product was last updated (ISO 8601)" },
    ],
  },
  {
    type: "shopify_trigger_inventory_low",
    title: "Inventory Level Low",
    description: "Triggers when product inventory falls below a threshold",
    icon: AlertCircle,
    providerId: "shopify",
    category: "E-commerce",
    isTrigger: true,
    producesOutput: true,
    requiredScopes: ["read_inventory"],
    configSchema: [
      STORE_SELECTOR_FIELD,
      {
        name: "threshold",
        label: "Low Stock Threshold",
        type: "number",
        required: true,
        dependsOn: "shopify_store",
        hidden: {
          $deps: ["shopify_store"],
          $condition: { shopify_store: { $exists: false } }
        },
        defaultValue: 10,
        placeholder: "10",
        description: "Trigger when inventory falls below this number",
        connectButton: true
      },
      {
        name: "location_id",
        label: "Location (Optional)",
        type: "select",
        dynamic: "shopify_locations",
        required: false,
        dependsOn: "shopify_store",
        hidden: {
          $deps: ["shopify_store"],
          $condition: { shopify_store: { $exists: false } }
        },
        loadOnMount: true,
        placeholder: "All locations",
        description: "Only check inventory at this location",
        connectButton: true
      },
    ],
    outputSchema: [
      { name: "inventory_item_id", label: "Inventory Item ID", type: "string", description: "Unique identifier for the inventory item" },
      { name: "location_id", label: "Location ID", type: "string", description: "The location where inventory changed" },
      { name: "quantity", label: "Current Quantity", type: "number", description: "Current available inventory quantity that fell below threshold" },
      { name: "updated_at", label: "Updated At", type: "string", description: "When the inventory was updated (ISO 8601)" },
    ],
  },

  // ============================================================================
  // ACTIONS
  // ============================================================================
  {
    type: "shopify_action_create_order",
    title: "Create Order",
    description: "Create a new order in Shopify",
    icon: ShoppingBag,
    providerId: "shopify",
    category: "E-commerce",
    isTrigger: false,
    producesOutput: true,
    testable: true,
    requiredScopes: ["write_orders"],
    configSchema: [
      STORE_SELECTOR_FIELD,
      {
        name: "customer_email",
        label: "Customer Email",
        type: "text",
        required: true,
        dependsOn: "shopify_store",
        hidden: {
          $deps: ["shopify_store"],
          $condition: { shopify_store: { $exists: false } }
        },
        placeholder: "customer@example.com",
        description: "Email address of the customer",
        supportsAI: true,
        connectButton: true
      },
      {
        name: "line_items",
        dependsOn: "shopify_store",
        hidden: {
          $deps: ["shopify_store"],
          $condition: { shopify_store: { $exists: false } }
        },
        label: "Line Items",
        type: "shopify_line_items",
        dynamic: "shopify_products", // Triggers product loading
        loadOnMount: true, // Load products when store is selected
        required: true,
        description: "Products to include in the order",
        supportsAI: true,
        connectButton: true
      },
      {
        name: "send_receipt",
        dependsOn: "shopify_store",
        hidden: {
          $deps: ["shopify_store"],
          $condition: { shopify_store: { $exists: false } }
        },
        label: "Send Order Confirmation Email",
        type: "boolean",
        required: false,
        defaultValue: true,
        description: "Send order confirmation email to customer",
        connectButton: true
      },
      {
        name: "note",
        dependsOn: "shopify_store",
        hidden: {
          $deps: ["shopify_store"],
          $condition: { shopify_store: { $exists: false } }
        },
        label: "Order Note (Optional)",
        type: "text",
        required: false,
        placeholder: "Special instructions...",
        description: "Internal note for the order",
        supportsAI: true,
        connectButton: true
      },
      {
        name: "tags",
        dependsOn: "shopify_store",
        hidden: {
          $deps: ["shopify_store"],
          $condition: { shopify_store: { $exists: false } }
        },
        label: "Tags (Optional)",
        type: "text",
        required: false,
        placeholder: "wholesale, priority",
        description: "Comma-separated tags for the order",
        supportsAI: true,
        connectButton: true
      },
      {
        name: "shipping_address_line1",
        dependsOn: "shopify_store",
        hidden: {
          $deps: ["shopify_store"],
          $condition: { shopify_store: { $exists: false } }
        },
        label: "Shipping Address Line 1 (Optional)",
        type: "text",
        required: false,
        placeholder: "123 Main St",
        description: "Street address for shipping",
        supportsAI: true,
        connectButton: true
      },
      {
        name: "shipping_address_line2",
        dependsOn: "shopify_store",
        hidden: {
          $deps: ["shopify_store"],
          $condition: { shopify_store: { $exists: false } }
        },
        label: "Shipping Address Line 2 (Optional)",
        type: "text",
        required: false,
        placeholder: "Apt 4B",
        description: "Additional address details (apartment, suite, etc.)",
        supportsAI: true,
        connectButton: true
      },
      {
        name: "shipping_city",
        dependsOn: "shopify_store",
        hidden: {
          $deps: ["shopify_store"],
          $condition: { shopify_store: { $exists: false } }
        },
        label: "Shipping City (Optional)",
        type: "text",
        required: false,
        placeholder: "San Francisco",
        description: "City for shipping address",
        supportsAI: true,
        connectButton: true
      },
      {
        name: "shipping_province",
        dependsOn: "shopify_store",
        hidden: {
          $deps: ["shopify_store"],
          $condition: { shopify_store: { $exists: false } }
        },
        label: "Shipping State/Province (Optional)",
        type: "text",
        required: false,
        placeholder: "CA",
        description: "State or province code (e.g., CA, NY, ON)",
        supportsAI: true,
        connectButton: true
      },
      {
        name: "shipping_country",
        dependsOn: "shopify_store",
        hidden: {
          $deps: ["shopify_store"],
          $condition: { shopify_store: { $exists: false } }
        },
        label: "Shipping Country (Optional)",
        type: "text",
        required: false,
        placeholder: "US",
        description: "Country code (e.g., US, CA, GB)",
        supportsAI: true,
        connectButton: true
      },
      {
        name: "shipping_zip",
        dependsOn: "shopify_store",
        hidden: {
          $deps: ["shopify_store"],
          $condition: { shopify_store: { $exists: false } }
        },
        label: "Shipping ZIP/Postal Code (Optional)",
        type: "text",
        required: false,
        placeholder: "94102",
        description: "ZIP or postal code",
        supportsAI: true,
        connectButton: true
      },
      {
        name: "billing_address_line1",
        dependsOn: "shopify_store",
        hidden: {
          $deps: ["shopify_store"],
          $condition: { shopify_store: { $exists: false } }
        },
        label: "Billing Address Line 1 (Optional)",
        type: "text",
        required: false,
        placeholder: "456 Oak Ave",
        description: "Street address for billing (defaults to shipping if empty)",
        supportsAI: true,
        connectButton: true
      },
      {
        name: "billing_address_line2",
        dependsOn: "shopify_store",
        hidden: {
          $deps: ["shopify_store"],
          $condition: { shopify_store: { $exists: false } }
        },
        label: "Billing Address Line 2 (Optional)",
        type: "text",
        required: false,
        placeholder: "Suite 100",
        description: "Additional billing address details",
        supportsAI: true,
        connectButton: true
      },
      {
        name: "billing_city",
        dependsOn: "shopify_store",
        hidden: {
          $deps: ["shopify_store"],
          $condition: { shopify_store: { $exists: false } }
        },
        label: "Billing City (Optional)",
        type: "text",
        required: false,
        placeholder: "Los Angeles",
        description: "City for billing address",
        supportsAI: true,
        connectButton: true
      },
      {
        name: "billing_province",
        dependsOn: "shopify_store",
        hidden: {
          $deps: ["shopify_store"],
          $condition: { shopify_store: { $exists: false } }
        },
        label: "Billing State/Province (Optional)",
        type: "text",
        required: false,
        placeholder: "CA",
        description: "State or province code for billing",
        supportsAI: true,
        connectButton: true
      },
      {
        name: "billing_country",
        dependsOn: "shopify_store",
        hidden: {
          $deps: ["shopify_store"],
          $condition: { shopify_store: { $exists: false } }
        },
        label: "Billing Country (Optional)",
        type: "text",
        required: false,
        placeholder: "US",
        description: "Country code for billing",
        supportsAI: true,
        connectButton: true
      },
      {
        name: "billing_zip",
        dependsOn: "shopify_store",
        hidden: {
          $deps: ["shopify_store"],
          $condition: { shopify_store: { $exists: false } }
        },
        label: "Billing ZIP/Postal Code (Optional)",
        type: "text",
        required: false,
        placeholder: "90001",
        description: "ZIP or postal code for billing",
        supportsAI: true,
        connectButton: true
      },
    ],
    outputSchema: [
      {
        name: "order_id",
        label: "Order ID",
        type: "string",
        description: "The unique identifier for the created order",
        example: "gid://shopify/Order/1234567890"
      },
      {
        name: "order_number",
        label: "Order Number",
        type: "number",
        description: "The order number displayed in Shopify admin",
        example: 1001
      },
      {
        name: "total_price",
        label: "Total Price",
        type: "number",
        description: "The total price of the order including taxes and shipping",
        example: 129.99
      },
      {
        name: "admin_url",
        label: "Admin URL",
        type: "string",
        description: "Direct link to view the order in Shopify admin",
        example: "https://mystore.myshopify.com/admin/orders/1234567890"
      },
      {
        name: "created_at",
        label: "Created At",
        type: "string",
        description: "ISO 8601 timestamp when the order was created",
        example: "2024-01-15T10:30:00Z"
      },
    ],
  },
  {
    type: "shopify_action_update_order_status",
    title: "Update Order Status",
    description: "Update the fulfillment or payment status of an order",
    icon: TrendingUp,
    providerId: "shopify",
    category: "E-commerce",
    isTrigger: false,
    producesOutput: true,
    testable: true,
    requiredScopes: ["write_orders", "write_fulfillments"],
    configSchema: [
      STORE_SELECTOR_FIELD,
      {
        name: "order_id",
        dependsOn: "shopify_store",
        hidden: {
          $deps: ["shopify_store"],
          $condition: { shopify_store: { $exists: false } }
        },
        label: "Order",
        type: "select",
        dynamic: "shopify_orders",
        required: true,
        loadOnMount: true,
        placeholder: "Select an order...",
        description: "Select the order to update",
        supportsAI: true,
        connectButton: true
      },
      {
        name: "action",
        dependsOn: "shopify_store",
        hidden: {
          $deps: ["shopify_store"],
          $condition: { shopify_store: { $exists: false } }
        },
        label: "Action",
        type: "select",
        required: true,
        options: [
          { label: "Fulfill Order", value: "fulfill" },
          { label: "Cancel Order", value: "cancel" },
          { label: "Add Tags", value: "add_tags" },
          { label: "Add Note", value: "add_note" },
        ],
        description: "What action to perform on the order",
        connectButton: true
      },
      {
        name: "tags",
        dependsOn: "action",
        hidden: {
          $deps: ["action"],
          $condition: { action: { $ne: "add_tags" } }
        },
        label: "Tags",
        type: "text",
        required: false,
        placeholder: "urgent, priority",
        description: "Comma-separated tags to add to the order",
        supportsAI: true,
        connectButton: true
      },
      {
        name: "note",
        dependsOn: "action",
        hidden: {
          $deps: ["action"],
          $condition: { action: { $ne: "add_note" } }
        },
        label: "Note",
        type: "textarea",
        required: false,
        placeholder: "Customer requested expedited shipping",
        description: "Note to add to the order",
        supportsAI: true,
        connectButton: true
      },
      {
        name: "notify_customer",
        dependsOn: "shopify_store",
        hidden: {
          $deps: ["shopify_store"],
          $condition: { shopify_store: { $exists: false } }
        },
        label: "Notify Customer",
        type: "boolean",
        required: true,
        description: "Required (Q11) — customer-notification expectation depends on the status transition (fulfilled, cancelled, etc.). Workflow author must explicitly choose true / false.",
        connectButton: true
      },
    ],
    outputSchema: [
      {
        name: "success",
        label: "Success",
        type: "boolean",
        description: "Whether the order status update was successful",
        example: true
      },
      {
        name: "order_id",
        label: "Order ID",
        type: "string",
        description: "The unique identifier for the order that was updated",
        example: "gid://shopify/Order/1234567890"
      },
      {
        name: "status",
        label: "New Status",
        type: "string",
        description: "The new status of the order after the update",
        example: "fulfilled"
      },
      {
        name: "updated_at",
        label: "Updated At",
        type: "string",
        description: "ISO 8601 timestamp when the order was last updated",
        example: "2024-01-15T10:30:00Z"
      },
    ],
  },
  {
    type: "shopify_action_create_product",
    title: "Create Product",
    description: "Create a new product in Shopify",
    icon: Package,
    providerId: "shopify",
    category: "E-commerce",
    isTrigger: false,
    producesOutput: true,
    testable: true,
    requiredScopes: ["write_products"],
    configSchema: [
      STORE_SELECTOR_FIELD,
      {
        name: "title",
        dependsOn: "shopify_store",
        hidden: {
          $deps: ["shopify_store"],
          $condition: { shopify_store: { $exists: false } }
        },
        label: "Product Title",
        type: "text",
        required: true,
        placeholder: "Amazing Product",
        description: "The name of the product",
        supportsAI: true,
        connectButton: true
      },
      {
        name: "body_html",
        dependsOn: "shopify_store",
        hidden: {
          $deps: ["shopify_store"],
          $condition: { shopify_store: { $exists: false } }
        },
        label: "Description",
        type: "textarea",
        required: false,
        placeholder: "Product description...",
        description: "Product description (plain text or HTML)",
        supportsAI: true,
        connectButton: true
      },
      {
        name: "vendor",
        dependsOn: "shopify_store",
        hidden: {
          $deps: ["shopify_store"],
          $condition: { shopify_store: { $exists: false } }
        },
        label: "Vendor",
        type: "text",
        required: false,
        placeholder: "My Brand",
        description: "The vendor of the product",
        supportsAI: true,
        connectButton: true
      },
      {
        name: "product_type",
        dependsOn: "shopify_store",
        hidden: {
          $deps: ["shopify_store"],
          $condition: { shopify_store: { $exists: false } }
        },
        label: "Product Type",
        type: "text",
        required: false,
        placeholder: "Apparel",
        description: "The type/category of the product",
        supportsAI: true,
        connectButton: true
      },
      {
        name: "price",
        dependsOn: "shopify_store",
        hidden: {
          $deps: ["shopify_store"],
          $condition: { shopify_store: { $exists: false } }
        },
        label: "Price",
        type: "number",
        required: true,
        placeholder: "29.99",
        description: "The price of the product",
        supportsAI: true,
        connectButton: true,
        step: 0.01,
        min: 0
      },
      {
        name: "sku",
        dependsOn: "shopify_store",
        hidden: {
          $deps: ["shopify_store"],
          $condition: { shopify_store: { $exists: false } }
        },
        label: "SKU (Optional)",
        type: "text",
        required: false,
        placeholder: "PROD-001",
        description: "Stock Keeping Unit",
        supportsAI: true,
        connectButton: true
      },
      {
        name: "inventory_quantity",
        dependsOn: "shopify_store",
        hidden: {
          $deps: ["shopify_store"],
          $condition: { shopify_store: { $exists: false } }
        },
        label: "Initial Inventory",
        type: "number",
        required: false,
        defaultValue: 0,
        placeholder: "100",
        description: "Starting inventory quantity",
        connectButton: true
      },
    ],
    outputSchema: [
      {
        name: "product_id",
        label: "Product ID",
        type: "string",
        description: "The unique identifier for the created product",
        example: "gid://shopify/Product/9876543210"
      },
      {
        name: "variant_id",
        label: "Variant ID",
        type: "string",
        description: "The unique identifier for the default variant of the product",
        example: "gid://shopify/ProductVariant/1112223334"
      },
      {
        name: "title",
        label: "Title",
        type: "string",
        description: "The title of the created product",
        example: "Amazing Product"
      },
      {
        name: "admin_url",
        label: "Admin URL",
        type: "string",
        description: "Direct link to view the product in Shopify admin",
        example: "https://mystore.myshopify.com/admin/products/9876543210"
      },
      {
        name: "created_at",
        label: "Created At",
        type: "string",
        description: "ISO 8601 timestamp when the product was created",
        example: "2024-01-15T10:30:00Z"
      },
    ],
  },
  {
    type: "shopify_action_update_product",
    title: "Update Product",
    description: "Update an existing product in Shopify",
    icon: Package,
    providerId: "shopify",
    category: "E-commerce",
    isTrigger: false,
    producesOutput: true,
    testable: true,
    requiredScopes: ["write_products"],
    configSchema: [
      STORE_SELECTOR_FIELD,
      {
        name: "product_id",
        dependsOn: "shopify_store",
        hidden: {
          $deps: ["shopify_store"],
          $condition: { shopify_store: { $exists: false } }
        },
        label: "Product",
        type: "select",
        dynamic: "shopify_products",
        required: true,
        loadOnMount: true,
        placeholder: "Select a product...",
        description: "Select the product to update",
        supportsAI: true,
        connectButton: true
      },
      {
        name: "title",
        dependsOn: "shopify_store",
        hidden: {
          $deps: ["shopify_store"],
          $condition: { shopify_store: { $exists: false } }
        },
        label: "Product Title (Optional)",
        type: "text",
        required: false,
        placeholder: "Updated Product Name",
        description: "Update the product title",
        supportsAI: true,
        connectButton: true
      },
      {
        name: "body_html",
        dependsOn: "shopify_store",
        hidden: {
          $deps: ["shopify_store"],
          $condition: { shopify_store: { $exists: false } }
        },
        label: "Description (Optional)",
        type: "textarea",
        required: false,
        placeholder: "Updated product description",
        description: "Update product description",
        supportsAI: true,
        connectButton: true
      },
      {
        name: "vendor",
        dependsOn: "shopify_store",
        hidden: {
          $deps: ["shopify_store"],
          $condition: { shopify_store: { $exists: false } }
        },
        label: "Vendor (Optional)",
        type: "text",
        required: false,
        placeholder: "Brand Name",
        description: "Update the vendor/brand",
        supportsAI: true,
        connectButton: true
      },
      {
        name: "product_type",
        dependsOn: "shopify_store",
        hidden: {
          $deps: ["shopify_store"],
          $condition: { shopify_store: { $exists: false } }
        },
        label: "Product Type (Optional)",
        type: "text",
        required: false,
        placeholder: "Electronics",
        description: "Update the product type/category",
        supportsAI: true,
        connectButton: true
      },
      {
        name: "tags",
        dependsOn: "shopify_store",
        hidden: {
          $deps: ["shopify_store"],
          $condition: { shopify_store: { $exists: false } }
        },
        label: "Tags (Optional)",
        type: "text",
        required: false,
        placeholder: "new-arrival, featured, sale",
        description: "Comma-separated tags (replaces existing tags)",
        supportsAI: true,
        connectButton: true
      },
      {
        name: "published",
        dependsOn: "shopify_store",
        hidden: {
          $deps: ["shopify_store"],
          $condition: { shopify_store: { $exists: false } }
        },
        label: "Published Status (Optional)",
        type: "select",
        required: false,
        options: [
          { label: "Keep Current", value: "" },
          { label: "Published (Visible)", value: "true" },
          { label: "Draft (Hidden)", value: "false" },
        ],
        defaultValue: "",
        description: "Update product visibility in storefront",
        connectButton: true
      },
    ],
    outputSchema: [
      {
        name: "success",
        label: "Success",
        type: "boolean",
        description: "Whether the product update was successful",
        example: true
      },
      {
        name: "product_id",
        label: "Product ID",
        type: "string",
        description: "The unique identifier for the updated product",
        example: "gid://shopify/Product/9876543210"
      },
      {
        name: "title",
        label: "Title",
        type: "string",
        description: "The updated title of the product",
        example: "Updated Product Name"
      },
      {
        name: "admin_url",
        label: "Admin URL",
        type: "string",
        description: "Direct link to view the product in Shopify admin",
        example: "https://mystore.myshopify.com/admin/products/9876543210"
      },
      {
        name: "updated_at",
        label: "Updated At",
        type: "string",
        description: "ISO 8601 timestamp when the product was last updated",
        example: "2024-01-15T10:30:00Z"
      },
    ],
  },
  {
    type: "shopify_action_update_inventory",
    title: "Update Inventory",
    description: "Update the inventory level of a product variant",
    icon: Package,
    providerId: "shopify",
    category: "E-commerce",
    isTrigger: false,
    producesOutput: true,
    testable: true,
    requiredScopes: ["write_inventory"],
    configSchema: [
      STORE_SELECTOR_FIELD,
      {
        name: "inventory_item_id",
        dependsOn: "shopify_store",
        hidden: {
          $deps: ["shopify_store"],
          $condition: { shopify_store: { $exists: false } }
        },
        label: "Inventory Item",
        type: "select",
        dynamic: "shopify_inventory_items",
        required: true,
        loadOnMount: true,
        placeholder: "Select an inventory item...",
        description: "Select the inventory item to update",
        supportsAI: true,
        connectButton: true
      },
      {
        name: "location_id",
        dependsOn: "shopify_store",
        hidden: {
          $deps: ["shopify_store"],
          $condition: { shopify_store: { $exists: false } }
        },
        label: "Location",
        type: "select",
        dynamic: "shopify_locations",
        required: true,
        loadOnMount: true,
        placeholder: "Select location",
        description: "The location to update inventory at",
        connectButton: true
      },
      {
        name: "adjustment_type",
        dependsOn: "shopify_store",
        hidden: {
          $deps: ["shopify_store"],
          $condition: { shopify_store: { $exists: false } }
        },
        label: "Adjustment Type",
        type: "select",
        required: true,
        options: [
          { label: "Set to Specific Amount", value: "set" },
          { label: "Add to Current", value: "add" },
          { label: "Subtract from Current", value: "subtract" },
        ],
        defaultValue: "set",
        description: "How to adjust the inventory",
        connectButton: true
      },
      {
        name: "quantity",
        dependsOn: "shopify_store",
        hidden: {
          $deps: ["shopify_store"],
          $condition: { shopify_store: { $exists: false } }
        },
        label: "Quantity",
        type: "number",
        required: true,
        placeholder: "100",
        description: "The amount to set/add/subtract",
        supportsAI: true,
        connectButton: true
      },
    ],
    outputSchema: [
      {
        name: "success",
        label: "Success",
        type: "boolean",
        description: "Whether the inventory update was successful",
        example: true
      },
      {
        name: "inventory_item_id",
        label: "Inventory Item ID",
        type: "string",
        description: "The unique identifier for the inventory item that was updated",
        example: "gid://shopify/InventoryItem/5556667778"
      },
      {
        name: "new_quantity",
        label: "New Quantity",
        type: "number",
        description: "The updated inventory quantity after the adjustment",
        example: 150
      },
      {
        name: "location_id",
        label: "Location ID",
        type: "string",
        description: "The unique identifier for the location where inventory was updated",
        example: "gid://shopify/Location/9998887776"
      },
    ],
  },
  {
    type: "shopify_action_create_customer",
    title: "Create Customer",
    description: "Create a new customer in Shopify",
    icon: Users,
    providerId: "shopify",
    category: "E-commerce",
    isTrigger: false,
    producesOutput: true,
    testable: true,
    requiredScopes: ["write_customers"],
    configSchema: [
      STORE_SELECTOR_FIELD,
      {
        name: "email",
        dependsOn: "shopify_store",
        hidden: {
          $deps: ["shopify_store"],
          $condition: { shopify_store: { $exists: false } }
        },
        label: "Email",
        type: "text",
        required: true,
        placeholder: "customer@example.com",
        description: "Customer's email address",
        supportsAI: true,
        connectButton: true
      },
      {
        name: "first_name",
        dependsOn: "shopify_store",
        hidden: {
          $deps: ["shopify_store"],
          $condition: { shopify_store: { $exists: false } }
        },
        label: "First Name",
        type: "text",
        required: false,
        placeholder: "John",
        description: "Customer's first name",
        supportsAI: true,
        connectButton: true
      },
      {
        name: "last_name",
        dependsOn: "shopify_store",
        hidden: {
          $deps: ["shopify_store"],
          $condition: { shopify_store: { $exists: false } }
        },
        label: "Last Name",
        type: "text",
        required: false,
        placeholder: "Doe",
        description: "Customer's last name",
        supportsAI: true,
        connectButton: true
      },
      {
        name: "phone",
        dependsOn: "shopify_store",
        hidden: {
          $deps: ["shopify_store"],
          $condition: { shopify_store: { $exists: false } }
        },
        label: "Phone (Optional)",
        type: "text",
        required: false,
        placeholder: "+1-555-1234",
        description: "Customer's phone number",
        supportsAI: true,
        connectButton: true
      },
      {
        name: "tags",
        dependsOn: "shopify_store",
        hidden: {
          $deps: ["shopify_store"],
          $condition: { shopify_store: { $exists: false } }
        },
        label: "Tags (Optional)",
        type: "text",
        required: false,
        placeholder: "vip, wholesale",
        description: "Comma-separated tags",
        supportsAI: true,
        connectButton: true
      },
      {
        name: "send_welcome_email",
        dependsOn: "shopify_store",
        hidden: {
          $deps: ["shopify_store"],
          $condition: { shopify_store: { $exists: false } }
        },
        label: "Send Welcome Email",
        type: "boolean",
        required: false,
        defaultValue: false,
        description: "Send account activation email",
        connectButton: true
      },
    ],
    outputSchema: [
      {
        name: "customer_id",
        label: "Customer ID",
        type: "string",
        description: "The unique identifier for the created customer",
        example: "gid://shopify/Customer/1234567890"
      },
      {
        name: "email",
        label: "Email",
        type: "string",
        description: "The email address of the created customer",
        example: "customer@example.com"
      },
      {
        name: "admin_url",
        label: "Admin URL",
        type: "string",
        description: "Direct link to view the customer in Shopify admin",
        example: "https://mystore.myshopify.com/admin/customers/1234567890"
      },
      {
        name: "created_at",
        label: "Created At",
        type: "string",
        description: "ISO 8601 timestamp when the customer was created",
        example: "2024-01-15T10:30:00Z"
      },
    ],
  },
  {
    type: "shopify_action_update_customer",
    title: "Update Customer",
    description: "Update an existing customer in Shopify",
    icon: Users,
    providerId: "shopify",
    category: "E-commerce",
    isTrigger: false,
    producesOutput: true,
    testable: true,
    requiredScopes: ["write_customers"],
    configSchema: [
      STORE_SELECTOR_FIELD,
      {
        name: "customer_id",
        dependsOn: "shopify_store",
        hidden: {
          $deps: ["shopify_store"],
          $condition: { shopify_store: { $exists: false } }
        },
        label: "Customer",
        type: "select",
        dynamic: "shopify_customers",
        required: true,
        loadOnMount: true,
        placeholder: "Select a customer...",
        description: "Select the customer to update",
        supportsAI: true,
        connectButton: true
      },
      {
        name: "email",
        dependsOn: "shopify_store",
        hidden: {
          $deps: ["shopify_store"],
          $condition: { shopify_store: { $exists: false } }
        },
        label: "Email (Optional)",
        type: "text",
        required: false,
        placeholder: "newemail@example.com",
        description: "Update customer's email address",
        supportsAI: true,
        connectButton: true
      },
      {
        name: "first_name",
        dependsOn: "shopify_store",
        hidden: {
          $deps: ["shopify_store"],
          $condition: { shopify_store: { $exists: false } }
        },
        label: "First Name (Optional)",
        type: "text",
        required: false,
        placeholder: "John",
        description: "Update customer's first name",
        supportsAI: true,
        connectButton: true
      },
      {
        name: "last_name",
        dependsOn: "shopify_store",
        hidden: {
          $deps: ["shopify_store"],
          $condition: { shopify_store: { $exists: false } }
        },
        label: "Last Name (Optional)",
        type: "text",
        required: false,
        placeholder: "Doe",
        description: "Update customer's last name",
        supportsAI: true,
        connectButton: true
      },
      {
        name: "phone",
        dependsOn: "shopify_store",
        hidden: {
          $deps: ["shopify_store"],
          $condition: { shopify_store: { $exists: false } }
        },
        label: "Phone (Optional)",
        type: "text",
        required: false,
        placeholder: "+1-555-5678",
        description: "Update customer's phone number",
        supportsAI: true,
        connectButton: true
      },
      {
        name: "tags",
        dependsOn: "shopify_store",
        hidden: {
          $deps: ["shopify_store"],
          $condition: { shopify_store: { $exists: false } }
        },
        label: "Tags (Optional)",
        type: "text",
        required: false,
        placeholder: "vip, loyal-customer",
        description: "Comma-separated tags (replaces existing tags)",
        supportsAI: true,
        connectButton: true
      },
      {
        name: "note",
        dependsOn: "shopify_store",
        hidden: {
          $deps: ["shopify_store"],
          $condition: { shopify_store: { $exists: false } }
        },
        label: "Note (Optional)",
        type: "text",
        required: false,
        placeholder: "Prefers email communication",
        description: "Internal note about the customer",
        supportsAI: true,
        connectButton: true
      },
      {
        name: "accepts_marketing",
        dependsOn: "shopify_store",
        hidden: {
          $deps: ["shopify_store"],
          $condition: { shopify_store: { $exists: false } }
        },
        label: "Accepts Marketing (Optional)",
        type: "select",
        required: false,
        options: [
          { label: "Keep Current", value: "" },
          { label: "Yes (Opted In)", value: "true" },
          { label: "No (Opted Out)", value: "false" },
        ],
        defaultValue: "",
        description: "Update marketing email preference",
        connectButton: true
      },
    ],
    outputSchema: [
      {
        name: "success",
        label: "Success",
        type: "boolean",
        description: "Whether the customer update was successful",
        example: true
      },
      {
        name: "customer_id",
        label: "Customer ID",
        type: "string",
        description: "The unique identifier for the updated customer",
        example: "gid://shopify/Customer/1234567890"
      },
      {
        name: "email",
        label: "Email",
        type: "string",
        description: "The updated email address of the customer",
        example: "newemail@example.com"
      },
      {
        name: "admin_url",
        label: "Admin URL",
        type: "string",
        description: "Direct link to view the customer in Shopify admin",
        example: "https://mystore.myshopify.com/admin/customers/1234567890"
      },
      {
        name: "updated_at",
        label: "Updated At",
        type: "string",
        description: "ISO 8601 timestamp when the customer was last updated",
        example: "2024-01-15T10:30:00Z"
      },
    ],
  },
  {
    type: "shopify_action_create_fulfillment",
    title: "Create Fulfillment",
    description: "Create a fulfillment for an order with tracking information",
    icon: CheckCircle,
    providerId: "shopify",
    category: "E-commerce",
    isTrigger: false,
    producesOutput: true,
    testable: true,
    requiredScopes: ["write_orders", "write_fulfillments"],
    configSchema: [
      STORE_SELECTOR_FIELD,
      {
        name: "order_id",
        dependsOn: "shopify_store",
        hidden: {
          $deps: ["shopify_store"],
          $condition: { shopify_store: { $exists: false } }
        },
        label: "Order",
        type: "select",
        dynamic: "shopify_orders",
        required: true,
        loadOnMount: true,
        placeholder: "Select an order...",
        description: "Select the order to fulfill",
        supportsAI: true,
        connectButton: true
      },
      {
        name: "tracking_number",
        dependsOn: "shopify_store",
        hidden: {
          $deps: ["shopify_store"],
          $condition: { shopify_store: { $exists: false } }
        },
        label: "Tracking Number (Optional)",
        type: "text",
        required: false,
        placeholder: "1Z999AA10123456784",
        description: "Shipment tracking number",
        supportsAI: true,
        connectButton: true
      },
      {
        name: "tracking_company",
        dependsOn: "shopify_store",
        hidden: {
          $deps: ["shopify_store"],
          $condition: { shopify_store: { $exists: false } }
        },
        label: "Tracking Company (Optional)",
        type: "select",
        required: false,
        options: [
          { label: "None", value: "" },
          { label: "UPS", value: "UPS" },
          { label: "USPS", value: "USPS" },
          { label: "FedEx", value: "FedEx" },
          { label: "DHL", value: "DHL" },
          { label: "Canada Post", value: "Canada Post" },
          { label: "Other", value: "Other" },
        ],
        defaultValue: "",
        description: "Shipping carrier",
        connectButton: true
      },
      {
        name: "tracking_url",
        dependsOn: "shopify_store",
        hidden: {
          $deps: ["shopify_store"],
          $condition: { shopify_store: { $exists: false } }
        },
        label: "Tracking URL (Optional)",
        type: "text",
        required: false,
        placeholder: "https://www.ups.com/track?tracknum=1Z999AA10123456784",
        description: "Direct link to tracking page",
        supportsAI: true,
        connectButton: true
      },
      {
        name: "notify_customer",
        dependsOn: "shopify_store",
        hidden: {
          $deps: ["shopify_store"],
          $condition: { shopify_store: { $exists: false } }
        },
        label: "Notify Customer",
        type: "boolean",
        required: false,
        defaultValue: true,
        description: "Send shipping confirmation email to customer",
        connectButton: true
      },
    ],
    outputSchema: [
      {
        name: "success",
        label: "Success",
        type: "boolean",
        description: "Whether the fulfillment was created successfully",
        example: true
      },
      {
        name: "fulfillment_id",
        label: "Fulfillment ID",
        type: "string",
        description: "The unique identifier for the created fulfillment",
        example: "gid://shopify/Fulfillment/4444555566"
      },
      {
        name: "order_id",
        label: "Order ID",
        type: "string",
        description: "The unique identifier of the fulfilled order",
        example: "gid://shopify/Order/1234567890"
      },
      {
        name: "tracking_number",
        label: "Tracking Number",
        type: "string",
        description: "The tracking number for the shipment",
        example: "1Z999AA10123456784"
      },
      {
        name: "tracking_url",
        label: "Tracking URL",
        type: "string",
        description: "URL to track the shipment",
        example: "https://www.ups.com/track?tracknum=1Z999AA10123456784"
      },
      {
        name: "created_at",
        label: "Created At",
        type: "string",
        description: "ISO 8601 timestamp when the fulfillment was created",
        example: "2024-01-15T10:30:00Z"
      },
    ],
  },
  {
    type: "shopify_action_add_order_note",
    title: "Add Order Note",
    description: "Add an internal note to an existing order",
    icon: FileText,
    providerId: "shopify",
    category: "E-commerce",
    isTrigger: false,
    producesOutput: true,
    testable: true,
    requiredScopes: ["write_orders"],
    configSchema: [
      STORE_SELECTOR_FIELD,
      {
        name: "order_id",
        dependsOn: "shopify_store",
        hidden: {
          $deps: ["shopify_store"],
          $condition: { shopify_store: { $exists: false } }
        },
        label: "Order",
        type: "select",
        dynamic: "shopify_orders",
        required: true,
        loadOnMount: true,
        placeholder: "Select an order...",
        description: "Select the order to add note to",
        supportsAI: true,
        connectButton: true
      },
      {
        name: "note",
        dependsOn: "shopify_store",
        hidden: {
          $deps: ["shopify_store"],
          $condition: { shopify_store: { $exists: false } }
        },
        label: "Note",
        type: "text",
        required: true,
        placeholder: "Customer requested gift wrapping",
        description: "The note to add to the order",
        supportsAI: true,
        connectButton: true
      },
      {
        name: "append",
        dependsOn: "shopify_store",
        hidden: {
          $deps: ["shopify_store"],
          $condition: { shopify_store: { $exists: false } }
        },
        label: "Append to Existing Note",
        type: "boolean",
        required: false,
        defaultValue: true,
        description: "Add to existing note instead of replacing",
        connectButton: true
      },
    ],
    outputSchema: [
      {
        name: "success",
        label: "Success",
        type: "boolean",
        description: "Whether the note was successfully added to the order",
        example: true
      },
      {
        name: "order_id",
        label: "Order ID",
        type: "string",
        description: "The unique identifier of the order that was updated",
        example: "gid://shopify/Order/1234567890"
      },
      {
        name: "note",
        label: "Updated Note",
        type: "string",
        description: "The complete note text after the update (includes appended content if applicable)",
        example: "Customer requested gift wrapping. Special delivery instructions: Leave at front door."
      },
    ],
  },
  {
    type: "shopify_action_create_product_variant",
    title: "Create Product Variant",
    description: "Add a new variant to an existing product (e.g., new size, color)",
    icon: Package,
    providerId: "shopify",
    category: "E-commerce",
    isTrigger: false,
    producesOutput: true,
    testable: true,
    requiredScopes: ["write_products"],
    configSchema: [
      STORE_SELECTOR_FIELD,
      {
        name: "product_id",
        dependsOn: "shopify_store",
        hidden: {
          $deps: ["shopify_store"],
          $condition: { shopify_store: { $exists: false } }
        },
        label: "Product",
        type: "select",
        dynamic: "shopify_products",
        loadOnMount: true,
        required: true,
        placeholder: "Select a product",
        description: "The product to add a variant to",
        supportsAI: true,
        connectButton: true
      },
      {
        name: "option1",
        dependsOn: "product_id",
        hidden: {
          $deps: ["product_id"],
          $condition: { product_id: { $exists: false } }
        },
        label: "Option 1 Value",
        type: "text",
        required: false,
        placeholder: "e.g., Large, Red, Default Title",
        description: "Value for the product's first option (e.g., if your product's first option is 'Size', enter 'Large')",
        supportsAI: true,
        connectButton: true
      },
      {
        name: "option2",
        dependsOn: "product_id",
        hidden: {
          $deps: ["product_id"],
          $condition: { product_id: { $exists: false } }
        },
        label: "Option 2 Value (Optional)",
        type: "text",
        required: false,
        placeholder: "e.g., Blue, XL",
        description: "Value for the product's second option (only if your product has 2+ options)",
        supportsAI: true,
        connectButton: true
      },
      {
        name: "option3",
        dependsOn: "product_id",
        hidden: {
          $deps: ["product_id"],
          $condition: { product_id: { $exists: false } }
        },
        label: "Option 3 Value (Optional)",
        type: "text",
        required: false,
        placeholder: "e.g., Polyester",
        description: "Value for the product's third option (only if your product has 3 options)",
        supportsAI: true,
        connectButton: true
      },
      {
        name: "price",
        dependsOn: "shopify_store",
        hidden: {
          $deps: ["shopify_store"],
          $condition: { shopify_store: { $exists: false } }
        },
        label: "Price",
        type: "number",
        required: true,
        placeholder: "39.99",
        description: "Price for this variant",
        supportsAI: true,
        connectButton: true,
        step: 0.01,
        min: 0
      },
      {
        name: "sku",
        dependsOn: "shopify_store",
        hidden: {
          $deps: ["shopify_store"],
          $condition: { shopify_store: { $exists: false } }
        },
        label: "SKU (Optional)",
        type: "text",
        required: false,
        placeholder: "PROD-LRG-RED",
        description: "Unique Stock Keeping Unit for this variant",
        supportsAI: true,
        connectButton: true
      },
      {
        name: "inventory_quantity",
        dependsOn: "shopify_store",
        hidden: {
          $deps: ["shopify_store"],
          $condition: { shopify_store: { $exists: false } }
        },
        label: "Initial Inventory (Optional)",
        type: "number",
        required: false,
        placeholder: "100",
        description: "Starting inventory quantity for this variant",
        connectButton: true
      },
      {
        name: "weight",
        dependsOn: "shopify_store",
        hidden: {
          $deps: ["shopify_store"],
          $condition: { shopify_store: { $exists: false } }
        },
        label: "Weight (Optional)",
        type: "number",
        required: false,
        placeholder: "1.5",
        description: "Weight in pounds (or store's default unit)",
        connectButton: true
      },
      {
        name: "barcode",
        dependsOn: "shopify_store",
        hidden: {
          $deps: ["shopify_store"],
          $condition: { shopify_store: { $exists: false } }
        },
        label: "Barcode (Optional)",
        type: "text",
        required: false,
        placeholder: "123456789012",
        description: "UPC, EAN, or ISBN barcode",
        supportsAI: true,
        connectButton: true
      },
    ],
    outputSchema: [
      {
        name: "success",
        label: "Success",
        type: "boolean",
        description: "Whether the variant was created successfully",
        example: true
      },
      {
        name: "variant_id",
        label: "Variant ID",
        type: "string",
        description: "The unique identifier for the created variant",
        example: "gid://shopify/ProductVariant/1112223334"
      },
      {
        name: "product_id",
        label: "Product ID",
        type: "string",
        description: "The unique identifier of the parent product",
        example: "gid://shopify/Product/9876543210"
      },
      {
        name: "sku",
        label: "SKU",
        type: "string",
        description: "The SKU of the created variant",
        example: "PROD-LRG-RED"
      },
      {
        name: "price",
        label: "Price",
        type: "number",
        description: "The price of the created variant",
        example: 39.99
      },
      {
        name: "created_at",
        label: "Created At",
        type: "string",
        description: "ISO 8601 timestamp when the variant was created",
        example: "2024-01-15T10:30:00Z"
      },
    ],
  },
  {
    type: "shopify_action_update_product_variant",
    title: "Update Product Variant",
    description: "Update an existing product variant (price, inventory, SKU, etc.)",
    icon: Package,
    providerId: "shopify",
    category: "E-commerce",
    isTrigger: false,
    producesOutput: true,
    testable: true,
    requiredScopes: ["write_products"],
    configSchema: [
      STORE_SELECTOR_FIELD,
      {
        name: "product_id",
        dependsOn: "shopify_store",
        hidden: {
          $deps: ["shopify_store"],
          $condition: { shopify_store: { $exists: false } }
        },
        label: "Product",
        type: "select",
        dynamic: "shopify_products",
        loadOnMount: true,
        required: true,
        placeholder: "Select a product",
        description: "Select the product containing the variant",
        supportsAI: true,
        connectButton: true
      },
      {
        name: "variant_id",
        dependsOn: "product_id",
        hidden: {
          $deps: ["product_id"],
          $condition: { product_id: { $exists: false } }
        },
        label: "Variant",
        type: "select",
        dynamic: "shopify_variants",
        loadOnMount: true,
        required: true,
        placeholder: "Select a variant",
        description: "Select the variant to update",
        supportsAI: true,
        connectButton: true
      },
      {
        name: "price",
        dependsOn: "variant_id",
        hidden: {
          $deps: ["variant_id"],
          $condition: { variant_id: { $exists: false } }
        },
        label: "Price (Optional)",
        type: "number",
        required: false,
        placeholder: "44.99",
        description: "Update the price",
        supportsAI: true,
        connectButton: true
      },
      {
        name: "sku",
        dependsOn: "variant_id",
        hidden: {
          $deps: ["variant_id"],
          $condition: { variant_id: { $exists: false } }
        },
        label: "SKU (Optional)",
        type: "text",
        required: false,
        placeholder: "PROD-LRG-RED-V2",
        description: "Update the SKU",
        supportsAI: true,
        connectButton: true
      },
      {
        name: "barcode",
        dependsOn: "variant_id",
        hidden: {
          $deps: ["variant_id"],
          $condition: { variant_id: { $exists: false } }
        },
        label: "Barcode (Optional)",
        type: "text",
        required: false,
        placeholder: "123456789013",
        description: "Update UPC, EAN, or ISBN barcode",
        supportsAI: true,
        connectButton: true
      },
    ],
    outputSchema: [
      {
        name: "success",
        label: "Success",
        type: "boolean",
        description: "Whether the variant update was successful",
        example: true
      },
      {
        name: "variant_id",
        label: "Variant ID",
        type: "string",
        description: "The unique identifier for the updated variant",
        example: "gid://shopify/ProductVariant/1112223334"
      },
      {
        name: "product_id",
        label: "Product ID",
        type: "string",
        description: "The unique identifier of the parent product",
        example: "gid://shopify/Product/9876543210"
      },
      {
        name: "sku",
        label: "SKU",
        type: "string",
        description: "The updated SKU of the variant",
        example: "PROD-LRG-RED-V2"
      },
      {
        name: "price",
        label: "Price",
        type: "number",
        description: "The updated price of the variant",
        example: 44.99
      },
      {
        name: "updated_at",
        label: "Updated At",
        type: "string",
        description: "ISO 8601 timestamp when the variant was last updated",
        example: "2024-01-15T10:30:00Z"
      },
    ],
  },
]
