import { NextRequest, NextResponse } from 'next/server'
import { jsonResponse, errorResponse, successResponse } from '@/lib/utils/api-response'
import { createSupabaseRouteHandlerClient } from '@/utils/supabase/server'
import { validateDiscordToken, makeDiscordApiRequest } from '../../integrations/discord/data/utils'

import { logger } from '@/lib/utils/logger'
import { CONNECTED_STATUSES_LIST } from "@/lib/integrations/connectionStatus"

interface ChannelBotStatus {
  isInChannel: boolean
  canSendMessages: boolean
  hasPermissions: boolean
  userCanInviteBot: boolean
  error?: string
}

/**
 * Check if bot has access to a specific Discord channel
 */
async function checkChannelBotStatus(
  channelId: string, 
  guildId: string,
  integration: any
): Promise<ChannelBotStatus> {
  try {
    // Validate and decrypt Discord token
    const { success, token, error } = await validateDiscordToken(integration)
    if (!success || !token) {
      return {
        isInChannel: false,
        canSendMessages: false,
        hasPermissions: false,
        userCanInviteBot: false,
        error: error || "Token validation failed"
      }
    }

    // Get bot client ID from environment
    const botClientId = process.env.DISCORD_CLIENT_ID || process.env.NEXT_PUBLIC_DISCORD_CLIENT_ID
    if (!botClientId) {
      return {
        isInChannel: false,
        canSendMessages: false,
        hasPermissions: false,
        userCanInviteBot: false,
        error: "Discord bot not configured"
      }
    }

    // Check if the bot is in the guild by trying to get guild member info
    // Use bot token for bot-related checks (not user token)
    const botToken = process.env.DISCORD_BOT_TOKEN
    if (!botToken) {
      return {
        isInChannel: false,
        canSendMessages: false,
        hasPermissions: false,
        userCanInviteBot: false,
        error: "Discord bot not configured"
      }
    }

    let botInGuild = false
    let botHasChannelPerms = false
    
    try {
      // Use bot token to check if bot is in guild
      const guildMemberResponse = await fetch(`https://discord.com/api/v10/guilds/${guildId}/members/${botClientId}`, {
        headers: {
          'Authorization': `Bot ${botToken}`,
          'Content-Type': 'application/json',
        },
      })
      
      if (guildMemberResponse.ok) {
        botInGuild = true
        
        // Check bot's permissions in the specific channel using bot token
        try {
          const channelResponse = await fetch(`https://discord.com/api/v10/channels/${channelId}`, {
            headers: {
              'Authorization': `Bot ${botToken}`,
              'Content-Type': 'application/json',
            },
          })
          
          if (channelResponse.ok) {
            // If bot can access the channel, it has the necessary permissions
            botHasChannelPerms = true
          }
        } catch (channelError) {
          logger.info('Bot cannot access channel:', channelError)
          botHasChannelPerms = false
        }
      }
    } catch (guildError) {
      logger.info('Bot not in guild:', guildError)
      botInGuild = false
    }

    // Check if the user has permissions to invite the bot using user token
    let userCanInvite = false
    try {
      const userGuildResponse = await fetch(`https://discord.com/api/v10/users/@me/guilds`, {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
      })
      
      if (userGuildResponse.ok) {
        const guilds = await userGuildResponse.json()
        const userGuild = guilds.find((g: any) => g.id === guildId)
        
        if (userGuild) {
          // Check if user has MANAGE_GUILD permission (0x00000020)
          const permissions = parseInt(userGuild.permissions, 10)
          userCanInvite = (permissions & 0x00000020) !== 0 || userGuild.owner
        }
      }
    } catch (userError) {
      logger.info('Error checking user permissions:', userError)
    }

    return {
      isInChannel: botInGuild && botHasChannelPerms,
      canSendMessages: botInGuild && botHasChannelPerms,
      hasPermissions: botInGuild && botHasChannelPerms,
      userCanInviteBot: userCanInvite
    }
  } catch (error) {
    logger.error('Error checking channel bot status:', error)
    return {
      isInChannel: false,
      canSendMessages: false,
      hasPermissions: false,
      userCanInviteBot: false,
      error: 'Failed to check bot status'
    }
  }
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const channelId = searchParams.get('channelId')
    const guildId = searchParams.get('guildId')

    if (!channelId || !guildId) {
      return errorResponse('Channel ID and Guild ID are required' , 400)
    }

    // Verify user is authenticated
    const supabase = await createSupabaseRouteHandlerClient()
    const { data: { user }, error: authError } = await supabase.auth.getUser()

    if (authError || !user) {
      return errorResponse('Unauthorized' , 401)
    }

    // Get Discord integration
    const { data: integration } = await supabase
      .from("integrations")
      .select("*")
      .eq("user_id", user.id)
      .eq("provider", "discord")
      .in("status", CONNECTED_STATUSES_LIST)
      .single()

    if (!integration) {
      return errorResponse('Discord integration not connected' , 400)
    }

    // Check channel bot status
    const status = await checkChannelBotStatus(channelId, guildId, integration)
    
    logger.info(`🤖 Channel bot status for ${channelId}:`, status)

    return jsonResponse(status)
  } catch (error) {
    logger.error('Error in channel bot status API:', error)
    return errorResponse('Internal server error' , 500)
  }
}