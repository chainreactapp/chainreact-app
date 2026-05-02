import { ExecutionContext } from '@/types/workflows';
import { createAdminClient } from '@/lib/supabase/admin';
import { decrypt } from '@/lib/security/encryption';
import { refreshAndRetry } from '@/lib/workflows/actions/core/refreshAndRetry';

import { logger } from '@/lib/utils/logger'

export async function notionGetPageDetails(
  context: ExecutionContext
): Promise<{ success: boolean; data?: any; error?: string }> {
  try {
    const { node, dataFlowManager, testMode } = context;
    const config = node.data.configuration || {};
    
    // Get required fields
    const workspaceId = await dataFlowManager.resolveVariable(config.workspace);
    const pageId = await dataFlowManager.resolveVariable(config.page);
    
    if (!workspaceId || !pageId) {
      throw new Error('Workspace and Page are required');
    }
    
    // Get optional configuration
    const includeProperties = config.includeProperties !== false; // Default true
    const includeContent = config.includeContent !== false; // Default true
    const includeChildren = config.includeChildren === true; // Default false
    const includeComments = config.includeComments === true; // Default false
    const outputFormat = config.outputFormat || 'full';
    
    // In test mode, return sample data
    if (testMode) {
      return {
        success: true,
        data: {
          id: pageId,
          workspace: workspaceId,
          title: 'Test Page',
          url: `https://notion.so/${pageId}`,
          properties: includeProperties ? {
            'Title': { type: 'title', title: [{ plain_text: 'Test Page' }] },
            'Status': { type: 'select', select: { name: 'In Progress' } },
            'Created': { type: 'created_time', created_time: new Date().toISOString() }
          } : undefined,
          content: includeContent ? [
            { type: 'paragraph', text: 'This is test content from the page.' }
          ] : undefined,
          children: includeChildren ? [] : undefined,
          comments: includeComments ? [] : undefined,
          metadata: {
            created_time: new Date().toISOString(),
            last_edited_time: new Date().toISOString(),
            archived: false
          }
        }
      };
    }
    
    // Get the user's Notion integration
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
    
    // Get the workspace access token
    const workspaces = integration.metadata?.workspaces || {};
    const workspace = workspaces[workspaceId];
    
    if (!workspace) {
      throw new Error(`Workspace ${workspaceId} not found in integration`);
    }
    
    // Decrypt the access token
    const encryptionKey = process.env.ENCRYPTION_KEY!;
    const accessToken = decrypt(workspace.access_token, encryptionKey);

    // Q3 — every raw `fetch` call below is wrapped in `refreshAndRetry`.
    const buildHeaders = (token: string) => ({
      'Authorization': `Bearer ${token}`,
      'Notion-Version': '2022-06-28',
      'Content-Type': 'application/json'
    });

    // Fetch page details from Notion API (Q3 wrap, principal call).
    const pageResult = await refreshAndRetry({
      provider: 'notion',
      userId: context.userId,
      accessToken,
      call: async (token) =>
        fetch(`https://api.notion.com/v1/pages/${pageId}`, {
          method: 'GET',
          headers: buildHeaders(token)
        }),
    });
    if (!pageResult.success) {
      throw new Error(pageResult.message);
    }
    const pageResponse = pageResult.data;

    if (!pageResponse.ok) {
      const error = await pageResponse.text();
      throw new Error(`Failed to fetch page details: ${error}`);
    }

    const pageData = await pageResponse.json();
    
    // Prepare the result based on output format
    const result: any = {
      id: pageData.id,
      url: pageData.url,
      workspace: workspaceId,
      workspaceName: workspace.workspace_name
    };
    
    // Extract title from properties
    if (pageData.properties) {
      for (const [propName, prop] of Object.entries(pageData.properties)) {
        if ((prop as any).type === 'title' && (prop as any).title?.length > 0) {
          result.title = (prop as any).title[0]?.plain_text || 'Untitled';
          break;
        }
      }
    }
    
    // Add data based on configuration
    if (includeProperties) {
      result.properties = pageData.properties;
    }
    
    if (includeContent) {
      // Fetch page content blocks (Q3 wrap; auxiliary best-effort).
      const blocksResult = await refreshAndRetry({
        provider: 'notion',
        userId: context.userId,
        accessToken,
        call: async (token) =>
          fetch(`https://api.notion.com/v1/blocks/${pageId}/children?page_size=100`, {
            method: 'GET',
            headers: buildHeaders(token)
          }),
      });
      if (blocksResult.success && blocksResult.data.ok) {
        const blocksData = await blocksResult.data.json();
        result.content = blocksData.results;
      }
    }

    if (includeChildren) {
      // Search for child pages (Q3 wrap; auxiliary best-effort).
      const childrenResult = await refreshAndRetry({
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
              page_size: 100
            })
          }),
      });
      if (childrenResult.success && childrenResult.data.ok) {
        const searchData = await childrenResult.data.json();
        // Filter for pages that have this page as parent
        result.children = searchData.results.filter(
          (page: any) => page.parent?.page_id === pageId
        );
      }
    }

    if (includeComments) {
      // Fetch comments (Q3 wrap; auxiliary best-effort).
      const commentsResult = await refreshAndRetry({
        provider: 'notion',
        userId: context.userId,
        accessToken,
        call: async (token) =>
          fetch(`https://api.notion.com/v1/comments?block_id=${pageId}`, {
            method: 'GET',
            headers: buildHeaders(token)
          }),
      });
      if (commentsResult.success && commentsResult.data.ok) {
        const commentsData = await commentsResult.data.json();
        result.comments = commentsData.results;
      }
    }
    
    // Add metadata
    result.metadata = {
      created_time: pageData.created_time,
      last_edited_time: pageData.last_edited_time,
      created_by: pageData.created_by,
      last_edited_by: pageData.last_edited_by,
      archived: pageData.archived,
      parent: pageData.parent,
      icon: pageData.icon,
      cover: pageData.cover
    };
    
    // Format based on output format
    switch (outputFormat) {
      case 'summary':
        return {
          success: true,
          data: {
            id: result.id,
            title: result.title,
            url: result.url,
            workspace: result.workspace,
            created: result.metadata.created_time,
            modified: result.metadata.last_edited_time
          }
        };
      
      case 'properties':
        return {
          success: true,
          data: {
            id: result.id,
            title: result.title,
            properties: result.properties
          }
        };
      
      case 'content':
        return {
          success: true,
          data: {
            id: result.id,
            title: result.title,
            content: result.content
          }
        };
      
      case 'metadata':
        return {
          success: true,
          data: {
            id: result.id,
            title: result.title,
            metadata: result.metadata
          }
        };
      
      case 'full':
      default:
        return {
          success: true,
          data: result
        };
    }
    
  } catch (error: any) {
    logger.error('Error getting Notion page details:', error);
    return {
      success: false,
      error: error.message || 'Failed to get page details'
    };
  }
}