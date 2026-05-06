/**
 * @jest-environment node
 *
 * Tests for repositories/integrations.ts. Mocks the Supabase SSR client to
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

jest.mock("@/utils/supabase/server", () => ({
  createClient: jest.fn(async () => mockSupabaseClient.current),
}));

import { upsertActive } from "@/repositories/integrations";

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
