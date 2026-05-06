import type {
  EncryptedTokens,
  PkceChallenge,
  PkceGeneration,
  PkceInputs,
  ProviderOAuth,
} from "@/contracts/integration";

/**
 * Test-only mock provider used by Slice 2a (PKCE plumbing) and Slice 2b
 * (refresh + refresh-and-retry). The factory returns a `ProviderOAuth`
 * whose methods capture every call into `MockState`, so tests can assert
 * the dispatcher's threading without coupling to a real provider's
 * network shape.
 *
 * NOT registered in `integrations/_registry.ts` — lives under
 * `tests/__mocks__` and is only imported by tests. Production code never
 * sees it.
 *
 * Slice 2c (Gmail) can borrow this factory directly or build a parallel
 * Google-shaped factory — both patterns are fine. The factory's name still
 * mentions "Pkce" for now; once it grows beyond mock-provider basics, a
 * cleanup commit will rename to a generic name (deferred per Slice 2b
 * plan).
 */
export interface PkceMockState {
  generatePkceCallCount: number;
  buildAuthUrlCalls: Array<{
    state: string;
    scopes: readonly string[];
    pkce: PkceChallenge | null;
  }>;
  handleCallbackCalls: Array<{ code: string; state: string; pkce: PkceInputs | null }>;
  refreshTokenCalls: Array<{ refreshToken: string }>;
  revokeCalls: Array<{ token: string }>;
}

export interface CreatePkceMockProviderOptions {
  accessTokenEncrypted?: string;
  refreshTokenEncrypted?: string | null;
  providerAccountId?: string;
  scopes?: readonly string[];
  /**
   * When provided, the mock implements `generatePkce` and returns this
   * value (or the value produced by this function) on each call. When
   * omitted, the mock OMITS the generatePkce method entirely — matches
   * the Slack-shaped (no-PKCE) provider contract.
   */
  generatePkce?: PkceGeneration | (() => PkceGeneration);
  /**
   * Custom refresh implementation. Overrides the default behavior. When
   * unset and `refreshTokenThrows` is also unset, `refreshToken` throws
   * a clear "not configured" error so a test that didn't intend to
   * exercise refresh fails loudly.
   */
  refreshTokenImpl?: (refreshToken: string) => Promise<EncryptedTokens>;
  /**
   * Shortcut for the refresh-not-supported / refresh-error test paths.
   * When set, `refreshToken` throws this error verbatim. Tests for
   * `RefreshNotSupportedError` pass that class instance here.
   */
  refreshTokenThrows?: Error;
}

export function createPkceMockProvider(
  options: CreatePkceMockProviderOptions = {},
): { provider: ProviderOAuth; state: PkceMockState } {
  const state: PkceMockState = {
    generatePkceCallCount: 0,
    buildAuthUrlCalls: [],
    handleCallbackCalls: [],
    refreshTokenCalls: [],
    revokeCalls: [],
  };
  const provider: ProviderOAuth = {
    ...(options.generatePkce !== undefined
      ? {
          generatePkce(): PkceGeneration {
            state.generatePkceCallCount += 1;
            return typeof options.generatePkce === "function"
              ? options.generatePkce()
              : options.generatePkce!;
          },
        }
      : {}),
    buildAuthUrl(jwtState, scopes, pkce) {
      state.buildAuthUrlCalls.push({ state: jwtState, scopes, pkce });
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
    async refreshToken(refreshToken) {
      state.refreshTokenCalls.push({ refreshToken });
      if (options.refreshTokenThrows) {
        throw options.refreshTokenThrows;
      }
      if (options.refreshTokenImpl) {
        return options.refreshTokenImpl(refreshToken);
      }
      throw new Error(
        "createPkceMockProvider: refreshTokenImpl / refreshTokenThrows not configured for this test.",
      );
    },
    async revoke(token) {
      state.revokeCalls.push({ token });
    },
  };
  return { provider, state };
}
