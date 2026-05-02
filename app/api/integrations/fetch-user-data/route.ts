import { type NextRequest, NextResponse } from "next/server"
import { jsonResponse, errorResponse, successResponse } from '@/lib/utils/api-response'
import { createClient } from "@supabase/supabase-js"
import { createAdminClient } from "@/lib/supabase/admin"
import { decrypt } from "@/lib/security/encryption"
import { getBaseUrl } from "@/lib/utils/getBaseUrl"
import { queryWithTimeout, fetchWithTimeout } from '@/lib/utils/fetch-with-timeout'

import { logger } from '@/lib/utils/logger'

// Helper to create supabase client inside handlers
const getSupabase = () => createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SECRET_KEY!
)

/**
 * Check if a provider is a Google-related provider.
 * Covers google-drive, google-sheets, google-calendar, gmail, youtube, etc.
 */
function isGoogleProvider(provider: string | undefined): boolean {
  if (!provider) return false;
  const googleProviders = ['google', 'google-drive', 'google-docs', 'google-sheets',
    'google-calendar', 'google-analytics', 'gmail', 'youtube'];
  return googleProviders.includes(provider.toLowerCase()) || provider.toLowerCase().startsWith('google');
}

// Add comprehensive error handling and fix API calls
export async function POST(req: NextRequest) {
  logger.info('🚀 [SERVER] fetch-user-data API route called')
  
  try {
    const body = await req.json();
    const { integrationId, dataType, options = {} } = body;

    logger.info('🔍 [SERVER] fetch-user-data request parsed:', { integrationId, dataType, options });

    if (!integrationId || !dataType) {
      logger.info('❌ [SERVER] Missing required parameters');
      return jsonResponse({ error: 'Missing required parameters' }, { status: 400 });
    }
    
    const gmailDataTypes = new Set([
      'gmail-recent-recipients',
      'gmail-enhanced-recipients',
      'gmail_labels',
      'gmail_recipients',
      'gmail_signatures',
      'gmail_from_addresses',
      'gmail_recent_senders',
      'gmail-contacts',
      'gmail-recent-emails',
    ]);

    const teamsDataTypes = new Set([
      'teams_teams',
      'teams_channels',
      'teams_chats',
    ]);

    // Route Teams-specific data requests through Teams API
    if (teamsDataTypes.has(dataType)) {
      logger.info('🔍 [SERVER] Routing Teams data request', { dataType, integrationId, options });

      const baseUrl = req.nextUrl.origin;
      const teamsApiResponse = await fetchWithTimeout(`${baseUrl}/api/integrations/teams/data`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          integrationId,
          dataType,
          params: options,
        }),
      }, 30000); // 30 second timeout for Teams data

      if (!teamsApiResponse.ok) {
        const errorText = await teamsApiResponse.text();
        logger.error('❌ [SERVER] Teams API error:', errorText);
        return jsonResponse({ error: errorText || 'Failed to load Teams data' }, { status: teamsApiResponse.status });
      }

      const teamsData = await teamsApiResponse.json();
      return jsonResponse(teamsData);
    }

    // Route Gmail-specific data requests (including enhanced recipients and labels) through Gmail API
    if (gmailDataTypes.has(dataType)) {
      logger.info('🔍 [SERVER] Routing Gmail data request', { dataType, integrationId });

      try {
        // Fetch the integration initiating the request (with timeout protection)
        const { data: requestingIntegration, error: requestingError } = await queryWithTimeout(
          getSupabase()
            .from('integrations')
            .select('*')
            .eq('id', integrationId)
            .single(),
          8000
        );

        if (requestingError || !requestingIntegration) {
          logger.error('❌ [SERVER] Requesting integration not found:', requestingError);
          return jsonResponse({ error: 'Requesting integration not found' }, { status: 404 });
        }

        // Determine which Gmail integration to use
        let gmailIntegration = requestingIntegration.provider === 'gmail' ? requestingIntegration : null;

        if (!gmailIntegration) {
          logger.info('🔍 [SERVER] Resolving Gmail integration for user', {
            userId: requestingIntegration.user_id,
            requestingProvider: requestingIntegration.provider,
            dataType,
          });

          const { data: resolvedGmailIntegration, error: gmailError } = await queryWithTimeout(
            getSupabase()
              .from('integrations')
              .select('*')
              .eq('user_id', requestingIntegration.user_id)
              .eq('provider', 'gmail')
              .in('status', ['connected', 'active', 'authorized', 'valid', 'ready', 'ok'])
              .maybeSingle(),
            8000
          );

          if (gmailError) {
            logger.error('❌ [SERVER] Gmail integration lookup error:', gmailError);
          }

          if (!resolvedGmailIntegration) {
            logger.error('❌ [SERVER] Gmail integration not found for user or not connected:', {
              userId: requestingIntegration.user_id,
              requestingProvider: requestingIntegration.provider
            });
            return jsonResponse({ error: 'A connected Gmail integration is required to load Gmail data.' }, { status: 404 });
          }

          gmailIntegration = resolvedGmailIntegration;
          logger.info('✅ [SERVER] Found Gmail integration for cross-provider request:', gmailIntegration.id);
        }

        const baseUrl = req.nextUrl.origin;
        const gmailApiResponse = await fetchWithTimeout(`${baseUrl}/api/integrations/gmail/data`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            integrationId: gmailIntegration.id,
            dataType,
            options,
          }),
        }, 30000); // 30 second timeout for Gmail data

        if (!gmailApiResponse.ok) {
          const error = await gmailApiResponse.json();
          logger.error(`❌ [SERVER] Gmail API error:`, error);
          return jsonResponse(error, { status: gmailApiResponse.status });
        }

        const gmailResult = await gmailApiResponse.json();
        logger.info(`✅ [SERVER] Gmail API completed for ${dataType}, result length:`, gmailResult.data?.length || 'unknown');

        return jsonResponse(gmailResult);

      } catch (error: any) {
        logger.error(`❌ [SERVER] Gmail API routing error:`, error);
        return jsonResponse({ error: 'Failed to route Gmail request' }, { status: 500 });
      }
    }

    // Get integration by ID
    const { data: integration, error: integrationError } = await getSupabase()
      .from('integrations')
      .select('*')
      .eq('id', integrationId)
      .single();

    if (integrationError || !integration) {
      logger.error('❌ [SERVER] Integration not found:', integrationError);
      return jsonResponse({ error: 'Integration not found' }, { status: 404 });
    }

    // Handle Gmail recent recipients with original working method (no contacts permission needed)
    if (integration.provider === 'gmail' && dataType === 'gmail-recent-recipients') {
      logger.info(`🔄 [SERVER] Using original Gmail recipients method`);
      
      try {
        // Validate integration has access token
        if (!integration.access_token) {
          throw new Error("Gmail authentication required. Please reconnect your account.")
        }

        // Decrypt the access token
        const { decrypt } = await import('@/lib/security/encryption')
        const accessToken = decrypt(integration.access_token)

        // Get recent sent messages (last 50) - original working approach
        const messagesResponse = await fetch(
          `https://gmail.googleapis.com/gmail/v1/users/me/messages?labelIds=SENT&maxResults=50`,
          {
            headers: {
              Authorization: `Bearer ${accessToken}`,
              "Content-Type": "application/json",
            },
          }
        )

        if (!messagesResponse.ok) {
          if (messagesResponse.status === 401) {
            throw new Error("Gmail authentication expired. Please reconnect your account.")
          }
          const errorText = await messagesResponse.text().catch(() => "Unknown error")
          throw new Error(`Gmail API error: ${messagesResponse.status} - ${errorText}`)
        }

        const messagesData = await messagesResponse.json()
        const messages = messagesData.messages || []

        if (messages.length === 0) {
          return jsonResponse({ data: [] })
        }

        // Get detailed information for each message
        const messageDetails = await Promise.all(
          messages.slice(0, 25).map(async (message: { id: string }) => {
            try {
              const response = await fetch(
                `https://gmail.googleapis.com/gmail/v1/users/me/messages/${message.id}?format=metadata&metadataHeaders=To&metadataHeaders=Cc&metadataHeaders=Bcc`,
                {
                  headers: {
                    Authorization: `Bearer ${accessToken}`,
                    "Content-Type": "application/json",
                  },
                }
              )

              if (!response.ok) return null
              
              const data = await response.json()
              return data.payload?.headers || []
            } catch (error) {
              logger.warn(`Failed to fetch message ${message.id}:`, error)
              return null
            }
          })
        )

        // Extract all recipient email addresses
        const recipients = new Map<string, { email: string; name?: string; frequency: number }>()

        messageDetails
          .filter(headers => headers !== null)
          .forEach(headers => {
            headers.forEach((header: { name: string; value: string }) => {
              if (['To', 'Cc', 'Bcc'].includes(header.name)) {
                // Parse email addresses from the header value
                const emailRegex = /(?:"?([^"<>]+?)"?\s*)?<([^<>]+)>|([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/g
                let match

                while ((match = emailRegex.exec(header.value)) !== null) {
                  const name = match[1]?.trim()
                  const email = (match[2] || match[3])?.trim().toLowerCase()

                  if (email && email.includes('@')) {
                    const existing = recipients.get(email)
                    if (existing) {
                      existing.frequency += 1
                    } else {
                      recipients.set(email, {
                        email,
                        name: name || undefined,
                        frequency: 1
                      })
                    }
                  }
                }
              }
            })
          })

        // Convert to array and sort by frequency
        const recipientArray = Array.from(recipients.values())
          .sort((a, b) => b.frequency - a.frequency)
          .slice(0, 20)
          .map(recipient => ({
            value: recipient.email,
            label: recipient.name ? `${recipient.name} <${recipient.email}>` : recipient.email,
            email: recipient.email,
            name: recipient.name
          }))

        logger.info(`✅ [SERVER] Original Gmail method: Found ${recipientArray.length} recipients`)
        return jsonResponse({ data: recipientArray })

      } catch (error: any) {
        logger.error(`❌ [SERVER] Gmail recipients error:`, error)
        return jsonResponse({ 
          error: error.message || 'Failed to get Gmail recipients' 
        }, { status: 500 })
      }
    }

    // Route Google (Drive/Docs/Sheets) requests to dedicated Google data API
    // Covers google-drive, google-sheets, gmail, youtube, etc.
    if (isGoogleProvider(integration.provider)) {
      // Check if the dataType is a Google-related data type
      if (dataType.startsWith('google-') || 
          dataType === 'google-calendars' || 
          dataType === 'google-contacts') {
        logger.info(`🔄 [SERVER] Routing Google request to dedicated API: ${dataType} (provider: ${integration.provider})`);
        
        try {
          const baseUrl = req.nextUrl.origin
          const googleApiResponse = await fetch(`${baseUrl}/api/integrations/google/data`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              integrationId,
              dataType,
              options
            })
          });

          if (!googleApiResponse.ok) {
            const error = await googleApiResponse.json();
            logger.error(`❌ [SERVER] Google API error:`, error);
            return jsonResponse(error, { status: googleApiResponse.status });
          }

          const googleResult = await googleApiResponse.json();
          logger.info(`✅ [SERVER] Google API completed for ${dataType}, result length:`, googleResult.data?.length || 'unknown');

          return jsonResponse(googleResult);
        } catch (error: any) {
          logger.error(`❌ [SERVER] Google API routing error:`, error);
          return jsonResponse({ error: 'Failed to route Google request' }, { status: 500 });
        }
      }
    }

    // Route other Gmail requests to dedicated Gmail data API
    if (integration.provider === 'gmail' && (
      dataType === 'gmail_labels' ||
      dataType === 'gmail_recipients' ||
      dataType === 'gmail_signatures'
    )) {
      logger.info(`🔄 [SERVER] Routing Gmail request to dedicated API: ${dataType}`);
      
      try {
        const baseUrl = req.nextUrl.origin
        const gmailApiResponse = await fetch(`${baseUrl}/api/integrations/gmail/data`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            integrationId,
            dataType,
            options
          })
        });

        if (!gmailApiResponse.ok) {
          const error = await gmailApiResponse.json();
          logger.error(`❌ [SERVER] Gmail API error:`, error);
          return jsonResponse(error, { status: gmailApiResponse.status });
        }

        const gmailResult = await gmailApiResponse.json();
        logger.info(`✅ [SERVER] Gmail API completed for ${dataType}, result length:`, gmailResult.data?.length || 'unknown');

        // Return the Gmail API response directly (it's already in the correct format)
        return jsonResponse(gmailResult);
        
      } catch (error: any) {
        logger.error(`❌ [SERVER] Gmail API routing error:`, error);
        return jsonResponse({ error: 'Failed to route Gmail request' }, { status: 500 });
      }
    }

    // Route Slack requests to dedicated Slack data API
    if (integration.provider === 'slack' && (
      dataType === 'slack_channels' ||
      dataType === 'slack_users'
    )) {
      logger.info(`🔄 [SERVER] Routing Slack request to dedicated API: ${dataType}`);
      
      try {
        const baseUrl = req.nextUrl.origin
        const slackApiResponse = await fetch(`${baseUrl}/api/integrations/slack/data`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            integrationId,
            dataType,
            options
          })
        });

        if (!slackApiResponse.ok) {
          const error = await slackApiResponse.json();
          logger.error(`❌ [SERVER] Slack API error:`, error);
          return jsonResponse(error, { status: slackApiResponse.status });
        }

        const slackResult = await slackApiResponse.json();
        logger.info(`✅ [SERVER] Slack API completed for ${dataType}, result length:`, slackResult.data?.length || 'unknown');

        // Return the Slack API response directly (it's already in the correct format)
        return jsonResponse(slackResult);
        
      } catch (error: any) {
        logger.error(`❌ [SERVER] Slack API routing error:`, error);
        return jsonResponse({ error: 'Failed to route Slack request' }, { status: 500 });
      }
    }

    // Route Google requests to dedicated Google data API
    if (isGoogleProvider(integration.provider) && (
      dataType === 'google-drive-folders' ||
      dataType === 'google-drive-files' ||
      dataType === 'google-drive-files-and-folders' ||
      dataType === 'google-drive-search-preview' ||
      dataType === 'google-drive-list-files-preview' ||
      dataType === 'google-docs-documents' ||
      dataType === 'google-docs-content' ||
      dataType === 'google-calendars' ||
      dataType === 'google-calendar-events' ||
      dataType === 'google-contacts' ||
      dataType === 'google-sheets_spreadsheets' ||
      dataType === 'google-sheets_sheets' ||
      dataType === 'google-sheets_columns' ||
      dataType === 'google-sheets_column_values' ||
      dataType === 'google-sheets_enhanced-preview'
    )) {
      logger.info(`🔄 [SERVER] Routing Google request to dedicated API:`, {
        dataType,
        integrationId,
        provider: integration.provider,
        status: integration.status,
        options
      });
      
      try {
        const baseUrl = req.nextUrl.origin
        const requestPayload = {
          integrationId,
          dataType,
          options
        }
        
        logger.info(`🚀 [SERVER] Making Google API request:`, requestPayload);
        
        const googleApiResponse = await fetch(`${baseUrl}/api/integrations/google/data`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(requestPayload)
        });

        logger.info(`📡 [SERVER] Google API response:`, {
          status: googleApiResponse.status,
          statusText: googleApiResponse.statusText,
          ok: googleApiResponse.ok,
          headers: Object.fromEntries(googleApiResponse.headers.entries())
        });

        if (!googleApiResponse.ok) {
          let error;
          try {
            error = await googleApiResponse.json();
          } catch (parseError) {
            const errorText = await googleApiResponse.text().catch(() => 'Unknown error');
            error = { error: `Failed to parse error response: ${errorText}` };
          }
          logger.error(`❌ [SERVER] Google API error:`, {
            status: googleApiResponse.status,
            error,
            requestPayload
          });
          return jsonResponse(error, { status: googleApiResponse.status });
        }

        const googleResult = await googleApiResponse.json();
        logger.info(`✅ [SERVER] Google API completed for ${dataType}:`, {
          resultLength: googleResult.data?.length || 'unknown',
          success: googleResult.success,
          hasData: !!googleResult.data
        });

        // Return the Google API response directly (it's already in the correct format)
        return jsonResponse(googleResult);
        
      } catch (error: any) {
        logger.error(`❌ [SERVER] Google API routing error:`, {
          error: error.message,
          stack: error.stack,
          dataType,
          integrationId
        });
        return jsonResponse({ error: 'Failed to route Google request' }, { status: 500 });
      }
    }

    // Route Notion requests to dedicated Notion data API
    if (integration.provider === 'notion' && (
      dataType === 'notion_users' ||
      dataType === 'notion_templates' ||
      dataType === 'notion_databases' ||
      dataType === 'notion_pages' ||
      dataType === 'notion_workspaces' ||
      dataType === 'notion_database_properties'
    )) {
      logger.info(`🔄 [SERVER] Routing Notion request to dedicated API: ${dataType}`);
      
      try {
        const baseUrl = req.nextUrl.origin
        const notionApiResponse = await fetch(`${baseUrl}/api/integrations/notion/data`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            integrationId,
            dataType,
            options
          })
        });

        if (!notionApiResponse.ok) {
          const error = await notionApiResponse.json();
          logger.error(`❌ [SERVER] Notion API error:`, error);
          return jsonResponse(error, { status: notionApiResponse.status });
        }

        const notionResult = await notionApiResponse.json();
        logger.info(`✅ [SERVER] Notion API completed for ${dataType}, result length:`, notionResult.data?.length || 'unknown');
        
        // Return the Notion API response directly (it's already in the correct format)
        return jsonResponse(notionResult);
        
      } catch (error: any) {
        logger.error(`❌ [SERVER] Notion API routing error:`, error);
        return jsonResponse({ error: 'Failed to route Notion request' }, { status: 500 });
      }
    }

    // Route Discord requests to dedicated Discord data API
    if (integration.provider === 'discord' && (
      dataType === 'discord_guilds' ||
      dataType === 'discord_channels' ||
      dataType === 'discord_categories' ||
      dataType === 'discord_members' ||
      dataType === 'discord_roles' ||
      dataType === 'discord_messages' ||
      dataType === 'discord_reactions' ||
      dataType === 'discord_banned_users' ||
      dataType === 'discord_users'
    )) {
      logger.info(`🔄 [SERVER] Routing Discord request to dedicated API: ${dataType}`);
      
      try {
        const baseUrl = req.nextUrl.origin
        const discordApiResponse = await fetch(`${baseUrl}/api/integrations/discord/data`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            integrationId,
            dataType,
            options
          })
        });

        if (!discordApiResponse.ok) {
          const error = await discordApiResponse.json();
          logger.error(`❌ [SERVER] Discord API error:`, error);
          return jsonResponse(error, { status: discordApiResponse.status });
        }

        const discordResult = await discordApiResponse.json();
        logger.info(`✅ [SERVER] Discord API completed for ${dataType}, result length:`, discordResult.data?.length || 'unknown');
        
        // Return the Discord API response directly (it's already in the correct format)
        return jsonResponse(discordResult);
        
      } catch (error: any) {
        logger.error(`❌ [SERVER] Discord API routing error:`, error);
        return jsonResponse({ error: 'Failed to route Discord request' }, { status: 500 });
      }
    }

    // Route Facebook requests to dedicated Facebook data API
    if (integration.provider === 'facebook' && (
      dataType === 'facebook_pages'
    )) {
      logger.info(`🔄 [SERVER] Routing Facebook request to dedicated API: ${dataType}`);
      
      try {
        const baseUrl = req.nextUrl.origin
        const facebookApiResponse = await fetch(`${baseUrl}/api/integrations/facebook/data`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            integrationId,
            dataType,
            options
          })
        });

        if (!facebookApiResponse.ok) {
          const error = await facebookApiResponse.json();
          logger.error(`❌ [SERVER] Facebook API error:`, error);
          return jsonResponse(error, { status: facebookApiResponse.status });
        }

        const facebookResult = await facebookApiResponse.json();
        logger.info(`✅ [SERVER] Facebook API completed for ${dataType}, result length:`, facebookResult.data?.length || 'unknown');
        
        // Return the Facebook API response directly (it's already in the correct format)
        return jsonResponse(facebookResult);
        
      } catch (error: any) {
        logger.error(`❌ [SERVER] Facebook API routing error:`, error);
        return jsonResponse({ error: 'Failed to route Facebook request' }, { status: 500 });
      }
    }

    // Route Twitter requests to dedicated Twitter data API
    if (integration.provider === 'twitter' && (
      dataType === 'twitter_mentions'
    )) {
      logger.info(`🔄 [SERVER] Routing Twitter request to dedicated API: ${dataType}`);
      
      try {
        const baseUrl = req.nextUrl.origin
        const twitterApiResponse = await fetch(`${baseUrl}/api/integrations/twitter/data`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            integrationId,
            dataType,
            options
          })
        });

        if (!twitterApiResponse.ok) {
          const error = await twitterApiResponse.json();
          logger.error(`❌ [SERVER] Twitter API error:`, error);
          return jsonResponse(error, { status: twitterApiResponse.status });
        }

        const twitterResult = await twitterApiResponse.json();
        logger.info(`✅ [SERVER] Twitter API completed for ${dataType}, result length:`, twitterResult.data?.length || 'unknown');
        
        // Return the Twitter API response directly (it's already in the correct format)
        return jsonResponse(twitterResult);
        
      } catch (error: any) {
        logger.error(`❌ [SERVER] Twitter API routing error:`, error);
        return jsonResponse({ error: 'Failed to route Twitter request' }, { status: 500 });
      }
    }

    // OneNote integration delegation
    if ((
      dataType === 'onenote_notebooks' ||
      dataType === 'onenote_sections' ||
      dataType === 'onenote_pages'
    )) {
      logger.info(`🔄 [SERVER] Routing OneNote request to dedicated API: ${dataType}`);
      
      try {
        const baseUrl = req.nextUrl.origin
        const oneNoteApiResponse = await fetch(`${baseUrl}/api/integrations/onenote/data`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            integrationId,
            dataType,
            options
          })
        });

        if (!oneNoteApiResponse.ok) {
          const error = await oneNoteApiResponse.json();
          logger.error(`❌ [SERVER] OneNote API error:`, error);
          return jsonResponse(error, { status: oneNoteApiResponse.status });
        }

        const oneNoteResult = await oneNoteApiResponse.json();
        logger.info(`✅ [SERVER] OneNote API success:`, {
          dataType,
          resultCount: oneNoteResult.data?.length || 0
        });

        // Return the OneNote API response directly (it's already in the correct format)
        return jsonResponse(oneNoteResult);
        
      } catch (error: any) {
        logger.error(`❌ [SERVER] OneNote API routing error:`, error);
        return jsonResponse({ error: 'Failed to route OneNote request' }, { status: 500 });
      }
    }

    // Outlook integration delegation
    if ((
      dataType === 'outlook_folders' ||
      dataType === 'outlook_messages' ||
      dataType === 'outlook_contacts' ||
      dataType === 'outlook_calendar_events' ||
      dataType === 'outlook_calendars' ||
      dataType === 'outlook_signatures'
    )) {
      logger.info(`🔄 [SERVER] Routing Outlook request to dedicated API: ${dataType}`);
      
      try {
        const baseUrl = req.nextUrl.origin
        const outlookApiResponse = await fetch(`${baseUrl}/api/integrations/outlook/data`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            integrationId,
            dataType,
            options
          })
        });

        if (!outlookApiResponse.ok) {
          const error = await outlookApiResponse.json();
          logger.error(`❌ [SERVER] Outlook API error:`, error);
          return jsonResponse(error, { status: outlookApiResponse.status });
        }

        const outlookResult = await outlookApiResponse.json();
        logger.info(`✅ [SERVER] Outlook API success:`, {
          dataType,
          resultCount: outlookResult.data?.length || 0
        });

        // Return the Outlook API response directly (it's already in the correct format)
        return jsonResponse(outlookResult);
        
      } catch (error: any) {
        logger.error(`❌ [SERVER] Outlook API routing error:`, error);
        return jsonResponse({ error: 'Failed to route Outlook request' }, { status: 500 });
      }
    }

    // HubSpot integration delegation
    if ((
      dataType === 'hubspot_contacts' ||
      dataType === 'hubspot_companies' ||
      dataType === 'hubspot_deals' ||
      dataType === 'hubspot_pipelines' ||
      dataType === 'hubspot_deal_stages' ||
      dataType === 'hubspot_owners' ||
      dataType === 'hubspot_contact_properties' ||
      dataType === 'hubspot_deal_properties' ||
      dataType === 'hubspot_products' ||
      dataType === 'hubspot_line_items'
    )) {
      logger.info(`🔄 [SERVER] Routing HubSpot request to dedicated API: ${dataType}`);
      
      try {
        const baseUrl = req.nextUrl.origin
        const hubspotApiResponse = await fetch(`${baseUrl}/api/integrations/hubspot/data`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            integrationId,
            dataType,
            options
          })
        });

        if (!hubspotApiResponse.ok) {
          const error = await hubspotApiResponse.json();
          logger.error(`❌ [SERVER] HubSpot API error:`, error);
          return jsonResponse(error, { status: hubspotApiResponse.status });
        }

        const hubspotResult = await hubspotApiResponse.json();
        logger.info(`✅ [SERVER] HubSpot API success:`, {
          dataType,
          resultCount: hubspotResult.data?.length || 0
        });

        // Return the HubSpot API response directly (it's already in the correct format)
        return jsonResponse(hubspotResult);
        
      } catch (error: any) {
        logger.error(`❌ [SERVER] HubSpot API routing error:`, error);
        return jsonResponse({ error: 'Failed to route HubSpot request' }, { status: 500 });
      }
    }

    // Airtable integration delegation
    if ((
      dataType === 'airtable_bases' ||
      dataType === 'airtable_tables' ||
      dataType === 'airtable_user_records' ||
      dataType === 'airtable_feedback_records' ||
      dataType === 'airtable_task_records' ||
      dataType === 'airtable_project_records' ||
      dataType === 'airtable_fields' ||
      dataType === 'airtable_field_values' ||
      dataType === 'airtable_records' ||
      dataType === 'airtable_attachment_fields'
    )) {
      logger.info(`🔄 [SERVER] Routing Airtable request to dedicated API: ${dataType}`);
      
      try {
        const baseUrl = req.nextUrl.origin
        const airtableApiResponse = await fetch(`${baseUrl}/api/integrations/airtable/data`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            integrationId,
            dataType,
            options
          })
        });

        if (!airtableApiResponse.ok) {
          const error = await airtableApiResponse.json();
          logger.error(`❌ [SERVER] Airtable API error:`, error);
          return jsonResponse(error, { status: airtableApiResponse.status });
        }

        const airtableResult = await airtableApiResponse.json();
        logger.info(`✅ [SERVER] Airtable API success:`, {
          dataType,
          resultCount: airtableResult.data?.length || 0
        });

        // Return the Airtable API response directly (it's already in the correct format)
        return jsonResponse(airtableResult);
        
      } catch (error: any) {
        logger.error(`❌ [SERVER] Airtable API routing error:`, error);
        return jsonResponse({ error: 'Failed to route Airtable request' }, { status: 500 });
      }
    }

    // Trello integration delegation
    if ((
      dataType === 'trello-boards' ||
      dataType === 'trello-lists' ||
      dataType === 'trello-board-templates' ||
      dataType === 'trello-list-templates' ||
      dataType === 'trello-card-templates' ||
      dataType === 'trello_lists' ||
      dataType === 'trello_cards'
    )) {
      logger.info(`🔄 [SERVER] Routing Trello request to dedicated API: ${dataType}`);
      
      try {
        const baseUrl = req.nextUrl.origin
        const trelloApiResponse = await fetch(`${baseUrl}/api/integrations/trello/data`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            integrationId,
            dataType,
            options
          })
        });

        if (!trelloApiResponse.ok) {
          const error = await trelloApiResponse.json();
          logger.error(`❌ [SERVER] Trello API error:`, error);
          return jsonResponse(error, { status: trelloApiResponse.status });
        }

        const trelloResult = await trelloApiResponse.json();
        logger.info(`✅ [SERVER] Trello API success:`, {
          dataType,
          resultCount: trelloResult.data?.length || 0
        });

        // Return the Trello API response directly (it's already in the correct format)
        return jsonResponse(trelloResult);
        
      } catch (error: any) {
        logger.error(`❌ [SERVER] Trello API routing error:`, error);
        return jsonResponse({ error: 'Failed to route Trello request' }, { status: 500 });
      }
    }

    // Microsoft Excel integration delegation
    if ((
      dataType === 'microsoft-excel_workbooks' ||
      dataType === 'microsoft-excel_worksheets' ||
      dataType === 'microsoft-excel_columns' ||
      dataType === 'microsoft-excel_column_values' ||
      dataType === 'microsoft-excel_folders' ||
      dataType === 'microsoft-excel_data_preview' ||
      dataType.startsWith('microsoft-excel_')
    )) {
      logger.info(`🔄 [SERVER] Routing Microsoft Excel request to dedicated API: ${dataType}`);

      try {
        const baseUrl = req.nextUrl.origin

        // Remove the 'microsoft-excel_' prefix to get the actual data type
        const excelDataType = dataType.replace('microsoft-excel_', '');

        const excelApiResponse = await fetch(`${baseUrl}/api/integrations/microsoft-excel/data`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            integrationId,
            dataType: excelDataType,
            options
          })
        });

        if (!excelApiResponse.ok) {
          const error = await excelApiResponse.json();
          logger.error(`❌ [SERVER] Microsoft Excel API error:`, error);
          return jsonResponse(error, { status: excelApiResponse.status });
        }

        const excelResult = await excelApiResponse.json();
        logger.info(`✅ [SERVER] Microsoft Excel API success:`, {
          dataType,
          resultCount: excelResult.data?.length || 0
        });

        // Return the Excel API response directly (it's already in the correct format)
        return jsonResponse(excelResult);

      } catch (error) {
        logger.error(`❌ [SERVER] Microsoft Excel API routing error:`, error);
        return jsonResponse({ error: 'Failed to route Microsoft Excel request' }, { status: 500 });
      }
    }

    // OneDrive integration delegation
    if ((
      dataType === 'onedrive-folders' ||
      dataType === 'onedrive-files'
    )) {
      logger.info(`🔄 [SERVER] Routing OneDrive request to dedicated API: ${dataType}`);
      
      try {
        const baseUrl = req.nextUrl.origin
        const onedriveApiResponse = await fetch(`${baseUrl}/api/integrations/onedrive/data`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            integrationId,
            dataType,
            options
          })
        });

        if (!onedriveApiResponse.ok) {
          const error = await onedriveApiResponse.json();
          logger.error(`❌ [SERVER] OneDrive API error:`, error);
          return jsonResponse(error, { status: onedriveApiResponse.status });
        }

        const onedriveResult = await onedriveApiResponse.json();
        logger.info(`✅ [SERVER] OneDrive API success:`, {
          dataType,
          resultCount: onedriveResult.data?.length || 0
        });

        // Return the OneDrive API response directly (it's already in the correct format)
        return jsonResponse(onedriveResult);
        
      } catch (error: any) {
        logger.error(`❌ [SERVER] OneDrive API routing error:`, error);
        return jsonResponse({ error: 'Failed to route OneDrive request' }, { status: 500 });
      }
    }

    // Gumroad integration delegation
    if ((
      dataType === 'gumroad_products'
    )) {
      logger.info(`🔄 [SERVER] Routing Gumroad request to dedicated API: ${dataType}`);
      
      try {
        const baseUrl = req.nextUrl.origin
        const gumroadApiResponse = await fetch(`${baseUrl}/api/integrations/gumroad/data`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            integrationId,
            dataType,
            options
          })
        });

        if (!gumroadApiResponse.ok) {
          const error = await gumroadApiResponse.json();
          logger.error(`❌ [SERVER] Gumroad API error:`, error);
          return jsonResponse(error, { status: gumroadApiResponse.status });
        }

        const gumroadResult = await gumroadApiResponse.json();
        logger.info(`✅ [SERVER] Gumroad API success:`, {
          dataType,
          resultCount: gumroadResult.data?.length || 0
        });

        // Return the Gumroad API response directly (it's already in the correct format)
        return jsonResponse(gumroadResult);
        
      } catch (error: any) {
        logger.error(`❌ [SERVER] Gumroad API routing error:`, error);
        return jsonResponse({ error: 'Failed to route Gumroad request' }, { status: 500 });
      }
    }

    // Blackbaud integration delegation
    if ((
      dataType === 'blackbaud_constituents'
    )) {
      logger.info(`🔄 [SERVER] Routing Blackbaud request to dedicated API: ${dataType}`);
      
      try {
        const baseUrl = req.nextUrl.origin
        const blackbaudApiResponse = await fetch(`${baseUrl}/api/integrations/blackbaud/data`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            integrationId,
            dataType,
            options
          })
        });

        if (!blackbaudApiResponse.ok) {
          const error = await blackbaudApiResponse.json();
          logger.error(`❌ [SERVER] Blackbaud API error:`, error);
          return jsonResponse(error, { status: blackbaudApiResponse.status });
        }

        const blackbaudResult = await blackbaudApiResponse.json();
        logger.info(`✅ [SERVER] Blackbaud API success:`, {
          dataType,
          resultCount: blackbaudResult.data?.length || 0
        });

        // Return the Blackbaud API response directly (it's already in the correct format)
        return jsonResponse(blackbaudResult);
        
      } catch (error: any) {
        logger.error(`❌ [SERVER] Blackbaud API routing error:`, error);
        return jsonResponse({ error: 'Failed to route Blackbaud request' }, { status: 500 });
      }
    }

    // Dropbox integration delegation
    if ((
      dataType === 'dropbox-folders'
    )) {
      logger.info(`🔄 [SERVER] Routing Dropbox request to dedicated API: ${dataType}`);
      
      try {
        const baseUrl = req.nextUrl.origin
        const dropboxApiResponse = await fetch(`${baseUrl}/api/integrations/dropbox/data`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            integrationId,
            dataType,
            options
          })
        });

        if (!dropboxApiResponse.ok) {
          const error = await dropboxApiResponse.json();
          logger.error(`❌ [SERVER] Dropbox API error:`, error);
          return jsonResponse(error, { status: dropboxApiResponse.status });
        }

        const dropboxResult = await dropboxApiResponse.json();
        logger.info(`✅ [SERVER] Dropbox API success:`, {
          dataType,
          resultCount: dropboxResult.data?.length || 0
        });

        // Return the Dropbox API response directly (it's already in the correct format)
        return jsonResponse(dropboxResult);
        
      } catch (error: any) {
        logger.error(`❌ [SERVER] Dropbox API routing error:`, error);
        return jsonResponse({ error: 'Failed to route Dropbox request' }, { status: 500 });
      }
    }

    // Box integration delegation
    if ((
      dataType === 'box-folders'
    )) {
      logger.info(`🔄 [SERVER] Routing Box request to dedicated API: ${dataType}`);

      try {
        const baseUrl = req.nextUrl.origin
        const boxApiResponse = await fetch(`${baseUrl}/api/integrations/box/data`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            integrationId,
            dataType,
            options
          })
        });

        if (!boxApiResponse.ok) {
          const error = await boxApiResponse.json();
          logger.error(`❌ [SERVER] Box API error:`, error);
          return jsonResponse(error, { status: boxApiResponse.status });
        }

        const boxResult = await boxApiResponse.json();
        logger.info(`✅ [SERVER] Box API success:`, {
          dataType,
          resultCount: boxResult.data?.length || 0
        });

        // Return the Box API response directly (it's already in the correct format)
        return jsonResponse(boxResult);

      } catch (error: any) {
        logger.error(`❌ [SERVER] Box API routing error:`, error);
        return jsonResponse({ error: 'Failed to route Box request' }, { status: 500 });
      }
    }

    // Stripe integration delegation
    if ((
      dataType === 'stripe_customers' ||
      dataType === 'stripe_subscriptions' ||
      dataType.startsWith('stripe_')
    )) {
      logger.info(`🔄 [SERVER] Routing Stripe request to dedicated API: ${dataType}`, {
        integrationId,
        options
      });

      try {
        const baseUrl = req.nextUrl.origin
        const stripeApiResponse = await fetch(`${baseUrl}/api/integrations/stripe/data`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            integrationId,
            dataType,
            options
          })
        });

        logger.info(`📡 [SERVER] Stripe API response status:`, {
          status: stripeApiResponse.status,
          ok: stripeApiResponse.ok
        });

        if (!stripeApiResponse.ok) {
          const error = await stripeApiResponse.json();
          logger.error(`❌ [SERVER] Stripe API error:`, error);
          return jsonResponse(error, { status: stripeApiResponse.status });
        }

        const stripeResult = await stripeApiResponse.json();
        logger.info(`✅ [SERVER] Stripe API success:`, {
          dataType,
          resultCount: stripeResult.data?.length || 0,
          sampleData: stripeResult.data?.slice(0, 2)
        });

        // Return the Stripe API response directly (it's already in the correct format)
        return jsonResponse(stripeResult);

      } catch (error: any) {
        logger.error(`❌ [SERVER] Stripe API routing error:`, error);
        return jsonResponse({ error: 'Failed to route Stripe request' }, { status: 500 });
      }
    }

    // No dedicated provider API matched the dataType — return 400.
    // (A legacy generic-fetcher map used to live here but was always empty;
    // every provider routes through its own /data/[dataType] endpoint.)
    logger.error(`❌ [SERVER] No data fetcher found for ${dataType}`, {
      dataType,
      integration: integration?.provider,
    });
    return jsonResponse({ error: `Unsupported data type: ${dataType}` }, { status: 400 });
  } catch (error: any) {
    logger.error('❌ [SERVER] Unexpected error in fetch-user-data:', {
      message: error.message,
      stack: error.stack,
      name: error.name
    });
    return jsonResponse({ 
      error: error.message || 'Internal server error',
      type: 'server_error'
    }, { status: 500 });
  }
}

// Helper functions
function getPageTitle(page: any): string {
  // First, try the standard title property
  if (page.properties?.title?.title?.[0]?.plain_text) {
    return page.properties.title.title[0].plain_text
  }
  
  // Try the Name property (common alternative)
  if (page.properties?.Name?.title?.[0]?.plain_text) {
    return page.properties.Name.title[0].plain_text
  }
  
  // Search through all properties for any title-like field
  if (page.properties) {
    for (const [key, prop] of Object.entries(page.properties)) {
      const typedProp = prop as any
      
      // Check for title arrays
      if (typedProp.title && Array.isArray(typedProp.title) && typedProp.title.length > 0) {
        const titleText = typedProp.title[0].plain_text
        if (titleText && titleText.trim() !== '') {
          return titleText
        }
      }
      
      // Check for rich_text arrays (another common title format)
      if (typedProp.rich_text && Array.isArray(typedProp.rich_text) && typedProp.rich_text.length > 0) {
        const richText = typedProp.rich_text[0].plain_text
        if (richText && richText.trim() !== '') {
          return richText
        }
      }
    }
  }
  
  // Fallback
  return 'Untitled'
}

// Discord channel permission cache
const channelPermissionCache = new Map<string, { accessible: boolean, timestamp: number }>()
const CACHE_DURATION = 5 * 60 * 1000 // 5 minutes

async function checkChannelPermissions(channelName: string, botToken: string): Promise<boolean> {
  const cacheKey = `${channelName}`
  const cached = channelPermissionCache.get(cacheKey)
  
  // Return cached result if still valid
  if (cached && Date.now() - cached.timestamp < CACHE_DURATION) {
    return cached.accessible
  }
  
  try {
    // Try to get channel info to check if bot has access
    const channelResponse = await fetch(`https://discord.com/api/v10/channels/${channelName}`, {
      headers: {
        'Authorization': `Bot ${botToken}`,
        'Content-Type': 'application/json',
      },
    })
    
    const accessible = channelResponse.status === 200
    
    // Cache the result for 5 minutes
    channelPermissionCache.set(cacheKey, { accessible, timestamp: Date.now() })
    
    if (accessible) {
      logger.info(`📋 Channel ${channelName}: accessible`)
    } else {
      logger.info(`❌ Channel ${channelName}: bot cannot access (${channelResponse.status})`)
    }
    
    return accessible
  } catch (error) {
    logger.warn(`Failed to check permissions for channel ${channelName}:`, error)
    // If we can't check permissions, assume accessible to avoid breaking functionality
    channelPermissionCache.set(cacheKey, { accessible: true, timestamp: Date.now() })
    return true
  }
}
