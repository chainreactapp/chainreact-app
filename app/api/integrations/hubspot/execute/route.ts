import { NextRequest, NextResponse } from 'next/server'
import { jsonResponse, errorResponse, successResponse } from '@/lib/utils/api-response';
import { createSupabaseRouteHandlerClient } from '@/utils/supabase/server';
import { decrypt } from '@/lib/security/encryption';

import { logger } from '@/lib/utils/logger'
import type { ExecuteRequest } from '@/lib/workflows/nodes/providers/hubspot/types';
import { CONNECTED_STATUSES_LIST } from "@/lib/integrations/connectionStatus"

// Rate limiting with exponential backoff
async function withRetry<T>(
  fn: () => Promise<T>,
  maxRetries = 3,
  baseDelay = 1000
): Promise<T> {
  let lastError;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error: any) {
      lastError = error;

      // Check if it's a rate limit error
      if (error.status === 429 && attempt < maxRetries) {
        const delay = baseDelay * Math.pow(2, attempt) + Math.random() * 1000; // Exponential backoff with jitter
        logger.info(`Rate limited. Retrying in ${delay}ms...`);
        await new Promise(resolve => setTimeout(resolve, delay));
        continue;
      }

      // For other errors, throw immediately
      throw error;
    }
  }

  throw lastError;
}

// Format property values for HubSpot API
function formatPropertyValue(value: unknown, propertyType?: string): unknown {
  if (value === null || value === undefined || value === '') {
    return '';
  }

  // Handle date/datetime values
  if (propertyType === 'date' || propertyType === 'datetime') {
    if (typeof value === 'string') {
      const date = new Date(value);
      if (!isNaN(date.getTime())) {
        // HubSpot expects milliseconds for date/datetime
        return date.getTime();
      }
    } else if (typeof value === 'number') {
      return value; // Already in milliseconds
    }
  }

  // Handle boolean values
  if (propertyType === 'bool' || propertyType === 'boolean') {
    if (typeof value === 'string') {
      return value.toLowerCase() === 'true';
    }
    return !!value;
  }

  // Handle number values
  if (propertyType === 'number') {
    if (typeof value === 'string') {
      const parsed = parseFloat(value);
      if (!isNaN(parsed)) {
        return parsed;
      }
    }
    return value;
  }

  // Handle arrays (for multi-select fields)
  if (Array.isArray(value)) {
    return value.join(';'); // HubSpot uses semicolon-separated values for multi-select
  }

  // Default: convert to string
  return String(value);
}

export async function POST(request: NextRequest) {
  try {
    const body: ExecuteRequest = await request.json();

    const {
      accountId,
      objectType,
      op,
      recordId,
      identifierProperty,
      identifierValue,
      properties,
      associations,
    } = body;

    if (!objectType) {
      return errorResponse('objectType is required' , 400);
    }

    if (!op || !['create', 'update', 'upsert'].includes(op)) {
      return errorResponse('op must be one of: create, update, upsert' , 400);
    }

    if (op === 'update' && !recordId) {
      return errorResponse('recordId is required for update operation' , 400);
    }

    if (op === 'upsert' && (!identifierProperty || !identifierValue)) {
      return errorResponse('identifierProperty and identifierValue are required for upsert operation' , 400);
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

    // Decrypt access token
    const encryptionKey = process.env.ENCRYPTION_KEY;
    if (!encryptionKey) {
      logger.error('Encryption key not configured');
      return errorResponse('Server configuration error' , 500);
    }

    const accessToken = decrypt(integration.access_token, encryptionKey);

    // Format properties for HubSpot
    const formattedProperties: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(properties)) {
      formattedProperties[key] = formatPropertyValue(value);
    }

    let result: any;

    if (op === 'upsert') {
      // First, search for existing record
      const searchPayload = {
        filterGroups: [{
          filters: [{
            propertyName: identifierProperty,
            operator: 'EQ',
            value: identifierValue,
          }]
        }],
        limit: 1,
      };

      const searchResponse = await withRetry(async () => {
        const response = await fetch(
          `https://api.hubapi.com/crm/v3/objects/${objectType}/search`,
          {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${accessToken}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify(searchPayload),
          }
        );

        if (!response.ok) {
          const error = await response.json().catch(() => ({}));
          throw { status: response.status, message: error.message || response.statusText };
        }

        return response.json();
      });

      if (searchResponse.results && searchResponse.results.length > 0) {
        // Record exists, update it
        const existingRecordId = searchResponse.results[0].id;

        const updateResponse = await withRetry(async () => {
          const response = await fetch(
            `https://api.hubapi.com/crm/v3/objects/${objectType}/${existingRecordId}`,
            {
              method: 'PATCH',
              headers: {
                Authorization: `Bearer ${accessToken}`,
                'Content-Type': 'application/json',
              },
              body: JSON.stringify({ properties: formattedProperties }),
            }
          );

          if (!response.ok) {
            const error = await response.json().catch(() => ({}));
            throw { status: response.status, message: error.message || response.statusText };
          }

          return response.json();
        });

        result = {
          ...updateResponse,
          operation: 'update',
        };
      } else {
        // Record doesn't exist, create it
        const createResponse = await withRetry(async () => {
          const response = await fetch(
            `https://api.hubapi.com/crm/v3/objects/${objectType}`,
            {
              method: 'POST',
              headers: {
                Authorization: `Bearer ${accessToken}`,
                'Content-Type': 'application/json',
              },
              body: JSON.stringify({ properties: formattedProperties }),
            }
          );

          if (!response.ok) {
            const error = await response.json().catch(() => ({}));
            throw { status: response.status, message: error.message || response.statusText };
          }

          return response.json();
        });

        result = {
          ...createResponse,
          operation: 'create',
        };
      }
    } else if (op === 'create') {
      // Create new record
      const createResponse = await withRetry(async () => {
        const response = await fetch(
          `https://api.hubapi.com/crm/v3/objects/${objectType}`,
          {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${accessToken}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({ properties: formattedProperties }),
          }
        );

        if (!response.ok) {
          const error = await response.json().catch(() => ({}));
          throw { status: response.status, message: error.message || response.statusText };
        }

        return response.json();
      });

      result = createResponse;
    } else if (op === 'update') {
      // Update existing record
      const updateResponse = await withRetry(async () => {
        const response = await fetch(
          `https://api.hubapi.com/crm/v3/objects/${objectType}/${recordId}`,
          {
            method: 'PATCH',
            headers: {
              Authorization: `Bearer ${accessToken}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({ properties: formattedProperties }),
          }
        );

        if (!response.ok) {
          const error = await response.json().catch(() => ({}));
          throw { status: response.status, message: error.message || response.statusText };
        }

        return response.json();
      });

      result = updateResponse;
    }

    // Handle associations if provided
    if (associations && associations.length > 0 && result.id) {
      const associationPromises = associations.map(async (association) => {
        const associationType = association.associationType || `${objectType}_to_${association.toObjectType}`;

        return withRetry(async () => {
          const response = await fetch(
            `https://api.hubapi.com/crm/v3/objects/${objectType}/${result.id}/associations/${association.toObjectType}/${association.toObjectId}/${associationType}`,
            {
              method: 'PUT',
              headers: {
                Authorization: `Bearer ${accessToken}`,
                'Content-Type': 'application/json',
              },
            }
          );

          if (!response.ok) {
            logger.warn(`Failed to create association: ${response.status}`);
            // Don't throw for association errors, just log them
          }

          return response.ok;
        });
      });

      await Promise.allSettled(associationPromises);
    }

    return jsonResponse({
      success: true,
      data: result,
      message: `Successfully ${result.operation || op}d ${objectType} record`,
    });
  } catch (error: any) {
    logger.error('Error in HubSpot execute route:', error);

    // Handle specific error types
    if (error.status === 401 || error.status === 403) {
      return errorResponse('HubSpot connection expired or missing required scopes. Please reconnect your HubSpot account.' , 401);
    }

    if (error.status === 404) {
      return jsonResponse(
        { error: `Object type or record not found: ${error.message}` },
        { status: 404 }
      );
    }

    if (error.status === 400) {
      return jsonResponse(
        { error: `Validation error: ${error.message}` },
        { status: 400 }
      );
    }

    return errorResponse(error.message || 'Internal server error' , 500);
  }
}