import { NextRequest, NextResponse } from "next/server"
import { jsonResponse, errorResponse, successResponse } from '@/lib/utils/api-response'
import { createSupabaseRouteHandlerClient } from "@/utils/supabase/server"
import { getDecryptedAccessToken } from "@/lib/workflows/actions/core/getDecryptedAccessToken"

import { logger } from '@/lib/utils/logger'
import { CONNECTED_STATUSES_LIST } from "@/lib/integrations/connectionStatus"

export async function GET(request: NextRequest) {
  try {
    // Get user from session
    const supabase = await createSupabaseRouteHandlerClient()
    const { data: { user }, error: authError } = await supabase.auth.getUser()

    if (authError || !user) {
      return errorResponse("Unauthorized" , 401)
    }

    // Get HubSpot integration
    const { data: integration, error: integrationError } = await supabase
      .from("integrations")
      .select("*")
      .eq("user_id", user.id)
      .eq("provider", "hubspot")
      .in("status", CONNECTED_STATUSES_LIST)
      .single()

    if (integrationError || !integration) {
      return errorResponse("HubSpot integration not found or not connected" , 404)
    }

    // Get access token
    const accessToken = await getDecryptedAccessToken(user.id, "hubspot")

    // Fetch contact properties schema
    const propertiesResponse = await fetch(
      "https://api.hubapi.com/crm/v3/properties/contacts",
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
      }
    )

    if (!propertiesResponse.ok) {
      const errorData = await propertiesResponse.json().catch(() => ({}))
      return jsonResponse(
        { 
          error: `HubSpot API error: ${propertiesResponse.status} - ${errorData.message || propertiesResponse.statusText}`,
          status: propertiesResponse.status,
          details: errorData
        },
        { status: 500 }
      )
    }

    const propertiesData = await propertiesResponse.json()
    
    logger.info('All HubSpot contact properties:', propertiesData.results.map((p: any) => ({
      name: p.name,
      label: p.label,
      type: p.type,
      formField: p.formField,
      hidden: p.hidden,
      readOnly: p.readOnly,
      calculated: p.calculated
    })))

    // Filter properties to get form fields that are writable
    const availableProperties = propertiesData.results
      .filter((prop: any) => 
        prop.formField === true && 
        prop.hidden !== true && 
        !prop.readOnly && 
        !prop.calculated
      )
      .map((prop: any) => ({
        value: prop.name,
        label: prop.label,
        type: prop.type,
        fieldType: prop.fieldType,
        description: prop.description,
        groupName: prop.groupName
      }))
      .sort((a: any, b: any) => a.label.localeCompare(b.label))

    return jsonResponse({
      success: true,
      data: availableProperties
    })

  } catch (error: any) {
    logger.error("HubSpot contact properties error:", error)
    return errorResponse("Internal server error", 500, {
        details: error.message,
        stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
      })
  }
} 