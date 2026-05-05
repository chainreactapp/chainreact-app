import { NextRequest, NextResponse } from "next/server"
import { jsonResponse, errorResponse, successResponse } from '@/lib/utils/api-response'
import { createSupabaseRouteHandlerClient } from "@/utils/supabase/server"
import { getDecryptedAccessToken } from "@/lib/workflows/actions/core/getDecryptedAccessToken"

import { logger } from '@/lib/utils/logger'
import { CONNECTED_STATUSES_LIST } from "@/lib/integrations/connectionStatus"

interface HubSpotProperty {
  name: string
  label: string
  type: string
  fieldType: string
  groupName: string
  description?: string
  hidden: boolean
  options: any[]
  externalOptions: boolean
  hasUniqueValue: boolean
  modificationMetadata: any
}

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

    // Filter to only visible, non-archived form fields that are writable
    const availableProperties = propertiesData.results
      .filter((prop: any) => 
        prop.formField === true && 
        !prop.readOnly && 
        !prop.calculated &&
        !prop.hidden && // Filter out hidden fields
        !prop.archived && // Filter out archived fields
        prop.hubspotDefined !== false // Include both HubSpot-defined and custom properties
      )
      .map((prop: any) => ({
        name: prop.name,
        label: prop.label,
        type: prop.type,
        fieldType: prop.fieldType,
        groupName: prop.groupName,
        description: prop.description,
        hidden: prop.hidden,
        options: prop.options || [],
        externalOptions: prop.externalOptions,
        hasUniqueValue: prop.hasUniqueValue,
        modificationMetadata: prop.modificationMetadata
      }))
      .sort((a: any, b: any) => {
        // Sort by group first, then by label
        if (a.groupName !== b.groupName) {
          return a.groupName.localeCompare(b.groupName)
        }
        return a.label.localeCompare(b.label)
      })

    // Get sample contact data to see what fields have existing values
    const contactsResponse = await fetch(
      "https://api.hubapi.com/crm/v3/objects/contacts?limit=50",
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
      }
    )

    const existingValues: Record<string, string[]> = {}
    if (contactsResponse.ok) {
      const contactsData = await contactsResponse.json()
      
      // Extract unique values for each property
      contactsData.results.forEach((contact: any) => {
        Object.entries(contact.properties).forEach(([key, value]) => {
          if (value && typeof value === 'string' && value.trim() !== '') {
            if (!existingValues[key]) {
              existingValues[key] = []
            }
            if (!existingValues[key].includes(value)) {
              existingValues[key].push(value)
            }
          }
        })
      })

      // Sort and limit values for each property
      Object.keys(existingValues).forEach(key => {
        existingValues[key] = existingValues[key]
          .sort()
          .slice(0, 20) // Limit to 20 values per field
      })
    }

    // Group properties by category for better organization
    const groupedProperties = availableProperties.reduce((groups: Record<string, any[]>, prop: HubSpotProperty) => {
      const groupName = prop.groupName || 'other'
      if (!groups[groupName]) {
        groups[groupName] = []
      }
      groups[groupName].push({
        ...prop,
        existingValues: existingValues[prop.name] || []
      })
      return groups
    }, {} as Record<string, any[]>)

    // Create field configuration for the config modal
    const configFields = availableProperties.map(prop => {
      const fieldConfig: any = {
        name: prop.name,
        label: prop.label,
        type: getFieldType(prop.fieldType, prop.type),
        required: false,
        placeholder: `Enter ${prop.label.toLowerCase()}`,
        description: prop.description,
        groupName: prop.groupName,
        hidden: prop.hidden,
        existingValues: existingValues[prop.name] || []
      }

      // Add options for enumeration fields
      if (prop.type === 'enumeration' && prop.options && prop.options.length > 0) {
        fieldConfig.options = prop.options.map((opt: any) => ({
          value: opt.value,
          label: opt.label
        }))
      }

      // Add existing values as options for text fields
      if (prop.type === 'string' && existingValues[prop.name] && existingValues[prop.name].length > 0) {
        fieldConfig.existingValues = existingValues[prop.name]
      }

      return fieldConfig
    })

    const response = {
      success: true,
      data: {
        properties: availableProperties,
        groupedProperties,
        configFields,
        existingValues,
        summary: {
          totalProperties: availableProperties.length,
          groups: Object.keys(groupedProperties),
          fieldsWithExistingValues: Object.keys(existingValues).length
        }
      }
    }
    
    logger.info('🔍 HubSpot API returning:', {
      success: response.success,
      propertiesCount: availableProperties.length,
      groupsCount: Object.keys(groupedProperties).length
    })
    
    return jsonResponse(response)

  } catch (error: any) {
    logger.error("HubSpot all contact properties error:", error)
    return errorResponse("Internal server error", 500, { details: error.message
       })
  }
}

function getFieldType(fieldType: string, type: string): string {
  switch (fieldType) {
    case 'text':
      return 'text'
    case 'textarea':
      return 'textarea'
    case 'number':
      return 'number'
    case 'date':
      return 'date'
    case 'datetime':
      return 'datetime'
    case 'boolean':
      return 'boolean'
    case 'select':
    case 'radio':
      return 'select'
    case 'checkbox':
      return 'multi-select'
    case 'phonenumber':
      return 'text'
    default:
      return type === 'enumeration' ? 'select' : 'text'
  }
} 