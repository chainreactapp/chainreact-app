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

    // 1. Fetch contact properties schema
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
          error: `HubSpot Properties API error: ${propertiesResponse.status} - ${errorData.message || propertiesResponse.statusText}`,
          status: propertiesResponse.status,
          details: errorData
        },
        { status: 500 }
      )
    }

    const propertiesData = await propertiesResponse.json()

    // 2. Filter properties to get form fields
    const fieldNames = propertiesData.results
      .filter((prop: any) => prop.formField === true && prop.hidden !== true)
      .map((prop: any) => prop.name)

    // 3. Fetch contacts with only the form field properties
    const contactsResponse = await fetch(
      `https://api.hubapi.com/crm/v3/objects/contacts?properties=${fieldNames.join(',')}&limit=10`,
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
      }
    )

    if (!contactsResponse.ok) {
      const errorData = await contactsResponse.json().catch(() => ({}))
      return jsonResponse(
        { 
          error: `HubSpot Contacts API error: ${contactsResponse.status} - ${errorData.message || contactsResponse.statusText}`,
          status: contactsResponse.status,
          details: errorData
        },
        { status: 500 }
      )
    }

    const contactsData = await contactsResponse.json()

    // Analyze the data
    const analysis: {
      totalContacts: number;
      contactsRetrieved: number;
      sampleContacts: any[];
      availableProperties: Record<string, any>;
      missingProperties: string[];
      readOnlyProperties: string[];
      writableProperties: string[];
      propertyAnalysis: {
        hasData: Record<string, boolean>;
        dataTypes: Record<string, string>;
        sampleValues: Record<string, any>;
      };
      tableData?: {
        headers: string[];
        rows: string[][];
      };
      actualProperties?: string[];
    } = {
      totalContacts: contactsData.total || 0,
      contactsRetrieved: contactsData.results?.length || 0,
      sampleContacts: contactsData.results?.slice(0, 3) || [],
      availableProperties: {},
      missingProperties: [],
      readOnlyProperties: [],
      writableProperties: [],
      propertyAnalysis: {
        hasData: {},
        dataTypes: {},
        sampleValues: {}
      }
    }

    // Analyze properties if available
    if (propertiesData?.results) {
      propertiesData.results.forEach((prop: any) => {
        analysis.availableProperties[prop.name] = {
          label: prop.label,
          type: prop.type,
          fieldType: prop.fieldType,
          readOnly: prop.readOnly || false,
          calculated: prop.calculated || false,
          groupName: prop.groupName,
          description: prop.description
        }

        if (prop.readOnly || prop.calculated) {
          analysis.readOnlyProperties.push(prop.name)
        } else {
          analysis.writableProperties.push(prop.name)
        }
      })
    }

    // Use the filtered field names from the properties schema
    const actualPropertiesArray = fieldNames.sort()

    // Analyze sample contact data
    if (analysis.sampleContacts.length > 0) {
      const sampleContact = analysis.sampleContacts[0]
      analysis.propertyAnalysis = {
        hasData: {},
        dataTypes: {},
        sampleValues: {}
      }

      actualPropertiesArray.forEach((prop: string) => {
        const value = sampleContact.properties?.[prop]
        analysis.propertyAnalysis.hasData[prop] = value !== undefined && value !== null && value !== ''
        analysis.propertyAnalysis.dataTypes[prop] = typeof value
        analysis.propertyAnalysis.sampleValues[prop] = value
      })
    }

    // Create table data
    const tableData = {
      headers: ['Property', 'Type', 'Has Data', 'Sample Value', 'Read Only', 'Description'],
      rows: actualPropertiesArray.map((prop: string) => {
        const hasData = analysis.propertyAnalysis.hasData?.[prop] || false
        const dataType = analysis.propertyAnalysis.dataTypes?.[prop] || 'unknown'
        const sampleValue = analysis.propertyAnalysis.sampleValues?.[prop] || null
        const propertyInfo = propertiesData.results.find((p: any) => p.name === prop)
        const isReadOnly = propertyInfo?.readOnly || false
        
        return [
          prop,
          dataType,
          hasData ? '✅ Yes' : '❌ No',
          sampleValue !== null ? String(sampleValue).substring(0, 50) + (String(sampleValue).length > 50 ? '...' : '') : 'N/A',
          isReadOnly ? '🔒 Yes' : '✏️ No',
          propertyInfo?.description || 'Contact property'
        ]
      })
    }

    // Add table data to analysis
    analysis.tableData = tableData
    analysis.actualProperties = actualPropertiesArray

    return jsonResponse({
      success: true,
      data: {
        integration: {
          id: integration.id,
          provider: integration.provider,
          status: integration.status,
          createdAt: integration.created_at,
          updatedAt: integration.updated_at
        },
        analysis,
        rawContacts: contactsData.results || [],
        rawProperties: propertiesData?.results || []
      }
    })

  } catch (error: any) {
    logger.error("HubSpot debug contacts error:", error)
    return errorResponse("Internal server error", 500, {
        details: error.message,
        stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
      })
  }
} 