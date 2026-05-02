/**
 * Contract: PR-G6 — GitHub `createPullRequest.base` auto-detect (Q12 / audit).
 *
 * Source: lib/workflows/actions/github.ts createGitHubPullRequest
 *
 * The prior silent `base = "main"` fallback is removed. When `base` is not
 * supplied, the handler hits `GET /repos/{owner}/{repo}` and uses the
 * returned `default_branch`. If the lookup fails, the handler returns
 * `success:false` with `category: 'provider'` rather than guessing 'main'
 * (which is wrong for repos that use master / develop / trunk).
 */

import {
  resetHarness,
  fetchMock,
  getFetchCalls,
} from '../helpers/actionTestHarness'

import { createGitHubPullRequest } from '@/lib/workflows/actions/github'

beforeEach(() => {
  // The GitHub handler queries the supabase server-client directly for the
  // integration row (rather than going through getIntegrationById). The
  // harness chain returns null by default, so seed an integration row here.
  const supabaseServer = jest.requireMock('@/utils/supabase/server') as {
    createSupabaseServerClient: jest.Mock
  }
  supabaseServer.createSupabaseServerClient.mockResolvedValue({
    from: () => ({
      select: () => ({
        eq: () => ({
          eq: () => ({
            eq: () => ({
              single: () =>
                Promise.resolve({
                  data: {
                    id: 'github-integration-1',
                    access_token: 'mock-github-token',
                    status: 'connected',
                  },
                  error: null,
                }),
            }),
          }),
        }),
      }),
    }),
  })
})

afterEach(() => {
  resetHarness()
})

const baseConfig = {
  repository: 'acme/widgets',
  title: 'Add new feature',
  body: 'Implements feature X',
  head: 'feature-x',
}

// fetch-mock returns mocks in FIFO order. The handler issues:
//   1. GET /repos/{owner}/{repo} (auto-detect, when base is unset)
//   2. POST /repos/{owner}/{repo}/pulls (PR creation)
// When `base` is supplied explicitly, only (2) fires.

describe('PR-G6 / Q12 — GitHub createPullRequest default-branch auto-detect', () => {
  test("auto-detects 'develop' when base is unset and uses it for the PR", async () => {
    fetchMock.mockResponses(
      [JSON.stringify({ default_branch: 'develop' }), { status: 200 }],
      [
        JSON.stringify({
          id: 1,
          number: 42,
          title: 'Add new feature',
          state: 'open',
          html_url: 'https://github.com/acme/widgets/pull/42',
          head: { ref: 'feature-x' },
          base: { ref: 'develop' },
          draft: false,
        }),
        { status: 201 },
      ],
    )

    const result = await createGitHubPullRequest(baseConfig, 'user-1', {})

    expect(result.success).toBe(true)
    expect(result.output?.base).toBe('develop')

    const calls = getFetchCalls()
    expect(calls).toHaveLength(2)
    expect(calls[0].url).toBe('https://api.github.com/repos/acme/widgets')
    expect(calls[0].method).toBe('GET')
    expect(calls[1].url).toBe('https://api.github.com/repos/acme/widgets/pulls')
    expect(calls[1].method).toBe('POST')
    // PR-G6 — the body sent to /pulls uses the auto-detected base, NOT 'main'.
    expect(calls[1].body.base).toBe('develop')
  })

  test("auto-detects 'master' when that's the default branch", async () => {
    fetchMock.mockResponses(
      [JSON.stringify({ default_branch: 'master' }), { status: 200 }],
      [
        JSON.stringify({
          id: 2,
          number: 7,
          state: 'open',
          html_url: 'x',
          head: { ref: 'feature-x' },
          base: { ref: 'master' },
        }),
        { status: 201 },
      ],
    )

    await createGitHubPullRequest(baseConfig, 'user-1', {})

    const calls = getFetchCalls()
    expect(calls[1].body.base).toBe('master')
  })

  test("explicit base wins — repos.get is NOT called", async () => {
    fetchMock.mockResponseOnce(
      JSON.stringify({
        id: 3,
        number: 9,
        state: 'open',
        html_url: 'x',
        head: { ref: 'feature-x' },
        base: { ref: 'staging' },
      }),
      { status: 201 },
    )

    await createGitHubPullRequest(
      { ...baseConfig, base: 'staging' },
      'user-1',
      {},
    )

    const calls = getFetchCalls()
    expect(calls).toHaveLength(1)
    expect(calls[0].url).toBe('https://api.github.com/repos/acme/widgets/pulls')
    expect(calls[0].body.base).toBe('staging')
  })

  test("empty-string base triggers auto-detect (treated same as unset)", async () => {
    fetchMock.mockResponses(
      [JSON.stringify({ default_branch: 'trunk' }), { status: 200 }],
      [
        JSON.stringify({
          id: 4,
          number: 11,
          state: 'open',
          html_url: 'x',
          head: { ref: 'feature-x' },
          base: { ref: 'trunk' },
        }),
        { status: 201 },
      ],
    )

    await createGitHubPullRequest({ ...baseConfig, base: '' }, 'user-1', {})

    const calls = getFetchCalls()
    expect(calls).toHaveLength(2)
    expect(calls[0].url).toBe('https://api.github.com/repos/acme/widgets')
    expect(calls[1].body.base).toBe('trunk')
  })

  test("repos.get 404 → success:false with category:'provider' (no PR created)", async () => {
    fetchMock.mockResponseOnce(
      JSON.stringify({ message: 'Not Found' }),
      { status: 404 },
    )

    const result: any = await createGitHubPullRequest(baseConfig, 'user-1', {})

    expect(result).toMatchObject({
      success: false,
      category: 'provider',
    })
    expect(result.message).toContain('default branch')
    expect(result.message).toContain('acme/widgets')
    // No PR creation call should have been issued.
    const calls = getFetchCalls()
    expect(calls).toHaveLength(1)
    expect(calls[0].method).toBe('GET')
  })

  test("repos.get returns 200 with empty default_branch → success:false (no silent 'main' fallback)", async () => {
    fetchMock.mockResponseOnce(JSON.stringify({}), { status: 200 })

    const result: any = await createGitHubPullRequest(baseConfig, 'user-1', {})

    expect(result).toMatchObject({
      success: false,
      category: 'provider',
    })
    expect(result.message).toContain('no default_branch')

    const calls = getFetchCalls()
    expect(calls).toHaveLength(1)
  })

  test("repos.get returns 403 (forbidden) → success:false (no silent fallback)", async () => {
    fetchMock.mockResponseOnce(
      JSON.stringify({ message: 'API rate limit exceeded' }),
      { status: 403 },
    )

    const result: any = await createGitHubPullRequest(baseConfig, 'user-1', {})

    expect(result).toMatchObject({
      success: false,
      category: 'provider',
    })
    // Caller-actionable: tells them to set base explicitly.
    expect(result.message).toContain('Set "base" explicitly')
  })
})
