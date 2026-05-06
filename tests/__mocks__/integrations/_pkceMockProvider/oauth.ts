import type { ProviderOAuth, PkceInputs } from "@/contracts/integration";

/**
 * Test-only PKCE-aware mock provider.
 *
 * Slice 2a ships PKCE plumbing through the OAuth dispatcher but no real
 * PKCE-using provider yet (Gmail lands in 2c). This factory returns a
 * `ProviderOAuth` whose `handleCallback` captures whatever `pkce` argument
 * the dispatcher threads through, so tests can assert the plumbing without
 * coupling to a real provider's network shape.
 *
 * NOT registered in `integrations/_registry.ts` — it lives under
 * `tests/__mocks__` and is only imported by tests. Production code never
 * sees it.
 *
 * Reusable beyond the dispatcher tests: future Gmail tests (Slice 2c) can
 * borrow this factory or swap in their own ProviderOAuth — the capture
 * shape `PkceMockState` doubles as a contract-level assertion.
 */
export interface PkceMockState {
  buildAuthUrlCalls: Array<{ state: string; scopes: readonly string[] }>;
  handleCallbackCalls: Array<{ code: string; state: string; pkce: PkceInputs | null }>;
}

export interface CreatePkceMockProviderOptions {
  accessTokenEncrypted?: string;
  refreshTokenEncrypted?: string | null;
  providerAccountId?: string;
  scopes?: readonly string[];
}

export function createPkceMockProvider(
  options: CreatePkceMockProviderOptions = {},
): { provider: ProviderOAuth; state: PkceMockState } {
  const state: PkceMockState = {
    buildAuthUrlCalls: [],
    handleCallbackCalls: [],
  };
  const provider: ProviderOAuth = {
    buildAuthUrl(jwtState, scopes) {
      state.buildAuthUrlCalls.push({ state: jwtState, scopes });
      return `https://mock.example.com/authorize?state=${jwtState}`;
    },
    async handleCallback(code, jwtState, pkce) {
      state.handleCallbackCalls.push({ code, state: jwtState, pkce });
      return {
        tokens: {
          accessTokenEncrypted: options.accessTokenEncrypted ?? "ENC-MOCK-ACCESS",
          refreshTokenEncrypted:
            options.refreshTokenEncrypted === undefined
              ? "ENC-MOCK-REFRESH"
              : options.refreshTokenEncrypted,
          accessTokenExpiresAt: Math.floor(Date.now() / 1000) + 3600,
          scopes: options.scopes ?? ["mock.read"],
        },
        account: {
          providerAccountId: options.providerAccountId ?? "mock-acct-1",
          displayName: "Mock Account",
          metadata: {},
        },
      };
    },
    async refreshToken(_refreshToken) {
      throw new Error("refreshToken not exercised in Slice 2a");
    },
    async revoke(_token) {
      // no-op for tests
    },
  };
  return { provider, state };
}
