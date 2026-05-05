import { NextRequest, NextResponse } from 'next/server'
import { jsonResponse, errorResponse, successResponse } from '@/lib/utils/api-response'
import { createSupabaseRouteHandlerClient } from '@/utils/supabase/server'
import { getDecryptedAccessToken } from '@/lib/workflows/actions/core/getDecryptedAccessToken'

import { logger } from '@/lib/utils/logger'
import { CONNECTED_STATUSES_LIST } from "@/lib/integrations/connectionStatus"

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const userId = searchParams.get('userId')
    
    if (!userId) {
      return errorResponse('User ID is required' , 400)
    }

    // Get HubSpot integration
    const supabase = await createSupabaseRouteHandlerClient()
    const { data: integration } = await supabase
      .from("integrations")
      .select("*")
      .eq("user_id", userId)
      .eq("provider", "hubspot")
      .in("status", CONNECTED_STATUSES_LIST)
      .single()

    if (!integration) {
      return errorResponse("HubSpot integration not connected" , 400)
    }

    const accessToken = await getDecryptedAccessToken(userId, "hubspot")

    // Fetch all company properties from HubSpot
    const response = await fetch("https://api.hubapi.com/crm/v3/properties/companies", {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json"
      }
    })

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}))
      throw new Error(`HubSpot API error: ${response.status} - ${errorData.message || response.statusText}`)
    }

    const data = await response.json()
    
    // Filter out hidden, archived, read-only, and calculated fields
    const properties = data.results.filter((prop: any) => {
      return !prop.hidden && 
             !prop.archived && 
             !prop.readOnly && 
             !prop.calculated &&
             prop.name !== 'hs_object_id' &&
             prop.name !== 'createdate' &&
             prop.name !== 'lastmodifieddate'
    })

    // Group properties by category
    const groupedProperties: Record<string, any[]> = {}
    
    properties.forEach((prop: any) => {
      const groupName = prop.groupName || 'other'
      if (!groupedProperties[groupName]) {
        groupedProperties[groupName] = []
      }
      
      // Transform property to match our expected format
      const transformedProp = {
        name: prop.name,
        label: prop.label,
        type: prop.fieldType,
        fieldType: prop.fieldType,
        groupName: prop.groupName || 'other',
        description: prop.description,
        hidden: prop.hidden,
        options: prop.options || [],
        existingValues: [] // Will be populated if we fetch sample data
      }
      
      groupedProperties[groupName].push(transformedProp)
    })

    // Fetch sample company data to provide existing values for dropdowns
    const sampleResponse = await fetch("https://api.hubapi.com/crm/v3/objects/companies?limit=10", {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json"
      }
    })

    let sampleData: any[] = []
    if (sampleResponse.ok) {
      const sampleResult = await sampleResponse.json()
      sampleData = sampleResult.results || []
    }

    // Add existing values to properties
    properties.forEach((prop: any) => {
      const existingValues = new Set<string>()
      
      sampleData.forEach((company: any) => {
        const value = company.properties[prop.name]
        if (value && typeof value === 'string' && value.trim()) {
          existingValues.add(value.trim())
        }
      })
      
      prop.existingValues = Array.from(existingValues).slice(0, 20) // Limit to 20 values
    })

    // Prepare config fields for UI consumption
    const configFields = properties.map((prop: any) => ({
      name: prop.name,
      label: prop.label,
      type: prop.fieldType,
      description: prop.description,
      groupName: prop.groupName || 'other',
      options: prop.options || [],
      existingValues: prop.existingValues || []
    }))

    return jsonResponse({
      properties: configFields,
      groupedProperties,
      totalProperties: properties.length,
      sampleData: sampleData.length
    })

  } catch (error: any) {
    logger.error("Error fetching HubSpot company properties:", error)
    return errorResponse(error.message || "Failed to fetch company properties" , 500)
  }
} 