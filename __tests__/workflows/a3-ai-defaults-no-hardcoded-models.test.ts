/**
 * §A3 — AI hardcoded defaults regression contract.
 *
 * Source: lib/workflows/actions/aiAgentAction.ts
 *
 * Pre-§A3 the AI agent handler had three hardcoded defaults at the
 * generation call site:
 *   - `config.model || 'gpt-4o-mini'`
 *   - `config.temperature ?? 0.7`
 *   - `config.maxTokens || 1500`
 *
 * The model literal violated the CLAUDE.md rule "never hardcode model
 * strings — use AI_MODELS." It also forced future model rollouts to
 * touch the handler instead of just `lib/ai/models.ts`.
 *
 * Resolution:
 *   - Model fallback now routes through `AI_MODELS.fast` from
 *     `@/lib/ai/models`.
 *   - Temperature / maxTokens fall back to named constants
 *     (`AI_AGENT_DEFAULT_TEMPERATURE`, `AI_AGENT_DEFAULT_MAX_TOKENS`)
 *     defined at the top of the handler file. The same values are
 *     declared as schema-level defaults in `aiAgentNode.ts`.
 *   - Inline `getOpenAIClient` / `getAnthropicClient` helpers were
 *     removed in favor of the shared clients in
 *     `lib/ai/{openai,anthropic}-client.ts`. Custom user keys go
 *     through the parallel `*WithKey` helpers.
 *
 * This test pins those decisions so a future PR can't silently
 * reintroduce a hardcoded model literal at the selection point or a
 * fresh `new OpenAI()` / `new Anthropic()` instantiation.
 *
 * Scope note: this test does NOT forbid model-literal STRING KEYS in
 * the per-model price book (`calculateCost`'s `costPer1kTokens`
 * lookup). That table is a price reference, not selection logic, and
 * intentionally enumerates a wider set of supported models than
 * `AI_MODELS` covers (e.g., `gpt-4-turbo`, `claude-3-*` for
 * back-compat with workflow rows authored when those were the latest).
 * Likewise, the `aiAgentNode.ts` schema's `options` array uses literal
 * model identifiers because they're user-facing UX values, not
 * runtime selection.
 */

import { readFileSync } from 'fs'
import { join } from 'path'

const HANDLER_PATH = join(
  __dirname,
  '../../lib/workflows/actions/aiAgentAction.ts',
)

const handlerSource = readFileSync(HANDLER_PATH, 'utf8')

describe('§A3 — AI agent handler no longer hardcodes selection defaults', () => {
  test('model fallback uses AI_MODELS, not a string literal', () => {
    // The single line that decides which model the request uses must
    // import its fallback from AI_MODELS — never a literal like
    // 'gpt-4o-mini' or 'gpt-4o' inline at the `||` site.
    const selectionLines = handlerSource
      .split('\n')
      .filter(
        (line) =>
          line.includes('config.model') &&
          (line.includes('||') || line.includes('??')) &&
          // Skip the documentation comment that quotes the OLD code.
          !line.trim().startsWith('*'),
      )

    expect(selectionLines.length).toBeGreaterThan(0)
    for (const line of selectionLines) {
      expect(line).toMatch(/AI_MODELS\./)
      expect(line).not.toMatch(/['"]gpt-/)
      expect(line).not.toMatch(/['"]claude-/)
    }
  })

  test('temperature fallback uses a named constant, not a numeric literal at the call site', () => {
    // Same defense-in-depth: the runtime fallback must reference a
    // named symbol so a future search-and-replace catches it.
    const selectionLines = handlerSource
      .split('\n')
      .filter(
        (line) =>
          line.includes('config.temperature') &&
          (line.includes('??') || line.includes('||')) &&
          !line.trim().startsWith('*'),
      )

    expect(selectionLines.length).toBeGreaterThan(0)
    for (const line of selectionLines) {
      expect(line).toMatch(/AI_AGENT_DEFAULT_TEMPERATURE/)
      // Forbid an inline `?? 0.7` or `?? 0.5` etc. at the call site.
      expect(line).not.toMatch(/(\?\?|\|\|)\s*\d+(\.\d+)?\s*$/)
    }
  })

  test('maxTokens fallback uses a named constant, not a numeric literal at the call site', () => {
    const selectionLines = handlerSource
      .split('\n')
      .filter(
        (line) =>
          line.includes('config.maxTokens') &&
          (line.includes('||') || line.includes('??')) &&
          !line.trim().startsWith('*'),
      )

    expect(selectionLines.length).toBeGreaterThan(0)
    for (const line of selectionLines) {
      expect(line).toMatch(/AI_AGENT_DEFAULT_MAX_TOKENS/)
      expect(line).not.toMatch(/(\?\?|\|\|)\s*\d+\s*$/)
    }
  })

  test('handler does not instantiate OpenAI or Anthropic directly (uses shared clients)', () => {
    // CLAUDE.md: shared AI clients are mandatory. The handler must
    // route through `@/lib/ai/{openai,anthropic}-client` so the
    // module-level fail-on-missing-env-var contract is preserved
    // across CI builds.
    //
    // Exclude comment lines so the assertion isn't tripped by
    // documentation that quotes the rule itself.
    const codeOnly = handlerSource
      .split('\n')
      .filter((line) => {
        const trimmed = line.trim()
        return !trimmed.startsWith('*') && !trimmed.startsWith('//')
      })
      .join('\n')

    expect(codeOnly).not.toMatch(/\bnew\s+OpenAI\s*\(/)
    expect(codeOnly).not.toMatch(/\bnew\s+Anthropic\s*\(/)
  })

  test('handler imports the shared AI clients and AI_MODELS', () => {
    // Defensive — the import lines themselves must be present so the
    // tests above have something to validate against. A future PR
    // that drops the imports would cause the model/temperature/
    // maxTokens assertions to misleadingly pass on a file that no
    // longer references AI_MODELS at all.
    expect(handlerSource).toMatch(
      /import\s*\{\s*AI_MODELS\s*\}\s*from\s*['"]@\/lib\/ai\/models['"]/,
    )
    expect(handlerSource).toMatch(
      /from\s*['"]@\/lib\/ai\/openai-client['"]/,
    )
    expect(handlerSource).toMatch(
      /from\s*['"]@\/lib\/ai\/anthropic-client['"]/,
    )
  })
})
