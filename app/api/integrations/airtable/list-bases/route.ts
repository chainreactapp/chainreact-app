import { NextResponse } from "next/server"
import { jsonResponse, errorResponse, successResponse } from '@/lib/utils/api-response'
import { createSupabaseRouteHandlerClient } from "@/utils/supabase/server"
import { decrypt } from "@/lib/security/encryption"

import { logger } from '@/lib/utils/logger'
import { CONNECTED_STATUSES_LIST } from "@/lib/integrations/connectionStatus"

export async function GET() {
  try {
    const supabase = await createSupabaseRouteHandlerClient()

    // Get current user
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) {
      return errorResponse("Unauthorized" , 401)
    }

    // Get Airtable integration
    const { data: integration, error: integError } = await supabase
      .from("integrations")
      .select("access_token, metadata")
      .eq("user_id", user.id)
      .eq("provider", "airtable")
      .in("status", CONNECTED_STATUSES_LIST)
      .single()

    if (integError || !integration) {
      return errorResponse("Airtable integration not found. Please connect Airtable first."
      , 404)
    }

    // Decrypt token
    const encryptionKey = process.env.ENCRYPTION_KEY
    if (!encryptionKey) {
      logger.error("ENCRYPTION_KEY not configured")
      return errorResponse("Server configuration error" , 500)
    }

    const token = decrypt(integration.access_token, encryptionKey)

    // First check user info and scopes
    const userInfoRes = await fetch("https://api.airtable.com/v0/meta/whoami", {
      headers: {
        Authorization: `Bearer ${token}`
      }
    })

    if (!userInfoRes.ok) {
      const error = await userInfoRes.text()
      logger.error("Failed to get Airtable user info:", error)
      return errorResponse("Invalid Airtable token. Please reconnect your Airtable integration."
      , 401)
    }

    const userInfo = await userInfoRes.json()
    const hasWebhookScope = userInfo.scopes?.includes("webhook:manage")

    // Get all bases
    const basesRes = await fetch("https://api.airtable.com/v0/meta/bases", {
      headers: {
        Authorization: `Bearer ${token}`
      }
    })

    if (!basesRes.ok) {
      const error = await basesRes.text()
      logger.error("Failed to list Airtable bases:", error)
      return errorResponse("Failed to fetch Airtable bases"
      , 500)
    }

    const basesData = await basesRes.json()

    // Format response
    const response = {
      user: {
        email: userInfo.email,
        id: userInfo.id,
        scopes: userInfo.scopes,
        hasWebhookScope
      },
      bases: basesData.bases.map((base: any) => ({
        id: base.id,
        name: base.name,
        permissionLevel: base.permissionLevel
      })),
      message: !hasWebhookScope
        ? "⚠️ Missing webhook:manage scope. Please reconnect Airtable to enable triggers."
        : null
    }

    return jsonResponse(response)

  } catch (error: any) {
    logger.error("Error listing Airtable bases:", error)
    return errorResponse(error.message || "Failed to list Airtable bases"
    , 500)
  }
}