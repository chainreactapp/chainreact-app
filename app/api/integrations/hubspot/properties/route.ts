import { NextRequest, NextResponse } from 'next/server'
import { jsonResponse, errorResponse, successResponse } from '@/lib/utils/api-response';
import { createSupabaseRouteHandlerClient } from '@/utils/supabase/server';
import { decrypt } from '@/lib/security/encryption';
import type { HubspotFieldDef, HubspotPropertiesResponse } from '@/lib/workflows/nodes/providers/hubspot/types';
import { hubspotPropertyToFieldDef } from '@/lib/workflows/nodes/providers/hubspot/types';

import { logger } from '@/lib/utils/logger'
import { CONNECTED_STATUSES_LIST } from "@/lib/integrations/connectionStatus"

// Cache for property schemas (in-memory for now, could be moved to Redis)
const propertyCache = new Map<string, { data: HubspotFieldDef[], timestamp: number }>();
const CACHE_DURATION = 10 * 60 * 1000; // 10 minutes in milliseconds

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const objectType = searchParams.get('objectType');
    const forceRefresh = searchParams.get('refresh') === 'true';
    const includeReadOnly = searchParams.get('includeReadOnly') === 'true';

    if (!objectType) {
      return errorResponse('objectType parameter is required' , 400);
    }

    // Get user from session
    const supabase = await createSupabaseRouteHandlerClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();

    if (authError || !user) {
      return errorResponse('Unauthorized' , 401);
    }

    // Get HubSpot integration
    const { data: integration, error: integrationError } = await supabase
      .from('integrations')
      .select('*')
      .eq('user_id', user.id)
      .eq('provider', 'hubspot')
      .in('status', CONNECTED_STATUSES_LIST)
      .single();

    if (integrationError || !integration) {
      return errorResponse('HubSpot integration not found or not connected' , 404);
    }

    // Get portal ID from metadata
    const portalId = integration.metadata?.hub_id || 'default';
    const cacheKey = `${portalId}:${objectType}`;

    // Check cache unless force refresh
    if (!forceRefresh) {
      const cached = propertyCache.get(cacheKey);
      if (cached && Date.now() - cached.timestamp < CACHE_DURATION) {
        return jsonResponse(cached.data);
      }
    }

    // Decrypt access token
    const encryptionKey = process.env.ENCRYPTION_KEY;
    if (!encryptionKey) {
      logger.error('Encryption key not configured');
      return errorResponse('Server configuration error' , 500);
    }

    const accessToken = decrypt(integration.access_token, encryptionKey);

    // Fetch properties from HubSpot
    const propertiesResponse = await fetch(
      `https://api.hubapi.com/crm/v3/properties/${objectType}`,
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
      }
    );

    if (!propertiesResponse.ok) {
      if (propertiesResponse.status === 404) {
        // Try custom object endpoint if standard endpoint fails
        const customPropertiesResponse = await fetch(
          `https://api.hubapi.com/crm/v3/schemas/${objectType}`,
          {
            headers: {
              Authorization: `Bearer ${accessToken}`,
              'Content-Type': 'application/json',
            },
          }
        );

        if (!customPropertiesResponse.ok) {
          const errorText = await propertiesResponse.text();
          logger.error('Failed to fetch properties:', propertiesResponse.status, errorText);
          return jsonResponse(
            { error: `Failed to fetch properties for object type: ${objectType}` },
            { status: propertiesResponse.status }
          );
        }

        // For custom objects, we need to fetch properties differently
        const customSchema = await customPropertiesResponse.json();
        const customPropsResponse = await fetch(
          `https://api.hubapi.com/crm/v3/properties/${customSchema.objectTypeId}`,
          {
            headers: {
              Authorization: `Bearer ${accessToken}`,
              'Content-Type': 'application/json',
            },
          }
        );

        if (!customPropsResponse.ok) {
          return jsonResponse(
            { error: `Failed to fetch properties for custom object: ${objectType}` },
            { status: customPropsResponse.status }
          );
        }

        const customPropsData: HubspotPropertiesResponse = await customPropsResponse.json();
    const fieldDefs = customPropsData.results
      .map(prop => hubspotPropertyToFieldDef(prop))
      .filter(field => includeReadOnly ? !field.hidden : (!field.hidden && !field.readOnly))
          .sort((a, b) => {
            // Sort by group, then by display order, then alphabetically
            if (a.group !== b.group) {
              if (!a.group) return 1;
              if (!b.group) return -1;
              return a.group.localeCompare(b.group);
            }
            if (a.displayOrder !== undefined && b.displayOrder !== undefined) {
              return a.displayOrder - b.displayOrder;
            }
            return a.label.localeCompare(b.label);
          });

        // Update required fields based on schema
        if (customSchema.requiredProperties) {
          fieldDefs.forEach(field => {
            field.required = customSchema.requiredProperties.includes(field.name);
          });
        }

        // Cache the results
        propertyCache.set(cacheKey, {
          data: fieldDefs,
          timestamp: Date.now(),
        });

        return jsonResponse(fieldDefs);
      }

      const errorText = await propertiesResponse.text();
      logger.error('Failed to fetch properties:', propertiesResponse.status, errorText);
      return jsonResponse(
        { error: `Failed to fetch properties: ${errorText}` },
        { status: propertiesResponse.status }
      );
    }

    const propertiesData: HubspotPropertiesResponse = await propertiesResponse.json();

    // Convert to our field definitions
    const fieldDefs = propertiesData.results
      .map(prop => hubspotPropertyToFieldDef(prop))
      .filter(field => includeReadOnly ? !field.hidden : (!field.hidden && !field.readOnly))
      .sort((a, b) => {
        // Sort by group, then by display order, then alphabetically
        if (a.group !== b.group) {
          if (!a.group) return 1;
          if (!b.group) return -1;
          return a.group.localeCompare(b.group);
        }
        if (a.displayOrder !== undefined && b.displayOrder !== undefined) {
          return a.displayOrder - b.displayOrder;
        }
        return a.label.localeCompare(b.label);
      });

    // For standard objects, mark common required fields
    if (objectType === 'contacts') {
      const emailField = fieldDefs.find(f => f.name === 'email');
      if (emailField) emailField.required = true;
    } else if (objectType === 'companies') {
      const nameField = fieldDefs.find(f => f.name === 'name');
      if (nameField) nameField.required = true;
    } else if (objectType === 'deals') {
      const nameField = fieldDefs.find(f => f.name === 'dealname');
      const stageField = fieldDefs.find(f => f.name === 'dealstage');
      if (nameField) nameField.required = true;
      if (stageField) stageField.required = true;
    }

    // Cache the results
    propertyCache.set(cacheKey, {
      data: fieldDefs,
      timestamp: Date.now(),
    });

    return jsonResponse(fieldDefs);
  } catch (error) {
    logger.error('Error in HubSpot properties route:', error);
    return errorResponse('Internal server error' , 500);
  }
}

// Clear cache endpoint (called when user clicks "Refresh fields")
export async function POST(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const objectType = searchParams.get('objectType');

    if (objectType) {
      // Clear specific object type cache
      for (const key of propertyCache.keys()) {
        if (key.endsWith(`:${objectType}`)) {
          propertyCache.delete(key);
        }
      }
    } else {
      // Clear all cache
      propertyCache.clear();
    }

    return jsonResponse({ success: true, message: 'Cache cleared' });
  } catch (error) {
    logger.error('Error clearing cache:', error);
    return errorResponse('Failed to clear cache' , 500);
  }
}
