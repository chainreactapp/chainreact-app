import { NextRequest, NextResponse } from "next/server"
import { jsonResponse, errorResponse, successResponse } from '@/lib/utils/api-response'
import { createSupabaseRouteHandlerClient } from "@/utils/supabase/server"
import { getDecryptedAccessToken } from "@/lib/workflows/actions/core/getDecryptedAccessToken"

import { logger } from '@/lib/utils/logger'
import { CONNECTED_STATUSES_LIST } from "@/lib/integrations/connectionStatus"

/**
 * Smart field detection - analyzes existing contacts to determine which fields are actually used
 */
export async function GET(request: NextRequest) {
  try {
    const supabase = await createSupabaseRouteHandlerClient()
    const { data: { user }, error: authError } = await supabase.auth.getUser()

    if (authError || !user) {
      return errorResponse("Unauthorized" , 401)
    }

    // Get HubSpot integration
    const { data: integration } = await supabase
      .from("integrations")
      .select("*")
      .eq("user_id", user.id)
      .eq("provider", "hubspot")
      .in("status", CONNECTED_STATUSES_LIST)
      .single()

    if (!integration) {
      return errorResponse("HubSpot integration not found" , 404)
    }

    const accessToken = await getDecryptedAccessToken(user.id, "hubspot")

    // Fetch a sample of recent contacts to analyze which fields are populated
    const contactsResponse = await fetch(
      "https://api.hubapi.com/crm/v3/objects/contacts?limit=10&properties=*",
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
      }
    )

    if (!contactsResponse.ok) {
      return errorResponse("Failed to fetch contacts" , 500)
    }

    const contactsData = await contactsResponse.json()
    const contacts = contactsData.results || []

    // Analyze which fields are actually populated
    const fieldUsage: Record<string, number> = {}
    const fieldSamples: Record<string, any[]> = {}

    contacts.forEach((contact: any) => {
      Object.entries(contact.properties).forEach(([field, value]) => {
        if (value && value !== "" && value !== "null") {
          fieldUsage[field] = (fieldUsage[field] || 0) + 1

          // Collect sample values
          if (!fieldSamples[field]) {
            fieldSamples[field] = []
          }
          if (fieldSamples[field].length < 3 && !fieldSamples[field].includes(value)) {
            fieldSamples[field].push(value)
          }
        }
      })
    })

    // Calculate usage percentage and sort by frequency
    const totalContacts = contacts.length
    const fieldsWithUsage = Object.entries(fieldUsage)
      .map(([field, count]) => ({
        field,
        usageCount: count,
        usagePercentage: totalContacts > 0 ? (count / totalContacts) * 100 : 0,
        samples: fieldSamples[field] || []
      }))
      .sort((a, b) => b.usagePercentage - a.usagePercentage)

    // Determine commonly used fields (used in >30% of contacts)
    const commonlyUsedFields = fieldsWithUsage
      .filter(f => f.usagePercentage > 30)
      .map(f => f.field)

    // Also fetch property definitions to get labels
    const propertiesResponse = await fetch(
      "https://api.hubapi.com/crm/v3/properties/contacts",
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
      }
    )

    const propertiesData = await propertiesResponse.json()
    const propertyMap = new Map(
      propertiesData.results.map((p: any) => [p.name, p])
    )

    // Enrich field data with property information
    const enrichedFields = fieldsWithUsage.map(field => {
      const property = propertyMap.get(field.field)
      return {
        ...field,
        label: property?.label || field.field,
        type: property?.type || 'unknown',
        groupName: property?.groupName || 'Other',
        hasOptions: property?.options && property.options.length > 0
      }
    })

    return jsonResponse({
      success: true,
      analyzedContacts: totalContacts,
      totalFieldsFound: fieldsWithUsage.length,
      commonlyUsedFields: commonlyUsedFields,
      fieldAnalysis: enrichedFields,
      recommendation: `Based on your data, we recommend including these fields: ${commonlyUsedFields.slice(0, 10).join(', ')}`
    })

  } catch (error: any) {
    logger.error("Error detecting used fields:", error)
    return errorResponse("Failed to analyze field usage" , 500)
  }
}