import { createSupabaseRouteHandlerClient, createSupabaseServiceClient } from "@/utils/supabase/server"
import { cookies } from "next/headers"
import { NextRequest, NextResponse } from "next/server"
import { jsonResponse, errorResponse, successResponse } from '@/lib/utils/api-response'
import { logger } from '@/lib/utils/logger'
import { queryWithTimeout } from '@/lib/utils/fetch-with-timeout'
import { z } from 'zod'

// Validation schema for workflow creation
const createWorkflowSchema = z.object({
  name: z.string().min(1, 'Name is required').max(200, 'Name is too long'),
  description: z.string().max(2000, 'Description is too long').optional(),
  status: z.enum(['draft', 'active', 'inactive', 'archived']).default('draft'),
  folder_id: z.string().uuid().optional().nullable(),
  workspace_type: z.enum(['personal', 'team', 'organization']).default('personal'),
  workspace_id: z.string().uuid().optional().nullable()
})

export const dynamic = 'force-dynamic'
export const revalidate = 0

/**
 * Shared predicate for personal workspace queries.
 * Matches workspace_type = 'personal', 'user', or NULL (legacy rows).
 * Team/org workflows are excluded by the workspace_type filter alone —
 * workspace_id is intentionally NOT checked because V2-created personal
 * workflows carry a non-null personal workspace_id for billing scope.
 */
function applyPersonalWorkspaceFilter(query: any, userId: string) {
  return query
    .eq('user_id', userId)
    .or('workspace_type.eq.personal,workspace_type.eq.user,workspace_type.is.null')
}

/**
 * GET /api/workflows
 *
 * Fetches ALL workflows the user has access to (unified view).
 * This includes:
 * - Personal workflows (user_id = current user)
 * - Team workflows (user is team member)
 * - Organization workflows (user is organization member)
 * - Shared workflows (via workflow_permissions)
 *
 * Query Parameters (OPTIONAL - for filtering):
 * - filter_context: 'personal' | 'team' | 'organization' (optional filter)
 * - workspace_id: UUID of team or organization (required if filter_context is team/org)
 *
 * Returns all workflows in a unified view, grouped by frontend.
 */
export async function GET(request: NextRequest) {
  const cookieStore = await cookies()
  const supabase = await createSupabaseRouteHandlerClient()

  try {
    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser()

    if (userError || !user) {
      return errorResponse("Not authenticated" , 401)
    }

    // Parse OPTIONAL filter parameters
    const { searchParams } = new URL(request.url)
    const filterContext = searchParams.get('filter_context') // OPTIONAL
    const workspaceId = searchParams.get('workspace_id')
    const includeTrash = searchParams.get('include_trash') === 'true'

    logger.info('[API /api/workflows] GET request', {
      filterContext: filterContext || 'ALL (unified view)',
      workspaceId,
      includeTrash,
      userId: user.id
    })

    // Use service role client to query workflows
    const supabaseService = await createSupabaseServiceClient()

    let workflows: any[] = []

    // Apply OPTIONAL filter if provided
    if (filterContext && filterContext !== 'all') {
      let query = supabaseService
        .from("workflows")
        .select('id, name, description, status, user_id, workspace_type, workspace_id, created_at, updated_at, created_by, last_modified_by, deleted_at, folder_id')

      // Include or exclude trashed workflows based on parameter
      // When includeTrash is true, return ALL workflows (active + deleted)
      // When includeTrash is false (default), only return active workflows
      if (!includeTrash) {
        query = query.is('deleted_at', null)
      }

      if (filterContext === 'personal') {
        query = applyPersonalWorkspaceFilter(query, user.id)
      } else if (filterContext === 'team' && workspaceId) {
        query = query
          .eq('workspace_type', 'team')
          .eq('workspace_id', workspaceId)
      } else if (filterContext === 'organization' && workspaceId) {
        query = query
          .eq('workspace_type', 'organization')
          .eq('workspace_id', workspaceId)
      }

      query = query.order("updated_at", { ascending: false })
      const { data, error } = await queryWithTimeout(query, 8000)

      if (error) {
        logger.error('[API /api/workflows] Database error:', error)
        return errorResponse(error.message, 500)
      }

      workflows = data || []
    } else {
      // NO FILTER - Fetch ALL workflows user has access to
      // Fetch in parallel: personal, team, and organization workflows

      const queries = []

      // 1. Personal workflows (with timeout protection)
      let personalQuery = applyPersonalWorkspaceFilter(
        supabaseService.from("workflows").select('id, name, description, status, user_id, workspace_type, workspace_id, created_at, updated_at, created_by, last_modified_by, deleted_at, folder_id'),
        user.id
      )

      // Include or exclude trashed workflows based on parameter
      // When includeTrash is true, return ALL workflows (active + deleted)
      if (!includeTrash) {
        personalQuery = personalQuery.is('deleted_at', null)
      }

      queries.push(queryWithTimeout(personalQuery, 8000))

      // 2. Fetch team and org memberships in parallel with timeout protection
      const [teamMembershipsResult, orgMembershipsResult] = await Promise.all([
        queryWithTimeout(
          supabaseService
            .from('team_members')
            .select('team_id')
            .eq('user_id', user.id),
          8000
        ),
        queryWithTimeout(
          supabaseService
            .from('organization_members')
            .select('organization_id')
            .eq('user_id', user.id),
          8000
        )
      ])

      const teamIds = teamMembershipsResult.data?.map(m => m.team_id) || []
      const orgIds = orgMembershipsResult.data?.map(m => m.organization_id) || []

      // 3. Add team workflows query if user is a member of any teams
      if (teamIds.length > 0) {
        let teamQuery = supabaseService
          .from("workflows")
          .select('id, name, description, status, user_id, workspace_type, workspace_id, created_at, updated_at, created_by, last_modified_by, deleted_at, folder_id')
          .eq('workspace_type', 'team')
          .in('workspace_id', teamIds)

        // Include or exclude trashed workflows based on parameter
        if (!includeTrash) {
          teamQuery = teamQuery.is('deleted_at', null)
        }

        queries.push(queryWithTimeout(teamQuery, 8000))
      }

      // 4. Add organization workflows query if user is a member of any orgs
      if (orgIds.length > 0) {
        let orgQuery = supabaseService
          .from("workflows")
          .select('id, name, description, status, user_id, workspace_type, workspace_id, created_at, updated_at, created_by, last_modified_by, deleted_at, folder_id')
          .eq('workspace_type', 'organization')
          .in('workspace_id', orgIds)

        // Include or exclude trashed workflows based on parameter
        if (!includeTrash) {
          orgQuery = orgQuery.is('deleted_at', null)
        }

        queries.push(queryWithTimeout(orgQuery, 8000))
      }

      // Execute all queries in parallel
      const results = await Promise.all(queries)

      // Combine results
      workflows = results.flatMap(result => result.data || [])

      // Sort by updated_at
      workflows.sort((a, b) => {
        const aTime = new Date(a.updated_at).getTime()
        const bTime = new Date(b.updated_at).getTime()
        return bTime - aTime // Descending
      })
    }

    const error = null

    logger.info('[API /api/workflows] Query result', {
      filterContext: filterContext || 'ALL',
      count: workflows?.length || 0,
      error
    })

    if (error) {
      logger.error('[API /api/workflows] Database error:', error)
      return errorResponse(error.message , 500)
    }

    // Fetch nodes from workflow_nodes table for all workflows
    // This is needed because nodes are now stored in a normalized table
    if (workflows.length > 0) {
      const workflowIds = workflows.map(w => w.id)

      const { data: allNodes, error: nodesError } = await queryWithTimeout(
        supabaseService
          .from('workflow_nodes')
          .select('id, workflow_id, node_type, label, provider_id, config')
          .in('workflow_id', workflowIds)
          .order('display_order', { ascending: true }),
        8000
      )

      if (nodesError) {
        logger.warn('[API /api/workflows] Failed to fetch nodes:', nodesError)
        // Don't fail the request, just continue without nodes
      } else if (allNodes) {
        // Create a Map for O(1) lookups
        const nodesByWorkflowId = new Map<string, any[]>()
        for (const node of allNodes) {
          const existing = nodesByWorkflowId.get(node.workflow_id) || []
          // Transform node to expected format for ConnectedNodesDisplay and validation
          existing.push({
            id: node.id,
            type: node.node_type,
            data: {
              type: node.node_type,
              providerId: node.provider_id || 'core',
              title: node.label || node.config?.label || 'Node',
              label: node.label || node.config?.label || 'Node',
              config: node.config || {},
            }
          })
          nodesByWorkflowId.set(node.workflow_id, existing)
        }

        // Attach nodes to each workflow
        for (const workflow of workflows) {
          workflow.nodes = nodesByWorkflowId.get(workflow.id) || []
        }

        logger.info('[API /api/workflows] Attached nodes to workflows', {
          totalNodes: allNodes.length,
          workflowsWithNodes: nodesByWorkflowId.size
        })
      }
    }

    // Return workflows with nodes attached
    return successResponse({ data: workflows })
  } catch (error: any) {
    logger.error('[API /api/workflows] Exception:', error)
    return errorResponse(error.message || "Internal server error", 500)
  }
}

/**
 * POST /api/workflows
 *
 * Creates a new workflow with workspace context.
 *
 * Body Parameters:
 * - name: string (required)
 * - description: string
 * - workspace_type: 'personal' | 'team' | 'organization' (default: 'personal')
 * - workspace_id: UUID (required for team/org)
 * - folder_id: UUID (optional)
 * - status: string (default: 'draft')
 */
export async function POST(request: Request) {
  const cookieStore = await cookies()
  const supabase = await createSupabaseRouteHandlerClient()

  try {
    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser()

    if (userError || !user) {
      return errorResponse("Not authenticated" , 401)
    }

    const body = await request.json()

    // Validate input with Zod
    const validationResult = createWorkflowSchema.safeParse(body)
    if (!validationResult.success) {
      const errors = validationResult.error.errors.map(e => `${e.path.join('.')}: ${e.message}`).join(', ')
      return errorResponse(`Invalid input: ${errors}`, 400)
    }

    const {
      name,
      description,
      status,
      folder_id,
      workspace_type,
      workspace_id
    } = validationResult.data

    logger.info('[API /api/workflows] POST request', {
      name,
      workspace_type,
      workspace_id,
      userId: user.id
    })

    // Validate workspace parameters
    if ((workspace_type === 'team' || workspace_type === 'organization') && !workspace_id) {
      return errorResponse('workspace_id is required for team/organization workflows', 400)
    }

    // If no folder_id is provided, use the user's default folder
    let targetFolderId = folder_id
    if (!targetFolderId) {
      // First, ensure the user has a default folder (create if doesn't exist)
      const { data: defaultFolder } = await supabase
        .from("workflow_folders")
        .select("id")
        .eq("user_id", user.id)
        .eq("is_default", true)
        .single()

      if (defaultFolder) {
        targetFolderId = defaultFolder.id
      } else {
        // No default folder exists, create one using the database function
        const { data: profile } = await supabase
          .from('profiles')
          .select('email')
          .eq('id', user.id)
          .single()

        const userEmail = profile?.email || user.email || 'User'

        const { data: newFolderId, error: folderError } = await supabase.rpc(
          'create_default_workflow_folder_for_user',
          {
            user_id_param: user.id,
            user_email: userEmail
          }
        )

        if (!folderError && newFolderId) {
          targetFolderId = newFolderId
        } else {
          logger.warn('[API /api/workflows] Failed to create default folder, using NULL', folderError)
          targetFolderId = null
        }
      }
    }

    // Insert workflow with workspace context and canonical billing scope
    // Note: nodes and edges are stored in workflow_nodes and workflow_edges tables
    const { buildWorkflowScopeFields } = await import('@/lib/billing/buildWorkflowScopeFields')
    const scopeFields = buildWorkflowScopeFields({
      workspaceType: workspace_type,
      workspaceId: workspace_id,
      userId: user.id,
    })

    // Atomic creation: workflow + admin permission + revision 0 in one transaction
    const serviceClient = await createSupabaseServiceClient()
    const { data: workflow, error } = await serviceClient.rpc(
      'create_workflow_with_revision',
      {
        p_name: name,
        p_description: description || undefined,
        p_user_id: user.id,
        p_workspace_type: workspace_type,
        p_workspace_id: workspace_id || undefined,
        p_folder_id: targetFolderId || undefined,
        p_status: status || 'draft',
        p_billing_scope_type: scopeFields.billing_scope_type,
        p_billing_scope_id: scopeFields.billing_scope_id,
      }
    ).single()

    if (error) {
      logger.error('[API /api/workflows] Create error:', error)
      return errorResponse(error.message, 500)
    }

    logger.info('[API /api/workflows] Workflow created', {
      id: workflow.id,
      workspace_type,
    })

    return successResponse({ workflow })
  } catch (error: any) {
    logger.error('[API /api/workflows] Exception:', error)
    return errorResponse("Internal server error" , 500)
  }
}
