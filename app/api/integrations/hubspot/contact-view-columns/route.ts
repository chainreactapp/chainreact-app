import { NextRequest, NextResponse } from "next/server"
import { jsonResponse, errorResponse, successResponse } from '@/lib/utils/api-response'
import { createSupabaseRouteHandlerClient } from "@/utils/supabase/server"
import { getDecryptedAccessToken } from "@/lib/workflows/actions/core/getDecryptedAccessToken"

import { logger } from '@/lib/utils/logger'
import { CONNECTED_STATUSES_LIST } from "@/lib/integrations/connectionStatus"

/**
 * API endpoint to fetch the actual columns visible in HubSpot's contacts table view
 * This uses HubSpot's Views API to get the configured columns for the default contacts view
 */
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

    // First, let's fetch ALL contact properties to see what's available
    logger.info("Fetching all HubSpot contact properties...")

    const allPropertiesResponse = await fetch(
      "https://api.hubapi.com/crm/v3/properties/contacts",
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
      }
    )

    if (!allPropertiesResponse.ok) {
      return errorResponse("Failed to fetch contact properties from HubSpot" , 500)
    }

    const allPropertiesData = await allPropertiesResponse.json()
    logger.info(`Found ${allPropertiesData.results.length} total contact properties`)

    // Try to fetch the views to see configured columns
    const viewsResponse = await fetch(
      "https://api.hubapi.com/crm/v3/objects/contacts/views",
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
      }
    )

    if (!viewsResponse.ok) {
      // If views API is not available, return ALL properties with metadata
      logger.info("Views API not available, returning all properties with metadata")

      // Since we already fetched all properties above, use that data
      const allProperties = allPropertiesData.results

      // Mark commonly displayed properties (these are typically shown in contacts tables)
      const commonlyDisplayed = [
        'firstname',
        'lastname',
        'email',
        'phone',
        'company',
        'jobtitle',
        'hs_lead_status',
        'lifecyclestage',
        'createdate',
        'lastmodifieddate',
        'hubspot_owner_id',
        // Custom properties that might be displayed
        'favorite_content_topics',
        'preferred_channels'
      ]

      // Map all properties with metadata about whether they're commonly displayed
      const tableProperties = allProperties
        .map((prop: any) => ({
          name: prop.name,
          label: prop.label,
          type: prop.type,
          fieldType: prop.fieldType,
          description: prop.description,
          groupName: prop.groupName,
          options: prop.options || [],
          hasOptions: prop.options && prop.options.length > 0,
          isCommonlyDisplayed: commonlyDisplayed.includes(prop.name),
          isCustom: prop.createdUserId ? true : false,
          isRequired: prop.name === 'email', // Email is always required
          createdAt: prop.createdAt,
          updatedAt: prop.updatedAt,
          formField: prop.formField,
          displayOrder: commonlyDisplayed.indexOf(prop.name)
        }))
        .sort((a: any, b: any) => {
          // Sort commonly displayed fields first, then alphabetically
          if (a.isCommonlyDisplayed && !b.isCommonlyDisplayed) return -1
          if (!a.isCommonlyDisplayed && b.isCommonlyDisplayed) return 1
          return a.label.localeCompare(b.label)
        })

      return jsonResponse({
        success: true,
        data: tableProperties,
        totalProperties: allProperties.length,
        message: "Showing all HubSpot contact properties. Note: HubSpot Views API is not accessible, so we cannot determine which specific fields are visible in your table view. All properties are shown with metadata.",
        source: "all-properties",
        note: "Properties marked as 'commonly displayed' are typically shown in contact tables, but your actual table configuration may vary."
      })
    }

    // Parse views response if available
    const viewsData = await viewsResponse.json()

    // Find the default or "All contacts" view
    const defaultView = viewsData.results?.find((view: any) =>
      view.name === "All contacts" || view.isDefault
    ) || viewsData.results?.[0]

    if (!defaultView || !defaultView.columns) {
      // No view found, use fallback
      return jsonResponse({
        success: true,
        data: [],
        message: "No default view found",
        source: "no-view"
      })
    }

    // Extract column property names from the view
    const visibleColumns = defaultView.columns.map((col: any) => col.propertyName || col.name)

    // Now fetch details for these specific properties
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
      return errorResponse("Failed to fetch contact properties" , 500)
    }

    const propertiesData = await propertiesResponse.json()

    // Filter to only the properties that are visible in the view
    const tableProperties = propertiesData.results
      .filter((prop: any) => visibleColumns.includes(prop.name))
      .map((prop: any) => ({
        name: prop.name,
        label: prop.label,
        type: prop.type,
        fieldType: prop.fieldType,
        description: prop.description,
        groupName: prop.groupName,
        options: prop.options || [],
        isVisible: true
      }))

    // Sort them in the order they appear in the view
    const orderedProperties = visibleColumns
      .map((colName: string) => tableProperties.find((p: any) => p.name === colName))
      .filter(Boolean)

    return jsonResponse({
      success: true,
      data: orderedProperties,
      message: "These are the actual columns configured in your HubSpot contacts view",
      viewName: defaultView.name,
      source: "view-api"
    })

  } catch (error: any) {
    logger.error("HubSpot contact view columns error:", error)
    return errorResponse("Internal server error", 500, {
        details: error.message,
        stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
      })
  }
}