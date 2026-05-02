import { ExecutionContext } from '@/types/workflow';
import { ActionResult } from '@/lib/workflows/actions';
import { createAdminClient } from '@/lib/supabase/admin';
import { decrypt } from '@/lib/security/encryption';
import { refreshAndRetry } from '@/lib/workflows/actions/core/refreshAndRetry';

import { logger } from '@/lib/utils/logger'

/**
 * Internal function to execute Notion Manage Users action
 */
async function executeNotionManageUsersInternal(
  context: ExecutionContext,
  config: any
): Promise<any> {
  const { operation, userId, includeGuests, workspace: workspaceId } = config;

  // Get the Notion integration using admin client
  const supabase = createAdminClient();

  const { data: integration, error: integrationError } = await supabase
    .from('integrations')
    .select('*')
    .eq('user_id', context.userId)
    .eq('provider', 'notion')
    .eq('status', 'connected')
    .single();

  if (integrationError || !integration) {
    throw new Error('Notion integration not found or not connected');
  }

  // Get the workspace access token from integration metadata
  const workspaces = integration.metadata?.workspaces || {};
  const workspace = workspaces[workspaceId];

  if (!workspace) {
    throw new Error(`Workspace ${workspaceId} not found in integration`);
  }

  // Decrypt the access token
  const encryptionKey = process.env.ENCRYPTION_KEY!;
  const accessToken = decrypt(workspace.access_token, encryptionKey);

  // Q3 — every raw `fetch` call below is wrapped in `refreshAndRetry`.
  // The helper takes a token and returns headers built with that token, so
  // the refreshed token after a 401 propagates into the retry attempt.
  const buildHeaders = (token: string) => ({
    'Authorization': `Bearer ${token}`,
    'Notion-Version': '2022-06-28',
    'Content-Type': 'application/json'
  });

  switch (operation) {
    case 'list':
      // List all users in the workspace (Q3 wrap).
      const listResult = await refreshAndRetry({
        provider: 'notion',
        userId: context.userId,
        accessToken,
        call: async (token) =>
          fetch('https://api.notion.com/v1/users', {
            method: 'GET',
            headers: buildHeaders(token)
          }),
      });
      if (!listResult.success) {
        throw new Error(listResult.message);
      }
      const listResponse = listResult.data;

      if (!listResponse.ok) {
        const error = await listResponse.json();
        throw new Error(`Failed to list users: ${error.message || listResponse.statusText}`);
      }

      const listData = await listResponse.json();

      // Process and enrich user data
      const users = listData.results.map((user: any) => ({
        id: user.id,
        type: user.type,
        name: user.name || 'Unknown User',
        email: user.person?.email || user.bot?.owner?.workspace_name || null,
        avatar_url: user.avatar_url,
        // Person-specific details
        person: user.type === 'person' ? {
          email: user.person?.email,
        } : undefined,
        // Bot-specific details
        bot: user.type === 'bot' ? {
          owner_type: user.bot?.owner?.type,
          workspace_name: user.bot?.workspace_name,
        } : undefined,
        // Include guest status based on config
        is_guest: user.type === 'person' && !user.bot ?
          (user.person?.email && !user.person?.email.includes('@yourworkspace.com')) : false
      }));

      // Filter out guests if requested
      const filteredUsers = includeGuests === 'false'
        ? users.filter((u: any) => !u.is_guest)
        : users;

      return {
        users: filteredUsers,
        total_count: filteredUsers.length,
        has_more: listData.has_more,
        next_cursor: listData.next_cursor
      };

    case 'get':
      // Get details for a specific user
      if (!userId) {
        throw new Error('User ID is required for get operation');
      }

      // Q3 wrap.
      const getResult = await refreshAndRetry({
        provider: 'notion',
        userId: context.userId,
        accessToken,
        call: async (token) =>
          fetch(`https://api.notion.com/v1/users/${userId}`, {
            method: 'GET',
            headers: buildHeaders(token)
          }),
      });
      if (!getResult.success) {
        throw new Error(getResult.message);
      }
      const getResponse = getResult.data;

      if (!getResponse.ok) {
        const error = await getResponse.json();
        throw new Error(`Failed to get user details: ${error.message || getResponse.statusText}`);
      }

      const userData = await getResponse.json();

      // Return comprehensive user details
      const userDetails = {
        id: userData.id,
        type: userData.type,
        name: userData.name || 'Unknown User',
        avatar_url: userData.avatar_url,

        // Person-specific details
        person_details: userData.type === 'person' ? {
          email: userData.person?.email,
        } : null,

        // Bot-specific details
        bot_details: userData.type === 'bot' ? {
          owner_type: userData.bot?.owner?.type,
          owner_user_id: userData.bot?.owner?.user?.id,
          workspace_name: userData.bot?.workspace_name,
        } : null,

        // Additional metadata
        object: userData.object,

        // Workspace access level (inferred)
        access_level: userData.type === 'bot' ? 'bot' :
                     (userData.person?.email ? 'member' : 'guest'),

        // Format a readable description
        description: userData.type === 'bot'
          ? `Bot owned by ${userData.bot?.owner?.type || 'workspace'}`
          : `${userData.type === 'person' ? 'User' : 'Unknown'} - ${userData.person?.email || 'No email'}`
      };

      // Also fetch recent activity if possible (pages created/edited by this user)
      // Auxiliary Q3 wrap — best-effort: non-401 errors are logged-and-swallowed.
      try {
        const activityResult = await refreshAndRetry({
          provider: 'notion',
          userId: context.userId,
          accessToken,
          call: async (token) =>
            fetch('https://api.notion.com/v1/search', {
              method: 'POST',
              headers: buildHeaders(token),
              body: JSON.stringify({
                filter: {
                  property: 'object',
                  value: 'page'
                },
                sort: {
                  direction: 'descending',
                  timestamp: 'last_edited_time'
                },
                page_size: 5
              })
            }),
        });

        if (activityResult.success && activityResult.data.ok) {
          const activityResponse = activityResult.data;
          const activityData = await activityResponse.json();

          // Filter pages edited by this user
          const userPages = activityData.results.filter((page: any) =>
            page.last_edited_by?.id === userId
          ).slice(0, 5);

          userDetails.recent_activity = userPages.map((page: any) => ({
            page_id: page.id,
            title: page.properties?.title?.title?.[0]?.plain_text ||
                   page.properties?.Name?.title?.[0]?.plain_text ||
                   'Untitled',
            last_edited: page.last_edited_time,
            url: page.url
          }));
        }
      } catch (activityError) {
        logger.info('Could not fetch user activity:', activityError);
        // Activity is optional, so we don't throw here
      }

      return {
        user: userDetails
      };

    default:
      throw new Error(`Unknown operation: ${operation}`);
  }
}

/**
 * Export wrapper function for action registry
 * Converts from standard action handler signature to ExecutionContext signature
 */
export async function executeNotionManageUsers(
  config: any,
  userId: string,
  input: Record<string, any>
): Promise<ActionResult> {
  try {
    // Create ExecutionContext from standard inputs
    const context: ExecutionContext = {
      userId,
      workflowId: input.workflowId || '',
      executionId: input.executionId || '',
      testMode: input.testMode || false,
      dataFlowManager: {
        resolveVariable: (value: string) => {
          // Simple variable resolution for backward compatibility
          if (typeof value === 'string' && value.includes('{{') && value.includes('}}')) {
            const match = value.match(/\{\{([^}]+)\}\}/);
            if (match) {
              const path = match[1].split('.');
              let result: any = input;
              for (const key of path) {
                result = result?.[key];
              }
              return result !== undefined ? result : value;
            }
          }
          return value;
        },
        getPreviousNodeOutputs: () => input.previousResults || {},
        getNodeOutput: (nodeId: string) => input.previousResults?.[nodeId] || null
      }
    };

    // Execute the internal function
    const result = await executeNotionManageUsersInternal(context, config);

    return {
      success: true,
      output: result,
      message: `Successfully executed ${config.operation} operation`
    };
  } catch (error: any) {
    const errorMessage = error?.message || error?.toString() || 'Unknown error';
    logger.error('Notion Manage Users error:', {
      message: errorMessage,
      operation: config.operation,
      hasUserId: !!config.userId
    });
    return {
      success: false,
      output: {},
      message: errorMessage
    };
  }
}