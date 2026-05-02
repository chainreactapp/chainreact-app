import { ExecutionContext } from '@/types/workflow';
import { ActionResult } from '@/lib/workflows/actions';
import { refreshAndRetry } from '@/lib/workflows/actions/core/refreshAndRetry';

import { logger } from '@/lib/utils/logger'

/**
 * Convert a field value to Notion property format
 */
function convertToNotionProperty(field: any): any {
  const { propertyType, value } = field;

  switch (propertyType) {
    case 'title':
      return {
        title: [{ type: 'text', text: { content: value || '' } }]
      };

    case 'rich_text':
      return {
        rich_text: [{ type: 'text', text: { content: value || '' } }]
      };

    case 'number':
      return {
        number: value ? parseFloat(value) : null
      };

    case 'select':
      return {
        select: value ? { name: value } : null
      };

    case 'multi_select':
      const values = Array.isArray(value) ? value : (value ? value.split(',').map((v: string) => v.trim()) : []);
      return {
        multi_select: values.map((v: string) => ({ name: v }))
      };

    case 'date':
      return {
        date: value ? { start: value } : null
      };

    case 'checkbox':
      return {
        checkbox: Boolean(value)
      };

    case 'url':
      return {
        url: value || null
      };

    case 'email':
      return {
        email: value || null
      };

    case 'phone_number':
      return {
        phone_number: value || null
      };

    case 'people':
      const people = Array.isArray(value) ? value : [];
      return {
        people: people.map((p: any) => ({ id: p.id || p }))
      };

    case 'relation':
      const relations = Array.isArray(value) ? value : [];
      return {
        relation: relations.map((r: any) => ({ id: r.id || r }))
      };

    case 'files':
      const files = Array.isArray(value) ? value : [];
      return {
        files: files.map((f: any) => ({
          name: f.name,
          external: { url: f.url }
        }))
      };

    default:
      // For unsupported types, try rich_text as fallback
      return {
        rich_text: [{ type: 'text', text: { content: String(value || '') } }]
      };
  }
}

/**
 * Internal function to execute Notion Manage Database action
 */
async function executeNotionManageDatabaseInternal(
  context: ExecutionContext,
  config: any
): Promise<any> {
  const { operation } = config;

  // Get the Notion integration credentials using the helper function
  const { getIntegrationCredentials } = await import('@/lib/integrations/getDecryptedAccessToken');
  const credentials = await getIntegrationCredentials(context.userId, 'notion');

  if (!credentials || !credentials.accessToken) {
    throw new Error('Notion integration not found or not connected');
  }

  // Q3 — every raw `fetch` call below is wrapped in `refreshAndRetry`. The
  // helper takes a token and returns the headers built with that token, so
  // a refreshed token after a 401 propagates into the retry attempt.
  const accessToken = credentials.accessToken;
  const buildHeaders = (token: string) => ({
    'Authorization': `Bearer ${token}`,
    'Notion-Version': '2022-06-28',
    'Content-Type': 'application/json'
  });

  switch (operation) {
    case 'create':
      // Validate parentPage is provided
      if (!config.parentPage) {
        throw new Error('Parent page is required to create a database. Please select a page where the database will be created.');
      }

      // Parse custom properties if provided
      let databaseProperties: Record<string, any>
      if (config.properties) {
        try {
          // Import the property converter
          const { convertToNotionProperties, validateProperties } =
            await import('./databasePropertyTypes');

          // Parse properties from JSON
          let propertiesConfig
          if (typeof config.properties === 'string') {
            propertiesConfig = JSON.parse(config.properties)
          } else {
            propertiesConfig = config.properties
          }

          // Validate properties
          const validation = validateProperties(propertiesConfig)
          if (!validation.valid) {
            throw new Error(`Invalid properties: ${validation.errors.join(', ')}`)
          }

          // Convert to Notion format
          databaseProperties = convertToNotionProperties(propertiesConfig)
        } catch (error: any) {
          // If it's already a validation error, don't add extra message
          if (error.message.includes('Invalid properties:')) {
            throw error
          }
          // Otherwise it's a parsing error
          throw new Error(`Failed to parse properties: ${error.message}`)
        }
      } else {
        // Use default properties (just Name field)
        databaseProperties = {
          Name: {
            title: {}
          }
        }
      }

      // Create a new database
      // The difference between "Full page" and "Inline" databases:
      // - Full page: is_inline = false (default) - appears as a standalone page in the sidebar
      // - Inline: is_inline = true - embedded directly within the parent page content
      const createBody: any = {
        parent: {
          type: 'page_id',
          page_id: config.parentPage
        },
        title: [
          {
            type: 'text',
            text: {
              content: config.title || 'Untitled Database'
            }
          }
        ],
        properties: databaseProperties
      };

      // Set is_inline based on database type
      // "Inline" databases are embedded in the parent page
      // "Full page" databases appear as standalone pages (is_inline = false or omitted)
      if (config.databaseType === 'Inline') {
        createBody.is_inline = true;
      }

      const createResult = await refreshAndRetry({
        provider: 'notion',
        userId: context.userId,
        accessToken,
        call: async (token) =>
          fetch('https://api.notion.com/v1/databases', {
            method: 'POST',
            headers: buildHeaders(token),
            body: JSON.stringify(createBody)
          }),
      });
      if (!createResult.success) {
        throw new Error(createResult.message);
      }
      const createResponse = createResult.data;

      if (!createResponse.ok) {
        const error = await createResponse.json();
        throw new Error(`Failed to create database: ${error.message || createResponse.statusText}`);
      }

      return await createResponse.json();

    case 'update':
      // Check updateType to determine what to update
      if (config.updateType === 'data') {
        // Update database rows/entries
        const rowUpdates = config.databaseRows || [];
        const results = {
          updated: 0,
          added: 0,
          deleted: 0,
          errors: []
        };

        for (const row of rowUpdates) {
          try {
            if (row._action === 'delete' && row.id) {
              // Archive/delete the page (Q3 wrap).
              const deleteResult = await refreshAndRetry({
                provider: 'notion',
                userId: context.userId,
                accessToken,
                call: async (token) =>
                  fetch(`https://api.notion.com/v1/pages/${row.id}`, {
                    method: 'PATCH',
                    headers: buildHeaders(token),
                    body: JSON.stringify({ archived: true })
                  }),
              });
              if (!deleteResult.success) {
                results.errors.push(`Failed to delete row ${row.id}: ${deleteResult.message}`);
              } else {
                const deleteResponse = deleteResult.data;
                if (deleteResponse.ok) {
                  results.deleted++;
                } else {
                  const error = await deleteResponse.json();
                  results.errors.push(`Failed to delete row ${row.id}: ${error.message}`);
                }
              }
            } else if (row._action === 'add' || !row.id) {
              // Create new page in the database
              const properties: any = {};

              // Build properties from row fields
              if (row.fields) {
                for (const field of row.fields) {
                  if (field.value !== undefined && field.value !== '') {
                    // Convert field value to Notion property format
                    properties[field.name] = convertToNotionProperty(field);
                  }
                }
              }

              const createPageBody = {
                parent: { database_id: config.database },
                properties
              };

              // Q3 wrap.
              const createPageResult = await refreshAndRetry({
                provider: 'notion',
                userId: context.userId,
                accessToken,
                call: async (token) =>
                  fetch('https://api.notion.com/v1/pages', {
                    method: 'POST',
                    headers: buildHeaders(token),
                    body: JSON.stringify(createPageBody)
                  }),
              });
              if (!createPageResult.success) {
                results.errors.push(`Failed to add row: ${createPageResult.message}`);
              } else {
                const createResponse = createPageResult.data;
                if (createResponse.ok) {
                  results.added++;
                } else {
                  const error = await createResponse.json();
                  results.errors.push(`Failed to add row: ${error.message}`);
                }
              }
            } else if (row.id) {
              // Update existing page
              const properties: any = {};

              // Build properties from row fields
              if (row.fields) {
                for (const field of row.fields) {
                  // Only include fields that have been modified or have values
                  if (field.value !== undefined && !field.readOnly) {
                    properties[field.name] = convertToNotionProperty(field);
                  }
                }
              }

              // Only update if there are properties to update
              if (Object.keys(properties).length > 0) {
                const updatePageBody = {
                  properties
                };

                // Q3 wrap.
                const updatePageResult = await refreshAndRetry({
                  provider: 'notion',
                  userId: context.userId,
                  accessToken,
                  call: async (token) =>
                    fetch(`https://api.notion.com/v1/pages/${row.id}`, {
                      method: 'PATCH',
                      headers: buildHeaders(token),
                      body: JSON.stringify(updatePageBody)
                    }),
                });
                if (!updatePageResult.success) {
                  results.errors.push(`Failed to update row ${row.id}: ${updatePageResult.message}`);
                } else {
                  const updatePageResponse = updatePageResult.data;
                  if (updatePageResponse.ok) {
                    results.updated++;
                  } else {
                    const error = await updatePageResponse.json();
                    results.errors.push(`Failed to update row ${row.id}: ${error.message}`);
                  }
                }
              }
            }
          } catch (error: any) {
            results.errors.push(`Error processing row: ${error.message}`);
          }
        }

        return results;
      } else {
        // Update database metadata (title/description)
        const updateBody: any = {};

        if (config.title) {
          updateBody.title = [
            {
              type: 'text',
              text: {
                content: config.title
              }
            }
          ];
        }

        if (config.description) {
          updateBody.description = [
            {
              type: 'text',
              text: {
                content: config.description
              }
            }
          ];
        }

        // Q3 wrap.
        const updateResult = await refreshAndRetry({
          provider: 'notion',
          userId: context.userId,
          accessToken,
          call: async (token) =>
            fetch(`https://api.notion.com/v1/databases/${config.database}`, {
              method: 'PATCH',
              headers: buildHeaders(token),
              body: JSON.stringify(updateBody)
            }),
        });
        if (!updateResult.success) {
          throw new Error(updateResult.message);
        }
        const updateResponse = updateResult.data;

        if (!updateResponse.ok) {
          const error = await updateResponse.json();
          throw new Error(`Failed to update database: ${error.message || updateResponse.statusText}`);
        }

        return await updateResponse.json();
      }

    case 'find_or_create_item':
      // Import and use the find or create handler
      const { notionFindOrCreateDatabaseItem } = await import('./handlers');

      // Map config fields to handler expected format
      const findOrCreateConfig = {
        database_id: config.findOrCreateDatabase,
        search_property: config.searchProperty,
        search_value: config.searchValue,
        create_if_not_found: config.createIfNotFound,
        create_properties: config.createProperties || {}
      };

      const findOrCreateResult = await notionFindOrCreateDatabaseItem(findOrCreateConfig, context);

      if (!findOrCreateResult.success) {
        throw new Error(findOrCreateResult.message || 'Failed to find or create database item');
      }

      return findOrCreateResult.output;

    case 'archive_item':
      // Import and use the archive item handler
      const { notionArchiveDatabaseItem } = await import('./handlers');

      // Map config fields to handler expected format
      const archiveConfig = {
        item_id: config.itemToArchive
      };

      const archiveResult = await notionArchiveDatabaseItem(archiveConfig, context);

      if (!archiveResult.success) {
        throw new Error(archiveResult.message || 'Failed to archive database item');
      }

      return archiveResult.output;

    case 'restore_item':
      // Import and use the restore item handler
      const { notionRestoreDatabaseItem } = await import('./handlers');

      // Map config fields to handler expected format
      const restoreConfig = {
        item_id: config.itemToRestore
      };

      const restoreResult = await notionRestoreDatabaseItem(restoreConfig, context);

      if (!restoreResult.success) {
        throw new Error(restoreResult.message || 'Failed to restore database item');
      }

      return restoreResult.output;

    case 'sync': {
      // Delegate to the dedicated sync handler
      const { notionSyncDatabaseEntries } = await import('./handlers')
      const syncResult = await notionSyncDatabaseEntries(config, context)
      if (!syncResult.success) {
        throw new Error(syncResult.message || 'Failed to sync database entries')
      }
      return syncResult.output;
    }

    default:
      throw new Error(`Unknown operation: ${operation}`);
  }
}

/**
 * Export wrapper function for action registry
 * Converts from standard action handler signature to ExecutionContext signature
 */
export async function executeNotionManageDatabase(
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
    const result = await executeNotionManageDatabaseInternal(context, config);

    return {
      success: true,
      output: result,
      message: `Successfully executed ${config.operation} operation`
    };
  } catch (error: any) {
    logger.error('Notion Manage Database error:', {
      operation: config.operation,
      errorMessage: error.message,
      errorStack: error.stack,
      config: {
        databaseType: config.databaseType,
        parentPage: config.parentPage,
        title: config.title
      }
    });
    return {
      success: false,
      output: {},
      message: error.message || `Failed to execute ${config.operation} operation`
    };
  }
}