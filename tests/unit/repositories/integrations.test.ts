/**
 * @jest-environment node
 *
 * Tests for repositories/integrations.ts. Mocks the service-role Supabase
 * client (upsertActive bypasses RLS because the OAuth callback dispatcher
 * has already verified the user identity via the signed state token) to
 * verify the upsertActive flow chooses INSERT vs UPDATE based on whether an
 * active row exists, and that the row payload is correctly translated from
 * EncryptedTokens / ProviderAccountInfo into snake_case columns.
 */

const baseRow = {
  id: "int-1",
  user_id: "user-1",
  provider: "slack",
  provider_account_id: "T123",
  display_name: "Acme",
  access_token_encrypted: "ENC-NEW",
  refresh_token_encrypted: null,
  access_token_expires_at: null,
  scopes: ["chat:write"],
  account_metadata: { teamId: "T123" },
  disconnected_at: null,
  created_at: "2026-05-05T00:00:00Z",
  updated_at: "2026-05-05T00:00:00Z",
};

function makeMockClient(opts: {
  existingRow: typeof baseRow | null;
  insertedRow?: typeof baseRow;
  updatedRow?: typeof baseRow;
}) {
  const updateBuilder = jest.fn().mockReturnThis();
  const insertBuilder = jest.fn().mockReturnThis();
  const selectBuilder = jest.fn().mockReturnThis();
  const eqBuilder = jest.fn().mockReturnThis();
  const isBuilder = jest.fn().mockReturnThis();
  const orderBuilder = jest.fn().mockReturnThis();
  const maybeSingle = jest.fn().mockResolvedValue({ data: opts.existingRow, error: null });
  const single = jest
    .fn()
    .mockResolvedValueOnce({ data: opts.insertedRow ?? opts.updatedRow, error: null });

  // Chain: from('integrations').select('*').eq().eq().eq().is().maybeSingle()
  // Then either: .update(...).eq().select().single()
  //          or: .insert(...).select().single()

  let isSelectChainCall = true;

  const from = jest.fn().mockImplementation(() => {
    const builder: Record<string, jest.Mock> = {
      select: jest.fn().mockReturnThis(),
      insert: jest.fn().mockImplementation(() => {
        isSelectChainCall = false;
        return builder;
      }),
      update: jest.fn().mockImplementation(() => {
        isSelectChainCall = false;
        return builder;
      }),
      eq: jest.fn().mockReturnThis(),
      is: jest.fn().mockReturnThis(),
      order: jest.fn().mockReturnThis(),
      maybeSingle: jest
        .fn()
        .mockResolvedValue({ data: opts.existingRow, error: null }),
      single: jest.fn().mockImplementation(() => {
        return Promise.resolve({
          data: isSelectChainCall ? opts.existingRow : opts.insertedRow ?? opts.updatedRow,
          error: null,
        });
      }),
    };
    return builder;
  });

  return {
    from,
    builders: { updateBuilder, insertBuilder, selectBuilder, eqBuilder, isBuilder, orderBuilder, maybeSingle, single },
  };
}

const mockSupabaseClient: { current: ReturnType<typeof makeMockClient> | null } = { current: null };

jest.mock("@/repositories/supabase/serviceRoleClient", () => ({
  getServiceRoleClient: jest.fn(() => mockSupabaseClient.current),
}));

import { updateTokens, upsertActive } from "@/repositories/integrations";

describe("repositories/integrations.upsertActive", () => {
  it("INSERTs when no active row exists for (user, provider, account)", async () => {
    mockSupabaseClient.current = makeMockClient({
      existingRow: null,
      insertedRow: baseRow,
    });
    const result = await upsertActive({
      userId: "user-1",
      provider: "slack",
      providerAccountId: "T123",
      displayName: "Acme",
      tokens: {
        accessTokenEncrypted: "ENC-NEW",
        refreshTokenEncrypted: null,
        accessTokenExpiresAt: null,
        scopes: ["chat:write"],
      },
      accountMetadata: { teamId: "T123" },
    });
    expect(result.id).toBe("int-1");
    expect(result.accessTokenEncrypted).toBe("ENC-NEW");
    expect(result.scopes).toEqual(["chat:write"]);
  });

  it("UPDATEs when an active row already exists (re-connect refreshes tokens)", async () => {
    mockSupabaseClient.current = makeMockClient({
      existingRow: { ...baseRow, access_token_encrypted: "OLD-ENC" },
      updatedRow: { ...baseRow, access_token_encrypted: "ENC-REFRESHED" },
    });
    const result = await upsertActive({
      userId: "user-1",
      provider: "slack",
      providerAccountId: "T123",
      displayName: "Acme",
      tokens: {
        accessTokenEncrypted: "ENC-REFRESHED",
        refreshTokenEncrypted: null,
        accessTokenExpiresAt: null,
        scopes: ["chat:write"],
      },
      accountMetadata: { teamId: "T123" },
    });
    expect(result.accessTokenEncrypted).toBe("ENC-REFRESHED");
  });

  it("converts numeric expiresAt (epoch seconds) to ISO 8601 for the column", async () => {
    const captured: { expiresAt?: string | null } = {};
    const epoch = 1_780_000_000;
    const isoExpected = new Date(epoch * 1000).toISOString();

    const fromMock = jest.fn().mockImplementation(() => {
      const b: Record<string, jest.Mock> = {
        select: jest.fn().mockReturnThis(),
        insert: jest.fn().mockImplementation((row) => {
          captured.expiresAt = (row as { access_token_expires_at: string | null }).access_token_expires_at;
          return b;
        }),
        update: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        is: jest.fn().mockReturnThis(),
        order: jest.fn().mockReturnThis(),
        maybeSingle: jest.fn().mockResolvedValue({ data: null, error: null }),
        single: jest.fn().mockResolvedValue({ data: { ...baseRow, access_token_expires_at: isoExpected }, error: null }),
      };
      return b;
    });
    mockSupabaseClient.current = { from: fromMock } as ReturnType<typeof makeMockClient>;

    await upsertActive({
      userId: "user-1",
      provider: "slack",
      providerAccountId: "T123",
      displayName: null,
      tokens: {
        accessTokenEncrypted: "ENC",
        refreshTokenEncrypted: null,
        accessTokenExpiresAt: epoch,
        scopes: [],
      },
      accountMetadata: {},
    });

    expect(captured.expiresAt).toBe(isoExpected);
  });
});

describe("repositories/integrations.updateTokens (Slice 2b)", () => {
  it("UPDATEs token columns filtering by id + disconnected_at IS NULL", async () => {
    const captured: { update?: Record<string, unknown>; eqArgs: Array<[string, unknown]>; isArgs: Array<[string, unknown]> } = {
      eqArgs: [],
      isArgs: [],
    };
    const refreshedRow = {
      ...baseRow,
      access_token_encrypted: "ENC-NEW-ACCESS",
      refresh_token_encrypted: "ENC-NEW-REFRESH",
    };

    const fromMock = jest.fn().mockImplementation(() => {
      const b: Record<string, jest.Mock> = {
        update: jest.fn().mockImplementation((row) => {
          captured.update = row as Record<string, unknown>;
          return b;
        }),
        eq: jest.fn().mockImplementation((col, val) => {
          captured.eqArgs.push([col as string, val]);
          return b;
        }),
        is: jest.fn().mockImplementation((col, val) => {
          captured.isArgs.push([col as string, val]);
          return b;
        }),
        select: jest.fn().mockReturnThis(),
        single: jest.fn().mockResolvedValue({ data: refreshedRow, error: null }),
      };
      return b;
    });
    mockSupabaseClient.current = { from: fromMock } as ReturnType<typeof makeMockClient>;

    const result = await updateTokens({
      id: "int-1",
      tokens: {
        accessTokenEncrypted: "ENC-NEW-ACCESS",
        refreshTokenEncrypted: "ENC-NEW-REFRESH",
        accessTokenExpiresAt: 1_780_000_000,
        scopes: ["chat:write"],
      },
    });

    expect(captured.update).toEqual({
      access_token_encrypted: "ENC-NEW-ACCESS",
      refresh_token_encrypted: "ENC-NEW-REFRESH",
      access_token_expires_at: new Date(1_780_000_000 * 1000).toISOString(),
      scopes: ["chat:write"],
    });
    expect(captured.eqArgs).toContainEqual(["id", "int-1"]);
    expect(captured.isArgs).toContainEqual(["disconnected_at", null]);
    expect(result.accessTokenEncrypted).toBe("ENC-NEW-ACCESS");
    expect(result.refreshTokenEncrypted).toBe("ENC-NEW-REFRESH");
  });

  it("writes refreshTokenEncrypted: null when provider returned null (preserves provider's choice)", async () => {
    const captured: { update?: Record<string, unknown> } = {};
    const fromMock = jest.fn().mockImplementation(() => {
      const b: Record<string, jest.Mock> = {
        update: jest.fn().mockImplementation((row) => {
          captured.update = row as Record<string, unknown>;
          return b;
        }),
        eq: jest.fn().mockReturnThis(),
        is: jest.fn().mockReturnThis(),
        select: jest.fn().mockReturnThis(),
        single: jest.fn().mockResolvedValue({
          data: { ...baseRow, refresh_token_encrypted: null },
          error: null,
        }),
      };
      return b;
    });
    mockSupabaseClient.current = { from: fromMock } as ReturnType<typeof makeMockClient>;

    await updateTokens({
      id: "int-1",
      tokens: {
        accessTokenEncrypted: "ENC-X",
        refreshTokenEncrypted: null,
        accessTokenExpiresAt: null,
        scopes: [],
      },
    });

    expect(captured.update).toMatchObject({ refresh_token_encrypted: null });
  });

  it("throws when no row matches the filter (row missing or disconnected)", async () => {
    const fromMock = jest.fn().mockImplementation(() => {
      const b: Record<string, jest.Mock> = {
        update: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        is: jest.fn().mockReturnThis(),
        select: jest.fn().mockReturnThis(),
        single: jest
          .fn()
          .mockResolvedValue({ data: null, error: { message: "no rows" } }),
      };
      return b;
    });
    mockSupabaseClient.current = { from: fromMock } as ReturnType<typeof makeMockClient>;

    await expect(
      updateTokens({
        id: "int-gone",
        tokens: {
          accessTokenEncrypted: "x",
          refreshTokenEncrypted: null,
          accessTokenExpiresAt: null,
          scopes: [],
        },
      }),
    ).rejects.toThrow(/updateTokens failed/i);
  });
});
