/**
 * Provider Disambiguation Utility
 * Detects vague provider terms and helps users select the right integration
 */

import { isConnectedStatus } from "@/lib/integrations/connectionStatus"

export interface ProviderCategory {
  vagueTerm: string // "email", "calendar", "storage"
  displayName: string // "Email", "Calendar", "File Storage"
  providers: string[] // ["gmail", "outlook", "yahoo-mail"]
}

export const PROVIDER_CATEGORIES: ProviderCategory[] = [
  {
    vagueTerm: 'email',
    displayName: 'Email',
    providers: ['gmail', 'outlook', 'yahoo-mail']
  },
  {
    vagueTerm: 'calendar',
    displayName: 'Calendar',
    providers: ['google-calendar', 'outlook']
  },
  {
    vagueTerm: 'storage',
    displayName: 'File Storage',
    providers: ['google-drive', 'dropbox', 'onedrive']
  },
  {
    vagueTerm: 'files',
    displayName: 'File Storage',
    providers: ['google-drive', 'dropbox', 'onedrive']
  },
  {
    vagueTerm: 'spreadsheet',
    displayName: 'Spreadsheet',
    providers: ['google-sheets', 'airtable', 'microsoft-excel']
  },
  {
    vagueTerm: 'chat',
    displayName: 'Chat/Messaging',
    providers: ['slack', 'discord', 'microsoft-teams']
  },
  {
    vagueTerm: 'notification',
    displayName: 'Notification',
    providers: ['slack', 'discord', 'microsoft-teams']
  },
  {
    vagueTerm: 'message',
    displayName: 'Messaging',
    providers: ['slack', 'discord', 'microsoft-teams']
  },
  {
    vagueTerm: 'alert',
    displayName: 'Alert',
    providers: ['slack', 'discord', 'microsoft-teams']
  },
  {
    vagueTerm: 'crm',
    displayName: 'CRM',
    providers: ['hubspot', 'salesforce']
  },
  {
    vagueTerm: 'documents',
    displayName: 'Documents',
    providers: ['google-docs', 'notion', 'onenote']
  },
  {
    vagueTerm: 'notes',
    displayName: 'Notes',
    providers: ['notion', 'onenote', 'evernote']
  },
  {
    vagueTerm: 'task',
    displayName: 'Task Management',
    providers: ['trello', 'asana', 'notion']
  },
  {
    vagueTerm: 'social',
    displayName: 'Social Media',
    providers: ['twitter', 'facebook', 'linkedin', 'instagram']
  }
]

export interface VagueTermDetection {
  found: boolean
  category: ProviderCategory | null
  position: number // Index in prompt where term was found
}

/**
 * Get patterns for detecting a vague term in a prompt
 */
function getVagueTermPatterns(vagueTerm: string): RegExp[] {
  return [
    // Basic patterns
    new RegExp(`\\b(an?|the|my)\\s+${vagueTerm}\\b`, 'i'),
    new RegExp(`\\b${vagueTerm}\\s+(app|service|account)\\b`, 'i'),
    new RegExp(`\\bget\\s+(an?\\s+)?${vagueTerm}\\b`, 'i'),
    new RegExp(`\\bsend\\s+to\\s+${vagueTerm}\\b`, 'i'),
    new RegExp(`\\bfrom\\s+(my\\s+)?${vagueTerm}\\b`, 'i'),
    new RegExp(`\\bsave\\s+to\\s+${vagueTerm}\\b`, 'i'),
    new RegExp(`\\b${vagueTerm}\\s+(trigger|notification)\\b`, 'i'),
    // Additional patterns for notification/message/alert
    new RegExp(`\\bsend\\s+(me\\s+)?(an?\\s+)?${vagueTerm}\\b`, 'i'),
    new RegExp(`\\b${vagueTerm}\\s+me\\b`, 'i'),
    new RegExp(`\\breceive\\s+(an?\\s+)?${vagueTerm}\\b`, 'i'),
    new RegExp(`\\bpost\\s+(an?\\s+)?${vagueTerm}\\b`, 'i'),
    // Standalone match for common terms (notification, message, alert)
    ...((['notification', 'message', 'alert'].includes(vagueTerm))
      ? [new RegExp(`\\b${vagueTerm}s?\\b`, 'i')]
      : []),
  ]
}

/**
 * Detects if a prompt contains vague provider terms
 * Returns the FIRST match found (for backwards compatibility)
 */
export function detectVagueTerms(prompt: string): VagueTermDetection {
  const normalized = prompt.toLowerCase()

  for (const category of PROVIDER_CATEGORIES) {
    const patterns = getVagueTermPatterns(category.vagueTerm)

    for (const pattern of patterns) {
      const match = normalized.match(pattern)
      if (match) {
        return {
          found: true,
          category,
          position: match.index || 0
        }
      }
    }
  }

  return { found: false, category: null, position: -1 }
}

/**
 * Detects ALL vague provider terms in a prompt
 * Returns them in order of appearance in the prompt
 */
export function detectAllVagueTerms(prompt: string): VagueTermDetection[] {
  const normalized = prompt.toLowerCase()
  const results: VagueTermDetection[] = []
  const seenDisplayNames = new Set<string>() // Avoid duplicates (e.g., "notification" and "message" are same category)

  for (const category of PROVIDER_CATEGORIES) {
    // Skip if we already have a match for this display name (same providers)
    if (seenDisplayNames.has(category.displayName)) continue

    const patterns = getVagueTermPatterns(category.vagueTerm)

    for (const pattern of patterns) {
      const match = normalized.match(pattern)
      if (match) {
        seenDisplayNames.add(category.displayName)
        results.push({
          found: true,
          category,
          position: match.index || 0
        })
        break // Found a match for this category, move to next
      }
    }
  }

  // Sort by position in prompt (ask about earlier terms first)
  return results.sort((a, b) => a.position - b.position)
}

export interface ProviderOption {
  id: string // "gmail", "outlook"
  displayName: string // "Gmail", "Outlook"
  icon: string // Icon identifier
  isConnected: boolean
  integrationId?: string // Integration ID if connected
}

/**
 * Gets provider options for a category, marking which are connected
 */
export function getProviderOptions(
  category: ProviderCategory,
  connectedIntegrations: Array<{ provider: string; id: string; status: string }>
): ProviderOption[] {
  return category.providers.map(providerId => {
    const integration = connectedIntegrations.find(
      i => i.provider === providerId && isConnectedStatus(i.status)
    )

    return {
      id: providerId,
      displayName: getProviderDisplayName(providerId),
      icon: getProviderIcon(providerId),
      isConnected: !!integration,
      integrationId: integration?.id
    }
  })
}

/**
 * Gets display name for a provider ID
 */
export function getProviderDisplayName(providerId: string): string {
  const displayNames: Record<string, string> = {
    'gmail': 'Gmail',
    'outlook': 'Outlook',
    'yahoo-mail': 'Yahoo Mail',
    'google-calendar': 'Google Calendar',
    'google-drive': 'Google Drive',
    'dropbox': 'Dropbox',
    'onedrive': 'OneDrive',
    'google-sheets': 'Google Sheets',
    'airtable': 'Airtable',
    'microsoft-excel': 'Microsoft Excel',
    'slack': 'Slack',
    'discord': 'Discord',
    'microsoft-teams': 'Microsoft Teams',
    'hubspot': 'HubSpot',
    'salesforce': 'Salesforce',
    'google-docs': 'Google Docs',
    'notion': 'Notion',
    'onenote': 'OneNote',
    'evernote': 'Evernote',
    'trello': 'Trello',
    'asana': 'Asana',
    'twitter': 'Twitter',
    'facebook': 'Facebook',
    'linkedin': 'LinkedIn',
    'instagram': 'Instagram'
  }

  return displayNames[providerId] || providerId
}

/**
 * Gets icon for a provider ID
 */
export function getProviderIcon(providerId: string): string {
  const icons: Record<string, string> = {
    'gmail': '📧',
    'outlook': '📧',
    'yahoo-mail': '📧',
    'google-calendar': '📅',
    'google-drive': '📁',
    'dropbox': '📁',
    'onedrive': '📁',
    'google-sheets': '📊',
    'airtable': '📊',
    'microsoft-excel': '📊',
    'slack': '💬',
    'discord': '💬',
    'microsoft-teams': '💬',
    'hubspot': '🤝',
    'salesforce': '🤝',
    'google-docs': '📄',
    'notion': '📝',
    'onenote': '📝',
    'evernote': '📝',
    'trello': '✅',
    'asana': '✅',
    'twitter': '🐦',
    'facebook': '👥',
    'linkedin': '💼',
    'instagram': '📸'
  }

  return icons[providerId] || '🔌'
}

/**
 * Replaces vague term in prompt with specific provider
 * Example: "when I get an email" + "gmail" -> "when I get a Gmail email"
 */
export function replaceVagueTermWithProvider(
  prompt: string,
  vagueTerm: string,
  providerId: string
): string {
  const providerName = getProviderDisplayName(providerId)
  const normalized = prompt.toLowerCase()

  // Patterns to replace
  const replacements = [
    { pattern: new RegExp(`\\b(an?|the|my)\\s+${vagueTerm}\\b`, 'gi'), replacement: `a ${providerName}` },
    { pattern: new RegExp(`\\b${vagueTerm}\\s+(app|service|account)\\b`, 'gi'), replacement: `${providerName}` },
    { pattern: new RegExp(`\\bget\\s+(an?\\s+)?${vagueTerm}\\b`, 'gi'), replacement: `get a ${providerName}` },
    { pattern: new RegExp(`\\bsend\\s+to\\s+${vagueTerm}\\b`, 'gi'), replacement: `send to ${providerName}` },
    { pattern: new RegExp(`\\bfrom\\s+(my\\s+)?${vagueTerm}\\b`, 'gi'), replacement: `from ${providerName}` },
  ]

  let result = prompt
  for (const { pattern, replacement } of replacements) {
    if (pattern.test(result)) {
      result = result.replace(pattern, replacement)
      break // Only replace first match
    }
  }

  return result
}

/**
 * Specific app pattern definitions for detecting explicitly mentioned apps
 */
interface SpecificAppPattern {
  patterns: RegExp[]
  provider: string
  category: string // Which category this provider belongs to
}

const SPECIFIC_APP_PATTERNS: SpecificAppPattern[] = [
  // Email
  { patterns: [/\bgmail\b/i, /\bgoogle\s*mail\b/i], provider: 'gmail', category: 'email' },
  { patterns: [/\boutlook\b/i, /\bmicrosoft\s*(outlook|mail)\b/i, /\bhotmail\b/i], provider: 'outlook', category: 'email' },
  { patterns: [/\byahoo\s*mail\b/i], provider: 'yahoo-mail', category: 'email' },

  // Calendar
  { patterns: [/\bgoogle\s*calendar\b/i, /\bgcal\b/i], provider: 'google-calendar', category: 'calendar' },
  { patterns: [/\boutlook\s*calendar\b/i], provider: 'outlook', category: 'calendar' },

  // Chat/Messaging
  { patterns: [/\bslack\b/i], provider: 'slack', category: 'notification' },
  { patterns: [/\bdiscord\b/i], provider: 'discord', category: 'notification' },
  { patterns: [/\bteams\b/i, /\bmicrosoft\s*teams\b/i, /\bms\s*teams\b/i], provider: 'microsoft-teams', category: 'notification' },

  // Storage
  { patterns: [/\bgoogle\s*drive\b/i, /\bgdrive\b/i], provider: 'google-drive', category: 'storage' },
  { patterns: [/\bdropbox\b/i], provider: 'dropbox', category: 'storage' },
  { patterns: [/\bonedrive\b/i, /\bone\s*drive\b/i], provider: 'onedrive', category: 'storage' },

  // Spreadsheets
  { patterns: [/\bgoogle\s*sheets?\b/i, /\bgsheets?\b/i], provider: 'google-sheets', category: 'spreadsheet' },
  { patterns: [/\bairtable\b/i], provider: 'airtable', category: 'spreadsheet' },
  { patterns: [/\bexcel\b/i, /\bmicrosoft\s*excel\b/i], provider: 'microsoft-excel', category: 'spreadsheet' },

  // Documents/Notes
  { patterns: [/\bgoogle\s*docs?\b/i, /\bgdocs?\b/i], provider: 'google-docs', category: 'documents' },
  { patterns: [/\bnotion\b/i], provider: 'notion', category: 'documents' },
  { patterns: [/\bonenote\b/i, /\bone\s*note\b/i], provider: 'onenote', category: 'notes' },
  { patterns: [/\bevernote\b/i], provider: 'evernote', category: 'notes' },

  // CRM
  { patterns: [/\bhubspot\b/i], provider: 'hubspot', category: 'crm' },
  { patterns: [/\bsalesforce\b/i, /\bsfdc\b/i], provider: 'salesforce', category: 'crm' },

  // Task Management
  { patterns: [/\btrello\b/i], provider: 'trello', category: 'task' },
  { patterns: [/\basana\b/i], provider: 'asana', category: 'task' },

  // Social Media
  { patterns: [/\btwitter\b/i, /\bx\.com\b/i], provider: 'twitter', category: 'social' },
  { patterns: [/\bfacebook\b/i, /\bfb\b/i], provider: 'facebook', category: 'social' },
  { patterns: [/\blinkedin\b/i], provider: 'linkedin', category: 'social' },
  { patterns: [/\binstagram\b/i, /\big\b/i], provider: 'instagram', category: 'social' },

  // Other integrations
  { patterns: [/\bstripe\b/i], provider: 'stripe', category: 'payment' },
  { patterns: [/\bshopify\b/i], provider: 'shopify', category: 'ecommerce' },
  { patterns: [/\bgithub\b/i], provider: 'github', category: 'development' },
  { patterns: [/\bmailchimp\b/i], provider: 'mailchimp', category: 'marketing' },
  { patterns: [/\bgumroad\b/i], provider: 'gumroad', category: 'ecommerce' },
]

export interface DetectedApp {
  provider: string
  category: string
  displayName: string
}

/**
 * Detects specific apps mentioned in a prompt
 * Use this to avoid re-asking users which app to use when they already specified it
 *
 * @example
 * detectSpecificApps("When I receive an email, send to Slack")
 * // Returns: [{ provider: 'slack', category: 'notification', displayName: 'Slack' }]
 *
 * @example
 * detectSpecificApps("Sync Gmail to Google Sheets")
 * // Returns: [
 * //   { provider: 'gmail', category: 'email', displayName: 'Gmail' },
 * //   { provider: 'google-sheets', category: 'spreadsheet', displayName: 'Google Sheets' }
 * // ]
 */
export function detectSpecificApps(prompt: string): DetectedApp[] {
  const detectedApps: Array<DetectedApp & { position: number }> = []
  const seenProviders = new Set<string>()

  for (const appPattern of SPECIFIC_APP_PATTERNS) {
    // Skip if we already detected this provider
    if (seenProviders.has(appPattern.provider)) continue

    for (const pattern of appPattern.patterns) {
      const match = pattern.exec(prompt)
      if (match) {
        seenProviders.add(appPattern.provider)
        detectedApps.push({
          provider: appPattern.provider,
          category: appPattern.category,
          displayName: getProviderDisplayName(appPattern.provider),
          position: match.index, // Track position in prompt
        })
        break // Found a match for this app, move to next
      }
    }
  }

  // Sort by position in prompt (trigger apps typically appear before action apps)
  detectedApps.sort((a, b) => a.position - b.position)

  // Remove position field before returning
  return detectedApps.map(({ position, ...app }) => app)
}

/**
 * Get the category for a specific provider
 */
export function getProviderCategory(providerId: string): string | null {
  const appPattern = SPECIFIC_APP_PATTERNS.find(p => p.provider === providerId)
  return appPattern?.category || null
}
