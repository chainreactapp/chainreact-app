// Use Node.js EventEmitter only on server-side
import { checkDiscordBotConfig, validateDiscordBotToken } from '@/lib/utils/discordConfig'
import { createSupabaseServiceClient } from '@/utils/supabase/server'
import { executeWebhookWorkflow } from '@/lib/webhooks/execute'

import { logger } from '@/lib/utils/logger'

// Create a simple EventEmitter implementation for compatibility
class SimpleEventEmitter {
  private events: Map<string, Function[]> = new Map()

  on(event: string, listener: Function): void {
    if (!this.events.has(event)) {
      this.events.set(event, [])
    }
    this.events.get(event)!.push(listener)
  }

  emit(event: string, ...args: any[]): void {
    const listeners = this.events.get(event)
    if (listeners) {
      listeners.forEach(listener => {
        try {
          listener(...args)
        } catch (error) {
          logger.error(`Error in event listener for ${event}:`, error)
        }
      })
    }
  }

  removeListener(event: string, listener: Function): void {
    const listeners = this.events.get(event)
    if (listeners) {
      const index = listeners.indexOf(listener)
      if (index !== -1) {
        listeners.splice(index, 1)
      }
    }
  }

  removeAllListeners(event?: string): void {
    if (event) {
      this.events.delete(event)
    } else {
      this.events.clear()
    }
  }
}

const normalizeInviteCode = (value?: string | null): string | null => {
  if (!value) return null
  const trimmed = value.trim()
  if (!trimmed) return null
  const withoutProtocol = trimmed.replace(/^https?:\/\//i, '')
  const segments = withoutProtocol.split('/')
  const lastSegment = segments[segments.length - 1]
  if (!lastSegment) return null
  const code = lastSegment.split('?')[0].split('#')[0]
  return code || null
}

interface DiscordGatewayPayload {
  op: number
  d?: any
  s?: number
  t?: string
}

interface DiscordIdentifyPayload {
  token: string
  properties: {
    os: string
    browser: string
    device: string
  }
  presence: {
    status: 'online' | 'idle' | 'dnd' | 'invisible'
    since: number | null
    activities: Array<{
      name: string
      type: number
      url?: string
    }> | null
    afk: boolean
  }
  compress?: boolean
  large_threshold?: number
  shard?: [number, number]
  intents?: number
}

class DiscordGateway extends SimpleEventEmitter {
  private static instance: DiscordGateway | null = null
  private static connectionPromise: Promise<void> | null = null
  private static isInitializing: boolean = false

  private ws: WebSocket | null = null
  private botToken: string | null = null
  private heartbeatInterval: NodeJS.Timeout | null = null
  private heartbeatAck: boolean = true
  private sequence: number | null = null
  private sessionId: string | null = null
  private reconnectAttempts: number = 0
  private maxReconnectAttempts: number = 5
  private reconnectDelay: number = 5000
  private persistentReconnect: boolean = false
  private isConnected: boolean = false
  private lastSuccessfulConnection: number = 0
  private connectionHealthCheck: NodeJS.Timeout | null = null
  private intentionalDisconnect: boolean = false
  private inviteCache: Map<string, Map<string, any>> = new Map() // guildId -> invite code -> invite data

  private constructor() {
    super()
  }

  public static getInstance(): DiscordGateway {
    if (!DiscordGateway.instance) {
      DiscordGateway.instance = new DiscordGateway()
    }
    return DiscordGateway.instance
  }

  /**
   * Fetch with retry logic for transient errors (503, 502, 500, network errors)
   */
  private async fetchWithRetry(url: string, options: RequestInit, maxRetries: number = 3): Promise<Response | null> {
    let lastError: Error | null = null

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        // Create an AbortController for timeout
        const controller = new AbortController()
        const timeoutId = setTimeout(() => controller.abort(), 5000) // 5 second timeout per request

        const response = await fetch(url, {
          ...options,
          signal: controller.signal
        })

        clearTimeout(timeoutId)

        // If we get a transient error, retry
        if (response.status === 503 || response.status === 502 || response.status === 500) {
          const errorText = await response.text().catch(() => 'Service unavailable')
          lastError = new Error(`Discord API ${response.status}: ${errorText}`)

          if (attempt < maxRetries) {
            const delay = Math.min(1000 * attempt, 3000) // Linear backoff, max 3s
            logger.warn(`Discord API ${response.status} error (attempt ${attempt}/${maxRetries}). Retrying in ${delay}ms...`)
            await new Promise(resolve => setTimeout(resolve, delay))
            continue
          }
        }

        // For other status codes (including 429, 401, 403), return immediately
        return response

      } catch (error: any) {
        // Handle abort error specifically
        if (error.name === 'AbortError') {
          lastError = new Error('Discord API request timeout (5s)')
        } else {
          lastError = error instanceof Error ? error : new Error('Network error')
        }

        if (attempt < maxRetries) {
          const delay = Math.min(1000 * attempt, 3000) // Linear backoff, max 3s
          logger.warn(`Discord API network error (attempt ${attempt}/${maxRetries}). Retrying in ${delay}ms...`)
          await new Promise(resolve => setTimeout(resolve, delay))
          continue
        }
      }
    }

    // All retries failed
    logger.error(`Discord API failed after ${maxRetries} attempts:`, lastError)
    return null
  }

  /**
   * Connect to Discord Gateway with singleton protection
   */
  async connect(): Promise<void> {
    // Prevent multiple simultaneous connections
    if (this.isConnected) {
      logger.info('✅ Discord Gateway already connected')
      return
    }

    // If already initializing, wait for that to complete
    if (DiscordGateway.isInitializing && DiscordGateway.connectionPromise) {
      logger.info('⏳ Discord Gateway connection already in progress, waiting...')
      return DiscordGateway.connectionPromise
    }

    // Mark as initializing and create promise
    DiscordGateway.isInitializing = true
    DiscordGateway.connectionPromise = this._connectInternal()

    try {
      await DiscordGateway.connectionPromise
    } finally {
      DiscordGateway.isInitializing = false
      DiscordGateway.connectionPromise = null
    }
  }

  /**
   * Internal connection method
   */
  private async _connectInternal(): Promise<void> {
    try {
      const config = checkDiscordBotConfig()

      if (!config.isConfigured) {
        logger.error('❌ Discord bot not configured. Missing environment variables:', config.missingVars)
        throw new Error(`Discord bot not configured. Missing: ${config.missingVars.join(', ')}`)
      }

      this.botToken = config.botToken

      // SECURITY: Never log token values, even previews
      if (this.botToken) {
        // Remove quotes if they exist (common mistake in .env files)
        this.botToken = this.botToken.replace(/^["']|["']$/g, '')

        logger.info('🔑 Discord bot token loaded')

        // Basic token format validation
        if (!validateDiscordBotToken(this.botToken)) {
          logger.error('⚠️ Discord bot token appears to be malformed')
          logger.error('Token should be in format: [base64].[base64].[base64]')
        }
      } else {
        logger.error('❌ Discord bot token is null or undefined')
        throw new Error('Discord bot token is not available')
      }

      // Get gateway URL with retry logic for transient errors
      const gatewayResponse = await this.fetchWithRetry("https://discord.com/api/v10/gateway/bot", {
        headers: {
          Authorization: `Bot ${this.botToken}`,
          "Content-Type": "application/json"
        }
      })

      if (!gatewayResponse) {
        throw new Error("Failed to get gateway URL after multiple retries")
      }

      if (gatewayResponse.status === 429) {
        // Rate limited by Discord
        const retryAfter = gatewayResponse.headers.get('Retry-After')
        const waitTime = retryAfter ? parseInt(retryAfter, 10) * 1000 : 30000 // default 30s
        logger.warn(`Discord Gateway rate limited. Waiting ${waitTime / 1000}s before retrying.`)
        await new Promise(res => setTimeout(res, waitTime))
        this.scheduleReconnect(true, false) // Rate limited
        return
      }

      if (!gatewayResponse.ok) {
        const errorText = await gatewayResponse.text().catch(() => 'Unknown error')
        const isTransientError = gatewayResponse.status === 503 || gatewayResponse.status === 502 || gatewayResponse.status === 500

        if (gatewayResponse.status === 401) {
          console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
          console.log('❌ DISCORD GATEWAY CONNECTION FAILED: Invalid Token')
          console.log('   Status: 401 Unauthorized')
          console.log('   Please check:')
          console.log('   1. DISCORD_BOT_TOKEN in .env.local is correct')
          console.log('   2. The bot exists in Discord Developer Portal')
          console.log('   3. Regenerate token at: https://discord.com/developers/applications')
          console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
          logger.error('❌ Discord bot token is invalid or expired (401 Unauthorized)')

          // Disable persistent reconnect to avoid spamming with invalid token
          this.disablePersistentReconnect()

          throw new Error(`Discord bot token is invalid or expired. Please update DISCORD_BOT_TOKEN in .env.local`)
        } else if (isTransientError) {
          logger.warn(`Discord Gateway transient error ${gatewayResponse.status}: ${errorText}`)
          this.scheduleReconnect(false, true) // Transient error
          return
        } else {
          throw new Error(`Discord Gateway API error ${gatewayResponse.status}: ${errorText}`)
        }
      }

      const gatewayData = await gatewayResponse.json()
      const wsUrl = `${gatewayData.url}?v=10&encoding=json`

      // Create WebSocket connection
      // On server-side, use ws package; on client-side, use browser WebSocket
      if (typeof window === 'undefined') {
        // Server-side: dynamically import ws
        try {
          const WebSocketModule = await import('ws')
          const WebSocketImpl = WebSocketModule.default || WebSocketModule.WebSocket
          this.ws = new WebSocketImpl(wsUrl) as any
        } catch (error) {
          logger.error('Failed to import ws package. Please install it: npm install ws', error)
          throw new Error('WebSocket implementation not available on server. Install ws package.')
        }
      } else {
        // Client-side: use browser WebSocket
        this.ws = new WebSocket(wsUrl)
      }

      this.ws.onopen = () => {
        this.isConnected = true
        this.reconnectAttempts = 0 // Reset attempts on success
        this.lastSuccessfulConnection = Date.now()
        logger.info('Discord Gateway WebSocket connection established')

        // Start connection health monitoring (less aggressive)
        this.startHealthCheck()
      }

      this.ws.onmessage = (event) => {
        // Handle both string and Buffer data (ws package may return Buffer)
        let data: string
        if (typeof event.data === 'string') {
          data = event.data
        } else if (Buffer.isBuffer(event.data)) {
          data = event.data.toString('utf-8')
        } else if (event.data instanceof ArrayBuffer) {
          data = new TextDecoder().decode(event.data)
        } else {
          console.log('⚠️ Unknown WebSocket message type:', typeof event.data)
          return
        }
        this.handleMessage(data)
      }

      this.ws.onclose = (event) => {
        console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
        console.log('🔌 DISCORD GATEWAY WEBSOCKET CLOSED')
        console.log(`   Code: ${event.code}`)
        console.log(`   Reason: ${event.reason || 'No reason provided'}`)
        console.log(`   Clean: ${event.wasClean}`)
        console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')

        this.isConnected = false
        const wasIntentional = this.intentionalDisconnect
        this.cleanup()

        // Discord close codes that should NOT trigger reconnection:
        // 1000: Normal closure
        // 4004: Authentication failed (invalid token)
        // 4010: Invalid shard
        // 4011: Sharding required
        // 4013: Invalid intents
        // 4014: Disallowed intents
        const noReconnectCodes = [1000, 4004, 4010, 4011, 4013, 4014]

        // Log critical intent errors prominently
        if (event.code === 4013 || event.code === 4014) {
          console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
          console.log('❌ DISCORD GATEWAY DISCONNECTED: INTENT ERROR')
          console.log(`   Close Code: ${event.code}`)
          if (event.code === 4013) {
            console.log('   Error: Invalid intents specified')
          } else {
            console.log('   Error: Disallowed intents - MESSAGE_CONTENT requires approval!')
          }
          console.log('')
          console.log('   To fix this:')
          console.log('   1. Go to: https://discord.com/developers/applications')
          console.log('   2. Select your bot application')
          console.log('   3. Go to "Bot" section')
          console.log('   4. Scroll down to "Privileged Gateway Intents"')
          console.log('   5. Enable "MESSAGE CONTENT INTENT"')
          console.log('   6. Save changes and restart the server')
          console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
        } else if (event.code === 4004) {
          console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
          console.log('❌ DISCORD GATEWAY DISCONNECTED: Authentication Failed')
          console.log('   Close Code: 4004')
          console.log('   The bot token is invalid or has been reset.')
          console.log('   Regenerate your bot token in Discord Developer Portal.')
          console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
        }

        // Only reconnect if not intentionally disconnected and persistent reconnect is enabled
        if (!wasIntentional && this.persistentReconnect && !noReconnectCodes.includes(event.code)) {
          logger.info(`Discord Gateway closed with code ${event.code}, will attempt reconnection`)
          this.scheduleReconnect()
        } else if (wasIntentional) {
          logger.info('Discord Gateway closed intentionally, not reconnecting')
        } else if (noReconnectCodes.includes(event.code)) {
          logger.error(`Discord Gateway closed with non-recoverable code ${event.code}, not reconnecting`)
          this.disablePersistentReconnect() // Disable to prevent reconnection spam
        } else {
          logger.info('Discord Gateway closed, persistent reconnect disabled')
        }
      }

      this.ws.onerror = (error: any) => {
        console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
        console.log('❌ DISCORD GATEWAY WEBSOCKET ERROR')
        console.log(`   Error: ${error?.message || error || 'Unknown error'}`)
        console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
        logger.error('Discord Gateway WebSocket error:', error)
      }

    } catch (error) {
      logger.error("Failed to connect to Discord Gateway:", error)
      
      // Determine if this is a transient error that should be retried quickly
      const errorMessage = error instanceof Error ? error.message : String(error)
      const isTransientError = errorMessage.includes('503') || 
                              errorMessage.includes('502') || 
                              errorMessage.includes('500') ||
                              errorMessage.includes('network') ||
                              errorMessage.includes('timeout')
      
      this.scheduleReconnect(false, isTransientError)
    }
  }

  /**
   * Handle incoming WebSocket messages
   */
  private handleMessage(data: string): void {
    try {
      const payload: DiscordGatewayPayload = JSON.parse(data)

      // Log all incoming messages for debugging
      console.log(`📨 Discord Gateway message: op=${payload.op}, t=${payload.t || 'N/A'}`)

      switch (payload.op) {
        case 10: // Hello
          console.log('📨 Received HELLO from Discord Gateway')
          this.handleHello(payload.d)
          break
        case 11: // Heartbeat ACK
          this.heartbeatAck = true
          this.lastSuccessfulConnection = Date.now() // Update health timestamp
          break
        case 0: // Dispatch
          this.handleDispatch(payload)
          break
        case 7: // Reconnect
          console.log('📨 Discord requested RECONNECT')
          this.reconnect()
          break
        case 9: // Invalid Session
          console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
          console.log('❌ DISCORD GATEWAY: INVALID SESSION')
          console.log(`   Resumable: ${payload.d}`)
          console.log('   This usually means the bot token or intents are invalid.')
          console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
          this.reconnect()
          break
        default:
          console.log(`📨 Unhandled opcode: ${payload.op}`)
          break
      }

    } catch (error: any) {
      console.log('❌ Error parsing Discord Gateway message:', error?.message)
      logger.error('Error parsing Discord Gateway message:', error)
    }
  }

  /**
   * Handle Hello payload and start heartbeat
   */
  private handleHello(data: any): void {
    const heartbeatInterval = data.heartbeat_interval
    
    this.heartbeatInterval = setInterval(() => {
      this.sendHeartbeat()
    }, heartbeatInterval)

    // Send identify payload
    this.sendIdentify()
  }

  /**
   * Handle dispatch events
   */
  private handleDispatch(payload: DiscordGatewayPayload): void {
    this.sequence = payload.s || null
    this.lastSuccessfulConnection = Date.now() // Update health timestamp
    
    switch (payload.t) {
      case 'READY':
        this.handleReady(payload.d)
        break
      case 'RESUMED':
        this.handleResumed(payload.d)
        break
      case 'MESSAGE_CREATE':
        this.handleMessageCreate(payload.d)
        break
      case 'GUILD_MEMBER_ADD':
        this.handleMemberAdd(payload.d)
        break
      case 'INVITE_CREATE':
        this.handleInviteCreate(payload.d)
        break
      case 'INVITE_DELETE':
        this.handleInviteDelete(payload.d)
        break
      default:
        // Log other events for debugging
        if (payload.t) {
          logger.info(`📡 Discord event received: ${payload.t}`)
        }
        break
    }
  }

  /**
   * Handle Ready event
   */
  private async handleReady(data: any): Promise<void> {
    this.sessionId = data.session_id
    // Use console.log directly for critical connection info to ensure visibility
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
    console.log('🎉 DISCORD GATEWAY CONNECTED AND READY!')
    console.log(`   Bot: ${data.user?.username}#${data.user?.discriminator || '0'}`)
    console.log(`   User ID: ${data.user?.id}`)
    console.log(`   Session: ${this.sessionId}`)
    console.log(`   Guilds: ${data.guilds?.length || 0}`)
    console.log('   The bot is now listening for MESSAGE_CREATE events.')
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
    logger.info('🎉 Discord bot ready!', {
      sessionId: this.sessionId,
      username: data.user?.username,
      userId: data.user?.id,
      guildCount: data.guilds?.length || 0
    })

    // Initialize invite cache when bot is ready
    await this.initializeInviteCache()

    this.emit('ready', data)
  }

  /**
   * Handle Resumed event
   */
  private handleResumed(data: any): void {
    this.emit('resumed', data)
  }

  /**
   * Handle MESSAGE_CREATE event and trigger workflows
   */
  private handleMessageCreate(messageData: any): void {
    // Use console.log for visibility - this is key for debugging HITL
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
    console.log('🔵 DISCORD MESSAGE_CREATE EVENT RECEIVED')
    console.log(`   Author: ${messageData.author?.username}${messageData.author?.bot ? ' (BOT)' : ''}`)
    console.log(`   Channel: ${messageData.channel_id}`)
    console.log(`   Guild: ${messageData.guild_id}`)
    console.log(`   Content: ${messageData.content?.substring(0, 50)}${messageData.content?.length > 50 ? '...' : ''}`)
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')

    logger.info('🔵 Discord MESSAGE_CREATE received:', {
      messageId: messageData.id,
      channelId: messageData.channel_id,
      guildId: messageData.guild_id,
      content: messageData.content?.substring(0, 100),
      author: messageData.author?.username,
      isBot: messageData.author?.bot
    })

    // Ignore messages from bots (including our own bot)
    if (messageData.author?.bot) {
      console.log('🤖 Ignoring bot message')
      logger.info('🤖 Ignoring bot message')
      return
    }

    console.log('💬 Processing user message for HITL and workflows...')
    logger.info('💬 Processing user message for workflows')

    // Emit message event for workflow processing
    this.emit('message', messageData)

    // Forward to HITL webhook for human-in-the-loop conversations
    this.forwardToHITLWebhook(messageData)

    // Trigger workflow processing
    this.processDiscordMessageForWorkflows(messageData)
  }

  /**
   * Forward Discord message to HITL webhook for human-in-the-loop conversations
   */
  private async forwardToHITLWebhook(messageData: any): Promise<void> {
    try {
      // For internal webhook calls, always prefer localhost since Gateway and webhook
      // are on the same server. This avoids ngrok interstitial pages and is faster.
      const isProd = process.env.NODE_ENV === 'production'
      let baseUrl: string

      if (!isProd) {
        // In development, use localhost for internal calls (same server)
        baseUrl = 'http://localhost:3000'
      } else {
        baseUrl = process.env.NEXT_PUBLIC_APP_URL ||
                  (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : 'https://chainreact.app')
      }

      const hitlEndpoint = `${baseUrl}/api/webhooks/discord/hitl`

      logger.info('🔄 [HITL Gateway] Forwarding message to HITL webhook', {
        endpoint: hitlEndpoint,
        channelId: messageData.channel_id,
        author: messageData.author?.username,
        contentPreview: messageData.content?.substring(0, 50)
      })

      const response = await fetch(hitlEndpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': 'ChainReact-DiscordGateway/1.0',
          'ngrok-skip-browser-warning': 'true' // Bypass ngrok interstitial page
        },
        body: JSON.stringify({
          t: 'MESSAGE_CREATE',
          d: messageData
        })
      })

      const result = await response.json()

      logger.info('📨 [HITL Gateway] Webhook response', {
        status: response.status,
        ok: response.ok,
        action: result.action,
        message: result.message,
        hasConversation: result.action !== undefined && result.message !== 'No active conversation'
      })

      if (response.ok) {
        if (result.action === 'resumed') {
          logger.info('✅ [HITL Gateway] Workflow resumed!', { executionId: result.executionId })
        } else if (result.action === 'continue_conversation') {
          logger.info('💬 [HITL Gateway] AI response sent, conversation continues')
        } else if (result.action === 'reactivated') {
          logger.info('🔄 [HITL Gateway] Timed-out conversation reactivated')
        }
      }
    } catch (error: any) {
      logger.error('❌ [HITL Gateway] Error forwarding to webhook', { error: error.message })
    }
  }

  /**
   * Process Discord message and trigger matching workflows
   */
  private async processDiscordMessageForWorkflows(messageData: any): Promise<void> {
    try {
      // Get the base URL for internal API calls
      let baseUrl: string
      const isProd = process.env.NODE_ENV === 'production'
      const configured = process.env.NEXT_PUBLIC_APP_URL

      if (!isProd) {
        // In development: prefer explicit webhook URL, then NGROK/Tunnel, else localhost
        const webhookUrl = process.env.NEXT_PUBLIC_WEBHOOK_HTTPS_URL
        const ngrokUrl = process.env.NGROK_URL || process.env.NEXT_PUBLIC_NGROK_URL || process.env.TUNNEL_URL
        baseUrl = webhookUrl || ngrokUrl || 'http://localhost:3000'
        logger.info(`📍 Using development URL: ${baseUrl}${webhookUrl ? ' (NEXT_PUBLIC_WEBHOOK_HTTPS_URL)' : ngrokUrl ? ' (ngrok/tunnel)' : ''}`)
      } else {
        // Production
        if (configured) {
          baseUrl = configured
          logger.info(`📍 Using configured URL: ${baseUrl}`)
        } else {
          baseUrl = process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` :
                    process.env.RENDER_EXTERNAL_URL ||
                    'https://chainreact.app'
        }
      }

      logger.info(`📤 Sending Discord message to workflow endpoint: ${baseUrl}/api/webhooks/discord`)
      logger.info(`📨 Message details:`, {
        messageId: messageData.id,
        channelId: messageData.channel_id,
        guildId: messageData.guild_id,
        content: `${messageData.content?.substring(0, 50) }...`,
        author: messageData.author?.username
      })

      const attemptedUrls: Array<{ url: string; status?: number; error?: string }> = []

      const candidateBaseUrls: string[] = []
      if (!isProd) {
        if (process.env.NEXT_PUBLIC_WEBHOOK_HTTPS_URL) {
          candidateBaseUrls.push(process.env.NEXT_PUBLIC_WEBHOOK_HTTPS_URL)
        }
        const tunnelUrl = process.env.NGROK_URL || process.env.NEXT_PUBLIC_NGROK_URL || process.env.TUNNEL_URL
        if (tunnelUrl) {
          candidateBaseUrls.push(tunnelUrl)
        }
        // Always fall back to localhost in development so HITL testing works even when tunnels are offline
        candidateBaseUrls.push('http://localhost:3000')
      } else {
        candidateBaseUrls.push(baseUrl)
      }

      let processed = false

      for (const candidateBaseUrl of candidateBaseUrls) {
        const endpoint = `${candidateBaseUrl}/api/webhooks/discord`
        try {
          const response = await fetch(endpoint, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'User-Agent': 'ChainReact-DiscordGateway/1.0'
            },
            body: JSON.stringify(messageData)
          })

          attemptedUrls.push({ url: endpoint, status: response.status })

          if (response.ok) {
            logger.info('✅ Discord message processed for workflows:', {
              messageId: messageData.id,
              channelId: messageData.channel_id,
              author: messageData.author?.username,
              endpoint
            })
            processed = true
            break
          }

          logger.warn('Workflow endpoint returned non-OK status, trying next fallback if available', {
            endpoint,
            status: response.status
          })
        } catch (error: any) {
          attemptedUrls.push({ url: endpoint, error: error.message })
          logger.warn('Error calling workflow endpoint, trying next fallback if available', {
            endpoint,
            error: error.message
          })
        }
      }

      if (!processed) {
        logger.error('Failed to process Discord message for workflows after trying all endpoints', {
          attempts: attemptedUrls
        })
      }
    } catch (error) {
      logger.error('Error processing Discord message for workflows:', error)
    }
  }

  /**
   * Handle INVITE_CREATE event - cache new invites
   */
  private handleInviteCreate(inviteData: any): void {
    logger.info('📨 Discord INVITE_CREATE received:', {
      code: inviteData.code,
      guildId: inviteData.guild_id,
      channelId: inviteData.channel_id,
      inviter: inviteData.inviter?.username,
      uses: inviteData.uses,
      maxUses: inviteData.max_uses
    })

    if (!inviteData.guild_id) return

    // Get or create guild invite cache
    let guildInvites = this.inviteCache.get(inviteData.guild_id)
    if (!guildInvites) {
      guildInvites = new Map()
      this.inviteCache.set(inviteData.guild_id, guildInvites)
    }

    // Cache the invite
    guildInvites.set(inviteData.code, {
      code: inviteData.code,
      uses: inviteData.uses || 0,
      inviterId: inviteData.inviter?.id,
      maxUses: inviteData.max_uses || null,
      maxAge: inviteData.max_age || null,
      createdAt: inviteData.created_at
    })
  }

  /**
   * Handle INVITE_DELETE event - remove from cache
   */
  private handleInviteDelete(inviteData: any): void {
    logger.info('🗑️ Discord INVITE_DELETE received:', {
      code: inviteData.code,
      guildId: inviteData.guild_id
    })

    if (!inviteData.guild_id) return

    const guildInvites = this.inviteCache.get(inviteData.guild_id)
    if (guildInvites) {
      guildInvites.delete(inviteData.code)
    }
  }

  /**
   * Handle GUILD_MEMBER_ADD event - detect invite used and assign roles
   */
  private async handleMemberAdd(memberData: any): Promise<void> {
    logger.info('👋 Discord GUILD_MEMBER_ADD received:', {
      userId: memberData.user?.id,
      username: memberData.user?.username,
      guildId: memberData.guild_id,
      joinedAt: memberData.joined_at
    })

    const guildId = memberData.guild_id
    if (!guildId) return

    try {
      // Get cached invites for this guild
      const cachedInvites = this.inviteCache.get(guildId) || new Map()

      // Fetch current invites from Discord API to compare
      const currentInvites = await this.fetchGuildInvites(guildId)

      // Find which invite was used by comparing uses count
      let usedInvite: any = null

      if (currentInvites) {
        for (const invite of currentInvites) {
          const cachedInvite = cachedInvites.get(invite.code)
          if (cachedInvite && invite.uses > cachedInvite.uses) {
            const normalizedCode = normalizeInviteCode(invite.code) || invite.code
            usedInvite = { ...invite, code: normalizedCode }
            logger.info(`✅ Member joined using invite: ${normalizedCode}`)
            break
          }
        }

        // Update cache with new invite data
        const newInviteCache = new Map()
        for (const invite of currentInvites) {
          newInviteCache.set(invite.code, {
            code: invite.code,
            uses: invite.uses || 0,
            inviterId: invite.inviter?.id,
            maxUses: invite.max_uses || null,
            maxAge: invite.max_age || null
          })
        }
        this.inviteCache.set(guildId, newInviteCache)
      }

      // Check for auto role assignment
      if (usedInvite) {
        await this.assignRoleBasedOnInvite(memberData, usedInvite.code, guildId)
      } else {
        logger.info('⚠️ Could not determine which invite was used')
      }

      await this.triggerMemberJoinWorkflows(memberData, usedInvite)

    } catch (error) {
      logger.error('Error handling member join:', error)
    }
  }

  /**
   * Fetch guild invites from Discord API
   */
  private async fetchGuildInvites(guildId: string): Promise<any[]> {
    try {
      const response = await fetch(`https://discord.com/api/v10/guilds/${guildId}/invites`, {
        headers: {
          'Authorization': `Bot ${this.botToken}`,
          'Content-Type': 'application/json'
        }
      })

      if (!response.ok) {
        logger.error(`Failed to fetch guild invites: ${response.status}`)
        return []
      }

      const invites = await response.json()
      return invites
    } catch (error) {
      logger.error('Error fetching guild invites:', error)
      return []
    }
  }

  /**
   * Assign role based on invite code
   */
  private async assignRoleBasedOnInvite(memberData: any, inviteCode: string, guildId: string): Promise<void> {
    try {
      const normalizedInvite = normalizeInviteCode(inviteCode)
      if (!normalizedInvite) return

      // Check for hardcoded environment variable config
      if (
        normalizeInviteCode(process.env.DISCORD_AUTO_ROLE_INVITE) === normalizedInvite &&
        process.env.DISCORD_AUTO_ROLE_ID &&
        process.env.DISCORD_GUILD_ID === guildId
      ) {
        const roleId = process.env.DISCORD_AUTO_ROLE_ID
        const userId = memberData.user?.id

        if (!userId) {
          logger.error('No user ID in member data')
          return
        }

        logger.info(`🎯 Assigning role ${roleId} to user ${memberData.user?.username} via invite ${normalizedInvite}`)

        // Use Discord API to assign role
        const response = await fetch(
          `https://discord.com/api/v10/guilds/${guildId}/members/${userId}/roles/${roleId}`,
          {
            method: 'PUT',
            headers: {
              'Authorization': `Bot ${this.botToken}`,
              'Content-Type': 'application/json',
              'X-Audit-Log-Reason': `Auto-assigned via invite ${normalizedInvite}`
            }
          }
        )

        if (response.ok) {
          logger.info(`✅ Successfully assigned role ${roleId} to ${memberData.user?.username}`)
        } else {
          const errorText = await response.text()
          logger.error(`❌ Failed to assign role: ${response.status} - ${errorText}`)
        }
      }

      // TODO: Check database for invite-role mappings

    } catch (error) {
      logger.error('Error assigning role based on invite:', error)
    }
  }

  private async triggerMemberJoinWorkflows(memberData: any, invite: any | null): Promise<void> {
    try {
      const supabase = await createSupabaseServiceClient()

      // Get active workflows
      const { data: workflows, error: workflowsError } = await supabase
        .from('workflows')
        .select('id, user_id, status')
        .eq('status', 'active')

      if (workflowsError) {
        logger.error('[Discord] Failed to load member join workflows:', workflowsError)
        return
      }

      if (!workflows || workflows.length === 0) {
        logger.info('[Discord] No active workflows to evaluate for member join')
        return
      }

      // Load nodes for all workflows in one query
      const workflowIds = workflows.map(w => w.id)
      const { data: allNodes, error: nodesError } = await supabase
        .from('workflow_nodes')
        .select('id, workflow_id, node_type, label, config, is_trigger, provider_id, position_x, position_y')
        .in('workflow_id', workflowIds)

      if (nodesError) {
        logger.error('[Discord] Failed to load workflow nodes:', nodesError)
        return
      }

      // Group nodes by workflow
      const nodesByWorkflow = new Map<string, any[]>()
      for (const node of allNodes || []) {
        const list = nodesByWorkflow.get(node.workflow_id) || []
        list.push({
          id: node.id,
          type: node.node_type,
          data: {
            type: node.node_type,
            label: node.label,
            config: node.config || {},
            isTrigger: node.is_trigger,
            providerId: node.provider_id
          },
          position: { x: node.position_x, y: node.position_y }
        })
        nodesByWorkflow.set(node.workflow_id, list)
      }

      // Attach nodes to workflows
      const workflowsWithNodes = workflows.map(w => ({
        ...w,
        nodes: nodesByWorkflow.get(w.id) || []
      }))

      logger.info('[Discord] Loaded member join workflows', workflowsWithNodes.map((workflow) => ({
        id: workflow.id,
        status: workflow.status,
        nodesCount: workflow.nodes.length,
        hasNodes: workflow.nodes.length > 0
      })))

      const guildId = memberData.guild_id
      const guildName = this.client?.guilds?.cache?.get(guildId)?.name || null
      const normalizedInvite = normalizeInviteCode(invite?.code || undefined)
      const inviterUsername = invite?.inviter?.username || null
      const inviterDiscriminator = invite?.inviter?.discriminator || null
      const inviterTag = inviterUsername
        ? (inviterDiscriminator && inviterDiscriminator !== '0'
            ? `${inviterUsername}#${inviterDiscriminator}`
            : inviterUsername)
        : null

      const discriminator = memberData.user?.discriminator
      const username = memberData.user?.username || null
      const memberTag = discriminator && discriminator !== '0' && username
        ? `${username}#${discriminator}`
        : username

      const triggerData = {
        memberId: memberData.user?.id || null,
        memberTag,
        memberUsername: username,
        memberDiscriminator: discriminator || null,
        memberAvatar: memberData.user?.avatar || null,
        guildId,
        guildName,
        joinedAt: memberData.joined_at || null,
        inviteCode: normalizedInvite,
        inviteUrl: normalizedInvite ? `https://discord.gg/${normalizedInvite}` : null,
        inviterTag,
        inviterId: invite?.inviter?.id || null,
        inviteUses: invite?.uses ?? null,
        inviteMaxUses: invite?.max_uses ?? null,
        timestamp: new Date().toISOString()
      }

      // Nodes are already in the correct format from the normalized tables
      const candidateWorkflows = workflowsWithNodes.filter((workflow) => {
        const nodes = workflow.nodes || []
        logger.info('[Discord] Workflow nodes overview', {
          workflowId: workflow.id,
          nodeCount: nodes.length,
          nodeTypes: nodes.map((n: any) => n?.data?.type || n?.type)
        })
        return nodes.some((n: any) => {
          const nodeType = n?.data?.type || n?.type
          return nodeType === 'discord_trigger_member_join'
        })
      })

      logger.info('[Discord] Evaluating member join workflows', {
        workflowsCount: candidateWorkflows.length,
        guildId
      })

      for (const workflow of candidateWorkflows) {
        const nodes = workflow.nodes || []
        const triggerNode = nodes.find((n: any) => {
          const nodeType = n?.data?.type || n?.type
          return nodeType === 'discord_trigger_member_join'
        })
        if (!triggerNode) {
          logger.info('[Discord] Skipping workflow due to missing trigger node after parse', {
            workflowId: workflow.id
          })
          continue
        }

        const triggerConfig = triggerNode.data?.config || triggerNode.data || {}

        if (triggerConfig.guildId && triggerConfig.guildId !== guildId) {
          logger.info('[Discord] Skipping workflow due to guild mismatch', {
            workflowId: workflow.id,
            expected: triggerConfig.guildId,
            actual: guildId
          })
          continue
        }

        const filterCode = normalizeInviteCode(triggerConfig.inviteFilter)
        if (filterCode && filterCode !== normalizedInvite) {
          logger.info('[Discord] Skipping workflow due to invite filter mismatch', {
            workflowId: workflow.id,
            expected: filterCode,
            actual: normalizedInvite
          })
          continue
        }

        try {
          // PR-V2-WEBHOOK-DISCORD-GATEWAY: route through unified webhook
          // dispatcher. Resolves audit §4 Q4 — Discord gateway WS events
          // had no dedup at this call site. Discord's RESUME protocol
          // prevents protocol-level duplicates in normal operation, but
          // multi-instance deploys + crashes mid-handler can re-deliver.
          // dedupeKey = `${guildId}:${memberId}:${joined_at}` per Q4
          // resolution — stable across re-deliveries of the same member-
          // join event.
          const memberId = memberData.user?.id || 'unknown-member'
          const joinedAtISO = memberData.joined_at || 'unknown'
          const dedupeKey = `${memberData.guild_id}:${memberId}:${joinedAtISO}`

          const dispatchResult = await executeWebhookWorkflow({
            workflowId: workflow.id,
            userId: workflow.user_id,
            provider: 'discord',
            triggerType: 'discord_trigger_member_join',
            triggerData,
            metadata: {
              changeType: 'member_join',
              guildId: memberData.guild_id,
              memberId,
              source: 'discord-gateway',
            },
            dedupeKey,
          })

          if (!dispatchResult.success) {
            throw new Error(dispatchResult.error || 'discord-gateway dispatch failed')
          }

          logger.info('[Discord] Workflow triggered successfully for member join', {
            workflowId: workflow.id,
            memberId,
            inviteCode: normalizedInvite,
            sessionId: dispatchResult.sessionId,
            duplicate: dispatchResult.duplicate,
          })
        } catch (error) {
          logger.error(`Failed to execute workflow ${workflow.id} for member join`, error)
        }
      }
    } catch (error) {
      logger.error('Error triggering member join workflows:', error)
    }
  }

  /**
   * Initialize invite cache for all guilds on startup
   */
  private async initializeInviteCache(): Promise<void> {
    // This will be called when bot is ready
    // We'll fetch invites for all guilds the bot is in
    logger.info('📋 Initializing invite cache...')

    // Note: We'll need to get the guild list from the READY event
    // For now, just initialize for the configured guild
    if (process.env.DISCORD_GUILD_ID) {
      const invites = await this.fetchGuildInvites(process.env.DISCORD_GUILD_ID)
      if (invites.length > 0) {
        const inviteMap = new Map()
        for (const invite of invites) {
          inviteMap.set(invite.code, {
            code: invite.code,
            uses: invite.uses || 0,
            inviterId: invite.inviter?.id,
            maxUses: invite.max_uses || null,
            maxAge: invite.max_age || null
          })
        }
        this.inviteCache.set(process.env.DISCORD_GUILD_ID, inviteMap)
        logger.info(`✅ Cached ${invites.length} invites for guild ${process.env.DISCORD_GUILD_ID}`)
      }
    }
  }

  /**
   * Send identify payload
   */
  private sendIdentify(): void {
    // Discord Gateway intents
    const INTENTS = {
      GUILDS: 1 << 0,
      GUILD_MEMBERS: 1 << 1,
      GUILD_BANS: 1 << 2,
      GUILD_EMOJIS_AND_STICKERS: 1 << 3,
      GUILD_INTEGRATIONS: 1 << 4,
      GUILD_WEBHOOKS: 1 << 5,
      GUILD_INVITES: 1 << 6,
      GUILD_VOICE_STATES: 1 << 7,
      GUILD_PRESENCES: 1 << 8,
      GUILD_MESSAGES: 1 << 9,
      GUILD_MESSAGE_REACTIONS: 1 << 10,
      GUILD_MESSAGE_TYPING: 1 << 11,
      DIRECT_MESSAGES: 1 << 12,
      DIRECT_MESSAGE_REACTIONS: 1 << 13,
      DIRECT_MESSAGE_TYPING: 1 << 14,
      MESSAGE_CONTENT: 1 << 15,
      GUILD_SCHEDULED_EVENTS: 1 << 16,
      AUTO_MODERATION_CONFIGURATION: 1 << 20,
      AUTO_MODERATION_EXECUTION: 1 << 21
    }

    // Calculate required intents for bot functionality
    // Including: GUILDS, GUILD_MEMBERS, GUILD_INVITES, GUILD_MESSAGES, MESSAGE_CONTENT
    const requiredIntents =
      INTENTS.GUILDS |
      INTENTS.GUILD_MEMBERS |
      INTENTS.GUILD_INVITES |
      INTENTS.GUILD_MESSAGES |
      INTENTS.MESSAGE_CONTENT

    logger.info('🔑 Sending identify with intents:', {
      GUILDS: true,
      GUILD_MEMBERS: true,
      GUILD_INVITES: true,
      GUILD_MESSAGES: true,
      MESSAGE_CONTENT: true,
      intentsValue: requiredIntents
    })

    const identify: DiscordIdentifyPayload = {
      token: this.botToken!,
      properties: {
        os: "linux",
        browser: "ChainReact",
        device: "ChainReact"
      },
      presence: {
        status: "online",
        since: null,
        activities: [
          {
            name: "workflows",
            type: 0 // Playing
          }
        ],
        afk: false
      },
      compress: false,
      large_threshold: 250,
      intents: requiredIntents
    }

    this.send({
      op: 2,
      d: identify
    })
  }

  /**
   * Send heartbeat
   */
  private sendHeartbeat(): void {
    if (!this.heartbeatAck) {
      this.ws?.close(1000, "Heartbeat timeout")
      return
    }

    this.heartbeatAck = false
    
    this.send({
      op: 1,
      d: this.sequence
    })
  }

  /**
   * Send payload to Discord Gateway
   */
  private send(payload: DiscordGatewayPayload): void {
    // Check WebSocket OPEN state (1 = OPEN)
    if (this.ws && this.ws.readyState === 1) {
      this.ws.send(JSON.stringify(payload))
    }
  }

  /**
   * Update bot presence
   */
  updatePresence(presence: {
    status?: 'online' | 'idle' | 'dnd' | 'invisible'
    activities?: Array<{
      name: string
      type: number
      url?: string
    }>
    since?: number | null
    afk?: boolean
  }): void {
    const payload = {
      op: 3,
      d: {
        status: presence.status || "online",
        since: presence.since || null,
        activities: presence.activities || null,
        afk: presence.afk || false
      }
    }

    this.send(payload)
  }

  /**
   * Schedule reconnection with improved backoff strategy
   */
  private scheduleReconnect(rateLimited = false, isTransientError = false): void {
    // Check if we should reconnect
    if (this.intentionalDisconnect) {
      logger.info('Discord Gateway: Skipping reconnect due to intentional disconnect')
      return
    }

    if (!this.persistentReconnect && this.reconnectAttempts >= this.maxReconnectAttempts) {
      logger.warn(`Discord Gateway: Max reconnection attempts (${this.maxReconnectAttempts}) reached. Stopping reconnection attempts.`)
      return
    }

    this.reconnectAttempts++

    let delay: number
    if (rateLimited) {
      // Rate limited - wait at least 60s to avoid token reset
      delay = 60000
    } else if (isTransientError) {
      // Transient errors (503, 502, 500) - longer exponential backoff
      delay = Math.min(10000 * Math.pow(2, this.reconnectAttempts - 1), 300000) // Start at 10s, max 5 minutes
    } else {
      // Regular reconnection - much longer exponential backoff to avoid spam
      delay = Math.min(30000 * Math.pow(2, this.reconnectAttempts - 1), 600000) // Start at 30s, max 10 minutes
    }

    logger.info(`Discord Gateway: Scheduling reconnection attempt ${this.reconnectAttempts} in ${delay / 1000}s`)

    setTimeout(() => {
      this.reconnect()
    }, delay)
  }

  /**
   * Reconnect to Discord Gateway
   */
  async reconnect(): Promise<void> {
    if (this.intentionalDisconnect) {
      logger.info('Discord Gateway: Skipping reconnect due to intentional disconnect')
      return
    }

    this.cleanup()
    await this.connect()
  }

  /**
   * Start health check monitoring
   */
  private startHealthCheck(): void {
    // Clear any existing health check
    if (this.connectionHealthCheck) {
      clearInterval(this.connectionHealthCheck)
    }

    // Check connection health every 5 minutes (much less aggressive)
    this.connectionHealthCheck = setInterval(() => {
      this.checkConnectionHealth()
    }, 300000) // 5 minutes instead of 30 seconds
  }

  /**
   * Check connection health and reconnect if needed
   */
  private checkConnectionHealth(): void {
    if (!this.isConnected || !this.ws) {
      return
    }

    // Only force reconnection if we haven't received ANY activity for 10 minutes
    // Discord heartbeats can have variable intervals, so we need to be patient
    const timeSinceLastSuccess = Date.now() - this.lastSuccessfulConnection
    if (timeSinceLastSuccess > 600000) { // 10 minutes instead of 2 minutes
      logger.warn('Discord Gateway connection appears unhealthy, forcing reconnection')
      this.ws.close(1000, 'Connection health check failed')
    }
  }

  /**
   * Clean up resources
   */
  private cleanup(): void {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval)
      this.heartbeatInterval = null
    }
    
    if (this.connectionHealthCheck) {
      clearInterval(this.connectionHealthCheck)
      this.connectionHealthCheck = null
    }
    
    if (this.ws) {
      this.ws.close()
      this.ws = null
    }
    
    this.isConnected = false
  }

  /**
   * Disconnect from Discord Gateway
   */
  disconnect(): void {
    this.intentionalDisconnect = true
    this.persistentReconnect = false
    this.cleanup()
    logger.info('Discord Gateway disconnected intentionally')
  }

  /**
   * Get connection status
   */
  getStatus(): { isConnected: boolean; reconnectAttempts: number; sessionId: string | null } {
    return {
      isConnected: this.isConnected,
      reconnectAttempts: this.reconnectAttempts,
      sessionId: this.sessionId
    }
  }

  /**
   * Enable persistent reconnection (bot will always try to stay connected)
   */
  enablePersistentReconnect(): void {
    this.persistentReconnect = true
  }

  /**
   * Disable persistent reconnection
   */
  disablePersistentReconnect(): void {
    this.persistentReconnect = false
  }

  /**
   * Check Discord API status before attempting connection
   */
  private async checkDiscordApiStatus(): Promise<{ available: boolean; message: string }> {
    try {
      // Check Discord's status API
      const statusResponse = await fetch('https://discordstatus.com/api/v2/status.json', {
        headers: {
          'User-Agent': 'ChainReact-DiscordGateway/1.0'
        }
      })
      
      if (statusResponse.ok) {
        const statusData = await statusResponse.json()
        const isOperational = statusData.status?.indicator === 'none' || statusData.status?.indicator === 'minor'
        
        return {
          available: isOperational,
          message: isOperational ? 'Discord API is operational' : `Discord API status: ${statusData.status?.description || 'Unknown'}`
        }
      }
    } catch (error) {
      // If we can't check status, assume it's available
      logger.warn('Unable to check Discord API status:', error)
    }
    
    return { available: true, message: 'Unable to verify Discord API status, proceeding anyway' }
  }

  /**
   * Get detailed connection diagnostics
   */
  getDiagnostics(): {
    isConnected: boolean
    reconnectAttempts: number
    sessionId: string | null
    lastSuccessfulConnection: number
    timeSinceLastSuccess: number
    heartbeatAck: boolean
  } {
    return {
      isConnected: this.isConnected,
      reconnectAttempts: this.reconnectAttempts,
      sessionId: this.sessionId,
      lastSuccessfulConnection: this.lastSuccessfulConnection,
      timeSinceLastSuccess: Date.now() - this.lastSuccessfulConnection,
      heartbeatAck: this.heartbeatAck
    }
  }
}

// Export singleton instance getter
export const discordGateway = DiscordGateway.getInstance()

// Track if we've already initialized
let isInitialized = false

/**
 * Initialize Discord Gateway connection (singleton pattern)
 */
export async function initializeDiscordGateway(): Promise<void> {
  // Prevent multiple initializations
  if (isInitialized) {
    logger.info('Discord Gateway already initialized, skipping')
    return
  }

  try {
    // Check if Discord bot is configured before attempting to connect
    const config = checkDiscordBotConfig()

    if (!config.isConfigured) {
      // Discord bot not configured, don't attempt to connect
      logger.info('Discord bot not configured, skipping Gateway connection')
      return
    }

    // Mark as initialized before attempting connection
    isInitialized = true

    logger.info('Initializing Discord Gateway connection (singleton)...')

    // Get singleton instance
    const gateway = DiscordGateway.getInstance()

    // Check if already connected
    const status = gateway.getStatus()
    if (status.isConnected) {
      logger.info('Discord Gateway already connected')
      return
    }

    // DO NOT enable persistent reconnection by default - let Discord handle it
    // Only reconnect on actual disconnections, not proactively
    // gateway.enablePersistentReconnect() // COMMENTED OUT to prevent aggressive reconnection

    // Connect with singleton protection
    await gateway.connect()

    logger.info('Discord Gateway initialization complete')
  } catch (error) {
    logger.error('Discord Gateway initialization failed:', error)
    // Don't retry automatically to avoid connection spam
    isInitialized = false
  }
}

/**
 * Update Discord bot presence for actions
 */
export function updateDiscordPresenceForAction(): void {
  discordGateway.updatePresence({
    status: "online",
    activities: [
      {
        name: "sending messages",
        type: 0 // Playing
      }
    ]
  })
} 
