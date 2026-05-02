/**
 * Lazy-initialized Anthropic client singleton.
 *
 * Usage:
 *   import { getAnthropicClient } from '@/lib/ai/anthropic-client'
 *   const client = getAnthropicClient()
 *
 * NEVER do `new Anthropic()` at module level — it breaks CI builds
 * when ANTHROPIC_API_KEY is not set.
 */

import Anthropic from '@anthropic-ai/sdk'

let _client: Anthropic | null = null

/**
 * Returns a cached Anthropic client using the app's API key.
 * Created on first call (lazy) so the import alone never throws.
 */
export function getAnthropicClient(): Anthropic {
  if (!_client) {
    const apiKey = process.env.ANTHROPIC_API_KEY
    if (!apiKey) {
      throw new Error('ANTHROPIC_API_KEY is not configured')
    }
    _client = new Anthropic({ apiKey })
  }
  return _client
}

/**
 * Returns an Anthropic client with a custom API key.
 * Used for user-provided keys (e.g., in AI agent actions).
 * Does NOT cache — each call creates a new instance.
 *
 * Mirrors `getOpenAIClientWithKey` from openai-client.ts.
 */
export function getAnthropicClientWithKey(apiKey: string): Anthropic {
  return new Anthropic({ apiKey })
}

/**
 * Reset the cached client (for testing).
 */
export function resetAnthropicClient(): void {
  _client = null
}
