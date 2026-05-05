/**
 * Enhanced AI Conversation Handler for HITL
 * Provides intelligent, context-aware conversational assistance with:
 * - Dynamic message formatting based on workflow context
 * - Intelligent file search across connected storage
 * - Multi-turn conversational understanding
 * - Adaptive response generation
 */

import { getOpenAIClient } from '@/lib/ai/openai-client'
import type OpenAI from 'openai'
import type { HITLConfig, ConversationMessage, ExtractedVariables } from './types'
import { logger } from '@/lib/utils/logger'
import { createSupabaseServerClient } from '@/utils/supabase/server'
import { CONNECTED_STATUSES_LIST } from "@/lib/integrations/connectionStatus"

/**
 * Format email data in a user-friendly way (like in an inbox)
 */
export function formatEmailForDisplay(email: any): string {
  const lines: string[] = []

  lines.push('┌─────────────────────────────────────────')
  lines.push('│ 📧 **EMAIL**')
  lines.push('├─────────────────────────────────────────')

  if (email.from) {
    lines.push(`│ **From:** ${email.from}`)
  }
  if (email.to) {
    const recipients = Array.isArray(email.to) ? email.to.join(', ') : email.to
    lines.push(`│ **To:** ${recipients}`)
  }
  if (email.subject) {
    lines.push(`│ **Subject:** ${email.subject}`)
  }
  if (email.timestamp || email.date) {
    const date = new Date(email.timestamp || email.date).toLocaleString()
    lines.push(`│ **Date:** ${date}`)
  }

  lines.push('├─────────────────────────────────────────')

  if (email.body || email.snippet) {
    const body = email.body || email.snippet
    const formatted = body
      .trim()
      .split('\n')
      .map((line: string) => `│ ${line}`)
      .join('\n')
    lines.push(formatted)
  }

  lines.push('└─────────────────────────────────────────')

  return lines.join('\n')
}

/**
 * Format a draft response for display
 */
export function formatDraftResponse(draft: any): string {
  const lines: string[] = []

  lines.push('┌─────────────────────────────────────────')
  lines.push('│ ✍️  **DRAFT RESPONSE**')
  lines.push('├─────────────────────────────────────────')

  if (draft.subject) {
    lines.push(`│ **Subject:** ${draft.subject}`)
  }

  lines.push('├─────────────────────────────────────────')

  if (draft.body || draft.content) {
    const body = draft.body || draft.content
    const formatted = body
      .trim()
      .split('\n')
      .map((line: string) => `│ ${line}`)
      .join('\n')
    lines.push(formatted)
  }

  lines.push('└─────────────────────────────────────────')

  return lines.join('\n')
}

/**
 * Detect the type of workflow and extract relevant data
 */
export function detectWorkflowContext(input: Record<string, any>): {
  type: 'email_response' | 'task_management' | 'general'
  triggerData: any
  actionData: any
  description: string
} {
  // Check for email trigger
  if (input.email || input.message?.email || input.subject || input.from) {
    const email = input.email || input.message?.email || input
    return {
      type: 'email_response',
      triggerData: email,
      actionData: input.draft || input.response || null,
      description: 'Email response workflow'
    }
  }

  // Check for task/project management
  if (input.task || input.tasks || input.project || input.issue) {
    return {
      type: 'task_management',
      triggerData: input,
      actionData: null,
      description: 'Task or project management workflow'
    }
  }

  // General workflow
  return {
    type: 'general',
    triggerData: input,
    actionData: null,
    description: 'General workflow automation'
  }
}

/**
 * Generate context-aware initial message based on workflow type
 */
export async function generateContextAwareMessage(
  input: Record<string, any>,
  config: HITLConfig
): Promise<string> {
  const context = detectWorkflowContext(input)

  try {
    const systemPrompt = `You are a helpful workflow assistant. Generate a clear, conversational message to present this workflow step to the user.

Be professional but friendly. Format the message to be easy to read in Discord.

Workflow Type: ${context.type}
Context: ${context.description}`

    const userPrompt = context.type === 'email_response'
      ? generateEmailResponsePrompt(context.triggerData, context.actionData)
      : generateGeneralPrompt(input)

    const response = await getOpenAIClient().chat.completions.create({
      model: 'gpt-4',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt }
      ],
      temperature: 0.7,
      max_tokens: 800
    })

    return response.choices[0]?.message?.content || generateFallbackMessage(context, input)
  } catch (error: any) {
    logger.warn('Failed to generate AI message, using fallback', { error: error.message })
    return generateFallbackMessage(context, input)
  }
}

/**
 * Generate prompt for email response workflows
 */
function generateEmailResponsePrompt(email: any, draft: any): string {
  const emailDisplay = formatEmailForDisplay(email)
  const draftDisplay = draft ? formatDraftResponse(draft) : null

  return `I need to present an email response workflow to the user. Here's what I have:

${emailDisplay}

${draftDisplay ? `\n${draftDisplay}\n` : ''}

Generate a friendly message that:
1. Shows the email they received (already formatted above - include it)
${draftDisplay ? '2. Shows the draft response (already formatted above - include it)' : '2. Asks if they want to draft a response'}
3. Asks "Would you like me to send this?" or similar
4. Mentions they can ask for changes or provide additional context

Keep it conversational and under 200 words.`
}

/**
 * Generate prompt for general workflows
 */
function generateGeneralPrompt(input: Record<string, any>): string {
  return `Generate a message presenting this workflow data to the user:

${JSON.stringify(input, null, 2)}

Make it clear what action is about to be taken and ask for their approval or input.`
}

/**
 * Generate fallback message if AI fails
 */
function generateFallbackMessage(
  context: ReturnType<typeof detectWorkflowContext>,
  input: Record<string, any>
): string {
  if (context.type === 'email_response') {
    const email = context.triggerData
    const draft = context.actionData

    let message = '👋 Hi! I received an email that needs your attention.\n\n'
    message += formatEmailForDisplay(email)
    message += '\n\n'

    if (draft) {
      message += 'Here\'s the draft response I prepared:\n\n'
      message += formatDraftResponse(draft)
      message += '\n\n**Would you like me to send this?**\n\n'
    } else {
      message += '**How would you like me to respond?**\n\n'
    }

    message += 'You can:\n'
    message += '• Say "yes" or "send it" to proceed\n'
    message += '• Ask me to change something\n'
    message += '• Request additional information from our files\n'

    return message
  }

  return `Hello! This workflow needs your input to continue.\n\nPlease review and let me know how to proceed.`
}

/**
 * Get list of connected storage integrations for the user
 */
export async function getConnectedStorageIntegrations(userId: string): Promise<string[]> {
  try {
    const supabase = await createSupabaseServerClient()

    const { data: integrations, error } = await supabase
      .from('integrations')
      .select('provider')
      .eq('user_id', userId)
      .in('status', CONNECTED_STATUSES_LIST)
      .in('provider', ['google_drive', 'google_docs', 'onedrive', 'notion', 'dropbox'])

    if (error || !integrations) {
      logger.error('Failed to fetch storage integrations', { error })
      return []
    }

    return integrations.map(i => i.provider)
  } catch (error: any) {
    logger.error('Error getting storage integrations', { error: error.message })
    return []
  }
}

/**
 * Search for files across connected storage platforms
 */
export async function searchFiles(
  userId: string,
  query: string,
  providers: string[]
): Promise<Array<{ provider: string; name: string; url: string; snippet?: string; id: string; type?: string }>> {
  logger.info('File search requested', { userId, query, providers })

  const results: Array<{ provider: string; name: string; url: string; snippet?: string; id: string; type?: string }> = []

  // Search each provider in parallel
  const searchPromises = providers.map(async (provider) => {
    try {
      switch (provider) {
        case 'google_drive':
        case 'google-drive':
          return await searchGoogleDrive(userId, query)
        case 'onedrive':
          return await searchOneDrive(userId, query)
        case 'notion':
          return await searchNotion(userId, query)
        case 'google_docs':
        case 'google-docs':
          return await searchGoogleDocs(userId, query)
        default:
          logger.warn('Unsupported search provider', { provider })
          return []
      }
    } catch (error: any) {
      logger.error('Error searching provider', { provider, error: error.message })
      return []
    }
  })

  const providerResults = await Promise.all(searchPromises)
  providerResults.forEach(providerResult => results.push(...providerResult))

  // Rank and deduplicate results
  return rankAndDeduplicateResults(results, query)
}

/**
 * Search Google Drive for files matching query
 */
async function searchGoogleDrive(
  userId: string,
  query: string
): Promise<Array<{ provider: string; name: string; url: string; snippet?: string; id: string; type?: string }>> {
  try {
    const { google } = await import('googleapis')
    const { decrypt } = await import('@/lib/security/encryption')
    const supabase = await createSupabaseServerClient()

    // Get Google Drive integration
    const { data: integration, error } = await supabase
      .from('integrations')
      .select('*')
      .eq('user_id', userId)
      .eq('provider', 'google-drive')
      .in('status', CONNECTED_STATUSES_LIST)
      .single()

    if (error || !integration) {
      logger.warn('Google Drive not connected for user', { userId })
      return []
    }

    const accessToken = decrypt(integration.access_token!)

    // Initialize Google Drive API
    const oauth2Client = new google.auth.OAuth2()
    oauth2Client.setCredentials({ access_token: accessToken })
    const drive = google.drive({ version: 'v3', auth: oauth2Client })

    // Search for files matching query
    const searchQuery = `fullText contains '${query.replace(/'/g, "\\'")}' and trashed=false`

    const response = await drive.files.list({
      q: searchQuery,
      fields: 'files(id, name, mimeType, webViewLink, description, modifiedTime, size)',
      pageSize: 20, // Limit to top 20 results
      orderBy: 'modifiedTime desc'
    })

    const files = response.data.files || []

    return files.map(file => ({
      provider: 'google-drive',
      id: file.id!,
      name: file.name!,
      url: file.webViewLink!,
      type: file.mimeType ?? undefined,
      snippet: file.description || `Modified ${new Date(file.modifiedTime!).toLocaleDateString()}`
    }))
  } catch (error: any) {
    logger.error('Error searching Google Drive', { error: error.message })
    return []
  }
}

/**
 * Search Google Docs specifically
 */
async function searchGoogleDocs(
  userId: string,
  query: string
): Promise<Array<{ provider: string; name: string; url: string; snippet?: string; id: string; type?: string }>> {
  try {
    const { google } = await import('googleapis')
    const { decrypt } = await import('@/lib/security/encryption')
    const supabase = await createSupabaseServerClient()

    // Get Google Drive integration (Google Docs uses Drive API)
    const { data: integration, error } = await supabase
      .from('integrations')
      .select('*')
      .eq('user_id', userId)
      .in('provider', ['google-drive', 'google-docs'])
      .in('status', CONNECTED_STATUSES_LIST)
      .single()

    if (error || !integration) {
      logger.warn('Google Docs/Drive not connected for user', { userId })
      return []
    }

    const accessToken = decrypt(integration.access_token!)

    const oauth2Client = new google.auth.OAuth2()
    oauth2Client.setCredentials({ access_token: accessToken })
    const drive = google.drive({ version: 'v3', auth: oauth2Client })

    // Search specifically for Google Docs documents
    const searchQuery = `fullText contains '${query.replace(/'/g, "\\'")}' and mimeType='application/vnd.google-apps.document' and trashed=false`

    const response = await drive.files.list({
      q: searchQuery,
      fields: 'files(id, name, webViewLink, description, modifiedTime)',
      pageSize: 15,
      orderBy: 'modifiedTime desc'
    })

    const files = response.data.files || []

    return files.map(file => ({
      provider: 'google-docs',
      id: file.id!,
      name: file.name!,
      url: file.webViewLink!,
      type: 'document',
      snippet: file.description || `Google Doc • Modified ${new Date(file.modifiedTime!).toLocaleDateString()}`
    }))
  } catch (error: any) {
    logger.error('Error searching Google Docs', { error: error.message })
    return []
  }
}

/**
 * Search OneDrive for files matching query
 */
async function searchOneDrive(
  userId: string,
  query: string
): Promise<Array<{ provider: string; name: string; url: string; snippet?: string; id: string; type?: string }>> {
  try {
    const { decrypt } = await import('@/lib/security/encryption')
    const supabase = await createSupabaseServerClient()

    // Get OneDrive integration
    const { data: integration, error } = await supabase
      .from('integrations')
      .select('*')
      .eq('user_id', userId)
      .eq('provider', 'onedrive')
      .in('status', CONNECTED_STATUSES_LIST)
      .single()

    if (error || !integration) {
      logger.warn('OneDrive not connected for user', { userId })
      return []
    }

    const accessToken = decrypt(integration.access_token!)

    // Search OneDrive using Microsoft Graph API
    const searchUrl = `https://graph.microsoft.com/v1.0/me/drive/search(q='${encodeURIComponent(query)}')?$top=20&$select=id,name,webUrl,file,lastModifiedDateTime,size`

    const response = await fetch(searchUrl, {
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json'
      }
    })

    if (!response.ok) {
      throw new Error(`OneDrive API error: ${response.status}`)
    }

    const data = await response.json()
    const files = data.value || []

    return files
      .filter((item: any) => item.file) // Only files, not folders
      .map((file: any) => ({
        provider: 'onedrive',
        id: file.id,
        name: file.name,
        url: file.webUrl,
        type: file.file?.mimeType,
        snippet: `Modified ${new Date(file.lastModifiedDateTime).toLocaleDateString()}`
      }))
  } catch (error: any) {
    logger.error('Error searching OneDrive', { error: error.message })
    return []
  }
}

/**
 * Search Notion for pages matching query
 */
async function searchNotion(
  userId: string,
  query: string
): Promise<Array<{ provider: string; name: string; url: string; snippet?: string; id: string; type?: string }>> {
  try {
    const { decrypt } = await import('@/lib/security/encryption')
    const supabase = await createSupabaseServerClient()

    // Get Notion integration
    const { data: integration, error } = await supabase
      .from('integrations')
      .select('*')
      .eq('user_id', userId)
      .eq('provider', 'notion')
      .in('status', CONNECTED_STATUSES_LIST)
      .single()

    if (error || !integration) {
      logger.warn('Notion not connected for user', { userId })
      return []
    }

    const accessToken = decrypt(integration.access_token!)

    // Search Notion pages
    const searchResponse = await fetch('https://api.notion.com/v1/search', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Notion-Version': '2022-06-28',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        query: query,
        filter: {
          property: 'object',
          value: 'page'
        },
        page_size: 15
      })
    })

    if (!searchResponse.ok) {
      throw new Error(`Notion API error: ${searchResponse.status}`)
    }

    const data = await searchResponse.json()
    const pages = data.results || []

    return pages.map((page: any) => {
      // Extract title from Notion page properties
      let title = 'Untitled'
      if (page.properties) {
        for (const [propName, prop] of Object.entries(page.properties)) {
          if ((prop as any).type === 'title' && (prop as any).title?.length > 0) {
            title = (prop as any).title[0]?.plain_text || 'Untitled'
            break
          }
        }
      }

      return {
        provider: 'notion',
        id: page.id,
        name: title,
        url: page.url,
        type: 'page',
        snippet: `Last edited ${new Date(page.last_edited_time).toLocaleDateString()}`
      }
    })
  } catch (error: any) {
    logger.error('Error searching Notion', { error: error.message })
    return []
  }
}

/**
 * Rank and deduplicate search results
 */
function rankAndDeduplicateResults(
  results: Array<{ provider: string; name: string; url: string; snippet?: string; id: string; type?: string }>,
  query: string
): Array<{ provider: string; name: string; url: string; snippet?: string; id: string; type?: string }> {
  // Remove duplicates based on URL or name
  const seen = new Set<string>()
  const unique = results.filter(result => {
    const key = result.url || result.name
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })

  // Rank by relevance (simple scoring)
  const queryLower = query.toLowerCase()
  const scored = unique.map(result => {
    let score = 0
    const nameLower = result.name.toLowerCase()

    // Exact match in name
    if (nameLower === queryLower) score += 100

    // Name starts with query
    if (nameLower.startsWith(queryLower)) score += 50

    // Name contains query
    if (nameLower.includes(queryLower)) score += 25

    // Match individual words
    const queryWords = queryLower.split(/\s+/)
    queryWords.forEach(word => {
      if (nameLower.includes(word)) score += 10
    })

    return { ...result, score }
  })

  // Sort by score (highest first) and return top 10
  return scored
    .sort((a, b) => b.score - a.score)
    .slice(0, 10)
    .map(({ score, ...result }) => result) // Remove score from final result
}

/**
 * Enhanced conversation processing with intelligent file search
 */
export async function processEnhancedConversation(
  userMessage: string,
  conversationHistory: ConversationMessage[],
  config: HITLConfig,
  contextData: any,
  userId: string,
  customSystemPrompt?: string
): Promise<{
  aiResponse: string
  shouldContinue: boolean
  extractedVariables?: ExtractedVariables
  summary?: string
  needsFileSearch?: boolean
  searchQuery?: string
}> {
  logger.info('🧠 [HITL AI] Starting conversation processing', {
    userMessage: userMessage.substring(0, 100),
    historyLength: conversationHistory.length,
    hasCustomPrompt: !!customSystemPrompt
  })

  try {
    // Check if user is asking about files or policies
    const fileSearchKeywords = [
      'policy', 'policies', 'document', 'file', 'search',
      'look up', 'check', 'find', 'our guidelines', 'documentation'
    ]

    const needsFileSearch = fileSearchKeywords.some(keyword =>
      userMessage.toLowerCase().includes(keyword)
    )

    // Get connected storage providers
    const storageProviders = await getConnectedStorageIntegrations(userId)

    logger.info('🔌 [HITL AI] Storage providers', { providers: storageProviders })

    // Build enhanced system prompt
    // IMPORTANT: Always include contextData and initial message context
    // even when using customSystemPrompt, as it may not have been included
    let systemPrompt = customSystemPrompt || buildEnhancedSystemPrompt(
      config,
      contextData,
      storageProviders
    )

    // Ensure contextData is included in the prompt (it may have been omitted from customSystemPrompt)
    const contextDataString = typeof contextData === 'string' ? contextData : JSON.stringify(contextData, null, 2)
    const hasContextInPrompt = systemPrompt.includes('Context:') || systemPrompt.includes('context:')

    if (!hasContextInPrompt && contextDataString && contextDataString !== '{}' && contextDataString !== '""') {
      systemPrompt += `\n\n**Current Workflow Context:**\n${contextDataString}`
    }

    // Get the initial message from conversation history to reinforce context
    const initialAssistantMessage = conversationHistory.find(msg => msg.role === 'assistant')?.content
    if (initialAssistantMessage && !systemPrompt.includes(initialAssistantMessage.substring(0, 100))) {
      // The initial message contains the workflow context - remind the AI about it
      systemPrompt += `\n\n**IMPORTANT:** Your first message to the user (shown in conversation history) describes the specific workflow context. Answer questions based on that context - the data and scenario described in your initial message IS the workflow context you should reference.`
    }

    const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
      { role: 'system', content: systemPrompt },
      ...conversationHistory.map(msg => ({
        role: msg.role,
        content: msg.content
      })) as OpenAI.Chat.ChatCompletionMessageParam[],
      { role: 'user', content: userMessage }
    ]

    logger.info('📤 [HITL AI] Calling OpenAI API', {
      model: 'gpt-4',
      messageCount: messages.length,
      systemPromptLength: systemPrompt.length
    })

    // Define available tools with dynamic variable extraction
    const tools: OpenAI.Chat.ChatCompletionTool[] = [
      {
        type: 'function',
        function: {
          name: 'continue_workflow',
          description: `Call this when the user approves or is ready to continue the workflow.

IMPORTANT: Intelligently extract ALL relevant data from the conversation that would be useful for subsequent workflow steps. Analyze the context to determine what variables are needed.

Common extraction patterns:
- Email workflows: extract emailBody, emailSubject, recipientEmail, senderName
- Task workflows: extract taskTitle, taskDescription, assignee, dueDate, priority
- Approval workflows: extract decision, approverName, approvalNotes, conditions
- Content workflows: extract content, title, author, publishDate
- Meeting workflows: extract meetingTitle, attendees, meetingDate, meetingTime, agenda

Always include:
- decision: The user's final decision (approved/rejected/modified/continued)
- summary: Brief summary of what was discussed and decided

Add any other relevant variables based on what was discussed. Use camelCase for variable names.`,
          parameters: {
            type: 'object',
            properties: {
              extractedVariables: {
                type: 'object',
                description: 'Dynamically extracted variables from the conversation. Include ALL relevant data discussed. Always include "decision" field. Add context-specific fields like emailBody, recipientEmail, taskTitle, dueDate, etc. based on what was discussed.',
                additionalProperties: true,  // Allow any properties
                properties: {
                  decision: {
                    type: 'string',
                    description: 'The user\'s decision: "approved", "rejected", "modified", or "continued"'
                  }
                },
                required: ['decision']
              },
              summary: {
                type: 'string',
                description: 'Brief summary of what was decided and any key details'
              }
            },
            required: ['summary', 'extractedVariables']
          }
        }
      }
    ]

    // Add file search tool if user has storage integrations
    if (storageProviders.length > 0) {
      tools.push({
        type: 'function',
        function: {
          name: 'search_files',
          description: 'Search for files in the user\'s connected storage (Google Drive, OneDrive, Notion, etc.)',
          parameters: {
            type: 'object',
            properties: {
              query: {
                type: 'string',
                description: 'What to search for'
              },
              providers: {
                type: 'array',
                items: { type: 'string' },
                description: 'Which storage providers to search (if empty, search all)'
              }
            },
            required: ['query']
          }
        }
      })
    }

    // Call OpenAI
    const response = await getOpenAIClient().chat.completions.create({
      model: 'gpt-4',
      messages,
      tools,
      tool_choice: 'auto',
      temperature: 0.7,
      max_tokens: 1000
    })

    const choice = response.choices[0]

    logger.info('📥 [HITL AI] OpenAI response received', {
      finishReason: choice.finish_reason,
      hasToolCalls: !!(choice.message.tool_calls && choice.message.tool_calls.length > 0),
      toolCallCount: choice.message.tool_calls?.length || 0,
      contentLength: choice.message.content?.length || 0,
      usage: response.usage
    })

    // Check for tool calls
    if (choice.message.tool_calls && choice.message.tool_calls.length > 0) {
      for (const toolCall of choice.message.tool_calls) {
        logger.info('🔧 [HITL AI] Tool call detected', {
          toolName: toolCall.function.name,
          arguments: toolCall.function.arguments.substring(0, 200)
        })

        if (toolCall.function.name === 'continue_workflow') {
          const args = JSON.parse(toolCall.function.arguments)

          logger.info('✅ [HITL AI] Continuation signal! Workflow will resume', {
            summary: args.summary,
            extractedVariables: args.extractedVariables
          })

          return {
            aiResponse: `Perfect! I'll proceed with: ${args.summary}`,
            shouldContinue: true,
            extractedVariables: args.extractedVariables || {},
            summary: args.summary
          }
        }

        if (toolCall.function.name === 'search_files') {
          const args = JSON.parse(toolCall.function.arguments)
          const searchProviders = args.providers && args.providers.length > 0
            ? args.providers
            : storageProviders

          logger.info('🔍 [HITL AI] File search requested', { query: args.query, providers: searchProviders })

          return {
            aiResponse: storageProviders.length > 1
              ? `I can search for "${args.query}" in ${formatProviderList(searchProviders)}. Which would you like me to check?`
              : `Let me search for "${args.query}" in your ${formatProviderName(searchProviders[0])}...`,
            shouldContinue: false,
            needsFileSearch: true,
            searchQuery: args.query
          }
        }
      }
    }

    // Regular conversation response
    const aiResponse = choice.message.content || "I'm sorry, I didn't understand that. Can you rephrase?"

    logger.info('💬 [HITL AI] Regular conversation response', {
      responsePreview: aiResponse.substring(0, 100),
      shouldContinue: false
    })

    return {
      aiResponse,
      shouldContinue: false
    }

  } catch (error: any) {
    logger.error('❌ [HITL AI] Error in conversation processing', { error: error.message })

    // Fallback: check for simple continuation keywords
    const continuationSignals = config.continuationSignals || ['yes', 'send it', 'continue', 'proceed', 'go ahead', 'looks good', 'approve']
    const lowerMessage = userMessage.toLowerCase().trim()

    if (continuationSignals.some(signal => lowerMessage.includes(signal.toLowerCase()))) {
      return {
        aiResponse: 'Got it! Continuing the workflow...',
        shouldContinue: true,
        extractedVariables: {},
        summary: 'User approved'
      }
    }

    return {
      aiResponse: "I'm having trouble processing that. Please try again or say 'yes' to proceed.",
      shouldContinue: false
    }
  }
}

/**
 * Build enhanced system prompt with file search capabilities
 */
function buildEnhancedSystemPrompt(
  config: HITLConfig,
  contextData: any,
  storageProviders: string[]
): string {
  let prompt = `You are a helpful workflow assistant. You're having a conversation with the user about this workflow step.

Context:
${typeof contextData === 'string' ? contextData : JSON.stringify(contextData, null, 2)}

Your capabilities:
1. Answer questions about the workflow data
2. Accept modifications and suggestions
3. Detect when the user is ready to continue
4. Search for files and policies when requested

`

  if (storageProviders.length > 0) {
    prompt += `The user has these storage integrations connected: ${formatProviderList(storageProviders)}

When the user asks about policies, documents, or files, use the search_files function to help them find relevant information.

`
  }

  prompt += `Continuation signals (these mean approve/proceed):
- "yes" / "send it" / "go ahead"
- "looks good" / "approve"
- "continue" / "proceed"

When you detect approval, call the continue_workflow function.`

  return prompt
}

/**
 * Format provider names for display
 */
function formatProviderName(provider: string): string {
  const names: Record<string, string> = {
    google_drive: 'Google Drive',
    google_docs: 'Google Docs',
    onedrive: 'OneDrive',
    notion: 'Notion',
    dropbox: 'Dropbox'
  }
  return names[provider] || provider
}

/**
 * Format list of providers
 */
function formatProviderList(providers: string[]): string {
  if (providers.length === 0) return 'no storage'
  if (providers.length === 1) return formatProviderName(providers[0])
  if (providers.length === 2) return `${formatProviderName(providers[0])} and ${formatProviderName(providers[1])}`

  const formatted = providers.map(formatProviderName)
  return formatted.slice(0, -1).join(', ') + ', and ' + formatted[formatted.length - 1]
}
