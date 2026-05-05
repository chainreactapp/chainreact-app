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

    // Fetch all contact properties
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

    // Analyze properties
    const analysis = {
      totalProperties: propertiesData.results.length,
      formFields: propertiesData.results.filter((p: any) => p.formField === true),
      hiddenFields: propertiesData.results.filter((p: any) => p.hidden === true),
      readOnlyFields: propertiesData.results.filter((p: any) => p.readOnly === true),
      calculatedFields: propertiesData.results.filter((p: any) => p.calculated === true),
      byGroup: {} as Record<string, any[]>,
      recommendedFields: [] as any[],
      tableVisibility: {
        visible: [] as any[],
        hidden: [] as any[],
        recommended: [] as any[]
      }
    }

    // Group properties by groupName
    propertiesData.results.forEach((prop: any) => {
      if (!analysis.byGroup[prop.groupName]) {
        analysis.byGroup[prop.groupName] = []
      }
      analysis.byGroup[prop.groupName].push({
        name: prop.name,
        label: prop.label,
        type: prop.type,
        fieldType: prop.fieldType,
        formField: prop.formField,
        hidden: prop.hidden,
        readOnly: prop.readOnly,
        calculated: prop.calculated,
        description: prop.description
      })
    })

    // Identify recommended fields for table visibility
    const commonTableFields = [
      'firstname', 'lastname', 'email', 'phone', 'company', 'jobtitle', 
      'lifecyclestage', 'hs_lead_status', 'industry', 'city', 'state', 
      'country', 'address', 'website', 'mobilephone', 'salutation'
    ]

    propertiesData.results.forEach((prop: any) => {
      if (prop.formField && !prop.hidden && !prop.readOnly && !prop.calculated) {
        if (commonTableFields.includes(prop.name)) {
          analysis.tableVisibility.recommended.push({
            name: prop.name,
            label: prop.label,
            type: prop.type,
            fieldType: prop.fieldType,
            groupName: prop.groupName,
            reason: 'Common table field'
          })
        }
        
        if (prop.groupName === 'contactinformation') {
          analysis.tableVisibility.visible.push({
            name: prop.name,
            label: prop.label,
            type: prop.type,
            fieldType: prop.fieldType,
            groupName: prop.groupName
          })
        }
      }
    })

    // Get sample contact data to see what fields have data
    const contactsResponse = await fetch(
      "https://api.hubapi.com/crm/v3/objects/contacts?limit=3",
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
      }
    )

    let sampleData = null
    if (contactsResponse.ok) {
      const contactsData = await contactsResponse.json()
      sampleData = contactsData.results
    }

    return jsonResponse({
      success: true,
      data: {
        summary: {
          totalProperties: analysis.totalProperties,
          formFields: analysis.formFields.length,
          hiddenFields: analysis.hiddenFields.length,
          readOnlyFields: analysis.readOnlyFields.length,
          calculatedFields: analysis.calculatedFields.length
        },
        tableVisibility: analysis.tableVisibility,
        byGroup: analysis.byGroup,
        sampleData,
        recommendations: {
          addToTable: analysis.tableVisibility.recommended.map(field => ({
            name: field.name,
            label: field.label,
            reason: field.reason
          })),
          hiddenButUseful: analysis.hiddenFields
            .filter((p: any) => p.formField && !p.calculated)
            .map((p: any) => ({
              name: p.name,
              label: p.label,
              groupName: p.groupName,
              reason: 'Hidden but available for forms'
            }))
        }
      }
    })

  } catch (error: any) {
    logger.error("HubSpot field analysis error:", error)
    return errorResponse("Internal server error", 500, {
        details: error.message,
        stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
      })
  }
} 