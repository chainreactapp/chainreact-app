import { createSupabaseRouteHandlerClient, createSupabaseServiceClient } from "@/utils/supabase/server"
import { jsonResponse, errorResponse } from '@/lib/utils/api-response'
import { logger } from '@/lib/utils/logger'
import { NextRequest } from 'next/server'
import { after } from 'next/server'
import { queryWithTimeout } from '@/lib/utils/fetch-with-timeout'

export const dynamic = 'force-dynamic'
export const revalidate = 0
export const maxDuration = 10 // Max 10 seconds for this endpoint

/**
 * GET /api/integrations
 *
 * Fetches integrations for the current user based on workspace context.
 *
 * Query Parameters:
 * - workspace_type: 'personal' | 'team' | 'organization' (default: 'personal')
 * - workspace_id: UUID of team or organization (required for team/org)
 *
 * Returns integrations that the user has permission to access.
 *
 * Updated: 2025-10-28 - Added workspace context filtering
 */
export async function GET(request: NextRequest) {
  logger.info('📍 [API /api/integrations] GET request received', {
    timestamp: new Date().toISOString(),
    url: request.url
  });

  try {
    // Get authenticated user
    const supabaseAuth = await createSupabaseRouteHandlerClient()
    const {
      data: { user },
      error: userError,
    } = await supabaseAuth.auth.getUser()

    if (userError || !user) {
      logger.error('❌ [API /api/integrations] Auth error', {
        userError,
        hasUser: !!user
      });
      return errorResponse("Not authenticated", 401)
    }

    logger.info('✅ [API /api/integrations] User authenticated', { userId: user.id });

    // Parse workspace context from query parameters
    const { searchParams } = new URL(request.url)
    const workspaceType = searchParams.get('workspace_type') || 'personal'
    const workspaceId = searchParams.get('workspace_id')

    logger.info('🏠 [API /api/integrations] Workspace context', {
      workspaceType,
      workspaceId
    });

    // Validate workspace parameters
    if ((workspaceType === 'team' || workspaceType === 'organization') && !workspaceId) {
      return errorResponse('workspace_id is required for team/organization context', 400)
    }

    if (!['personal', 'team', 'organization'].includes(workspaceType)) {
      return errorResponse('Invalid workspace_type. Must be personal, team, or organization', 400)
    }

    // Use service role client to query integrations with permissions
    const supabaseService = await createSupabaseServiceClient()

    // OPTIMIZATION: Split complex JOIN into parallel queries, then merge in memory
    // This is much faster than database joins and prevents timeouts
    // See CLAUDE.md: "API Efficiency - Rule 2: Optimize Database Queries"

    // Build integrations query
    let integrationsQuery = supabaseService
      .from("integrations")
      .select('*')

    // Filter by workspace context
    // For 'personal' workspace, also include integrations with null workspace_type (backward compatibility)
    if (workspaceType === 'personal') {
      integrationsQuery = integrationsQuery
        .eq('user_id', user.id)
        .or('workspace_type.eq.personal,workspace_type.is.null')
    } else if (workspaceType === 'team' && workspaceId) {
      integrationsQuery = integrationsQuery
        .eq('workspace_type', 'team')
        .eq('workspace_id', workspaceId)
    } else if (workspaceType === 'organization' && workspaceId) {
      integrationsQuery = integrationsQuery
        .eq('workspace_type', 'organization')
        .eq('workspace_id', workspaceId)
    }

    // Fetch integrations and permissions in parallel (2x faster than JOIN)
    // Add 6s timeout to each query to prevent cold start issues
    const [
      { data: integrations, error: integrationsError },
      { data: permissions, error: permissionsError }
    ] = await Promise.all([
      queryWithTimeout(integrationsQuery, 6000),
      queryWithTimeout(
        supabaseService
          .from("integration_permissions")
          .select('integration_id, permission, user_id')
          .eq('user_id', user.id),
        6000
      )
    ])

    logger.info('📊 [API /api/integrations] Parallel query results', {
      workspaceType,
      workspaceId,
      integrationsCount: integrations?.length || 0,
      permissionsCount: permissions?.length || 0,
      integrationsError,
      permissionsError
    });

    if (integrationsError) {
      logger.error('❌ [API /api/integrations] Database error:', {
        message: integrationsError.message,
        code: integrationsError.code,
        details: integrationsError.details,
        hint: integrationsError.hint
      });
      return errorResponse(integrationsError.message, 500)
    }

    // Log permissions error but don't fail - we'll fall back to implicit permissions
    if (permissionsError) {
      logger.warn('⚠️ [API /api/integrations] Permissions query failed, using implicit permissions', {
        error: permissionsError
      });
    }

    // Check for expired integrations and schedule background update
    const now = new Date()
    const expiredIntegrationIds = (integrations || [])
      .filter((i: any) =>
        i.status === "connected" &&
        i.expires_at &&
        new Date(i.expires_at) <= now
      )
      .map((i: any) => i.id)

    // Move update to background using Next.js 15's after() - non-blocking
    // Response is sent immediately, update happens after
    if (expiredIntegrationIds.length > 0) {
      after(async () => {
        try {
          const supabaseServiceBg = await createSupabaseServiceClient()
          await supabaseServiceBg
            .from("integrations")
            .update({
              status: "expired",
              updated_at: now.toISOString(),
            })
            .in("id", expiredIntegrationIds)
          logger.info(`⏰ [API /api/integrations] Background: Updated ${expiredIntegrationIds.length} expired integrations`)
        } catch (err) {
          logger.error('❌ [API /api/integrations] Background update failed:', err)
        }
      })
    }

    // Build a permission lookup map for O(1) access
    const permissionMap = new Map<string, string>()
    if (permissions && !permissionsError) {
      permissions.forEach((perm: any) => {
        permissionMap.set(perm.integration_id, perm.permission)
      })
    }

    // Update the integrations array with the corrected statuses
    // Use explicit permissions from integration_permissions table if available,
    // otherwise fall back to implicit permissions based on workspace ownership
    const updatedIntegrations = integrations?.map((integration: any) => {
      let userPermission: 'use' | 'manage' | 'admin' | null = null

      // First, check for explicit permission in integration_permissions table
      if (permissionMap.has(integration.id)) {
        userPermission = permissionMap.get(integration.id) as 'use' | 'manage' | 'admin'
        logger.info('📋 [API /api/integrations] Using explicit permission', {
          integrationId: integration.id,
          provider: integration.provider,
          permission: userPermission
        });
      } else {
        // Fall back to implicit permissions based on workspace type and ownership
        // Treat null/undefined workspace_type as 'personal' for backward compatibility
        const isPersonalWorkspace = workspaceType === 'personal' || !integration.workspace_type
        if (isPersonalWorkspace && integration.user_id === user.id) {
          // Owner of personal integration has admin access
          userPermission = 'admin'
        } else if (workspaceType === 'team' || workspaceType === 'organization') {
          // For team/org integrations, check if user is the one who connected it
          if (integration.connected_by === user.id) {
            userPermission = 'admin' // Person who connected has admin
          } else {
            userPermission = 'use' // Other team members can use it (default)
          }
        }

        if (userPermission) {
          logger.info('📋 [API /api/integrations] Using implicit permission', {
            integrationId: integration.id,
            provider: integration.provider,
            permission: userPermission,
            reason: integration.connected_by === user.id ? 'connected_by' : 'default'
          });
        }
      }

      // Top-level columns are the canonical write target — every OAuth
      // callback in lib/integrations/provider-registry.ts populates email /
      // username / account_name here directly. Re-emit them so downstream
      // consumers see them at the top level even after a partial select.
      return {
        ...integration,
        status: expiredIntegrationIds.includes(integration.id) ? "expired" : integration.status,
        user_permission: userPermission,
        email: integration.email ?? null,
        username: integration.username ?? null,
        account_name: integration.account_name ?? null
      }
    })

    logger.info('✅ [API /api/integrations] Returning integrations', {
      count: updatedIntegrations?.length || 0,
      workspaceType
    });

    return jsonResponse({
      success: true,
      data: updatedIntegrations || [],
      workspace: {
        type: workspaceType,
        id: workspaceId
      }
    })
  } catch (error: any) {
    logger.error('❌ [API /api/integrations] Exception:', error);
    return jsonResponse(
      {
        success: false,
        error: error.message || "Failed to fetch integrations",
      },
      { status: 500 }
    )
  }
}
