/**
 * Tests for core/encryption/tokens.ts (database-security.md §5).
 *
 * Cites: keeps OAuth tokens unreadable at rest; decryption fails loudly on
 * wrong key or tampered ciphertext.
 */
import { randomBytes } from "node:crypto";
import {
  encryptToken,
  decryptToken,
  KeyMissingError,
  DecryptionFailedError,
} from "@/core/encryption/tokens";

const TEST_KEY = randomBytes(32).toString("base64");

beforeEach(() => {
  process.env.TOKEN_ENCRYPTION_KEY = TEST_KEY;
});

afterEach(() => {
  delete process.env.TOKEN_ENCRYPTION_KEY;
});

describe("encryptToken / decryptToken", () => {
  it("round-trips a typical OAuth bearer token", () => {
    const plaintext = "xoxb-1234-5678-AbCdEfGhIjKlMnOpQrSt";
    const ciphertext = encryptToken(plaintext);
    expect(ciphertext).not.toBe(plaintext);
    expect(decryptToken(ciphertext)).toBe(plaintext);
  });

  it("produces different ciphertexts for the same plaintext (random IV)", () => {
    const plaintext = "same-token-each-time";
    const a = encryptToken(plaintext);
    const b = encryptToken(plaintext);
    expect(a).not.toBe(b);
    expect(decryptToken(a)).toBe(plaintext);
    expect(decryptToken(b)).toBe(plaintext);
  });

  it("preserves multibyte / unicode tokens (UTF-8 round-trip)", () => {
    const plaintext = "tøkën-with-üñíçødé-🔐";
    expect(decryptToken(encryptToken(plaintext))).toBe(plaintext);
  });

  it("rejects empty plaintext (Q5: encryption of empty isn't a valid token)", () => {
    expect(() => encryptToken("")).toThrow(/non-empty/);
  });

  it("throws KeyMissingError when TOKEN_ENCRYPTION_KEY is unset", () => {
    // Encrypt a real value while the key IS present so we get a well-formed
    // packed payload long enough to pass decryptToken's shape check; only the
    // missing-key path matters for this test.
    const validPacked = encryptToken("x");
    delete process.env.TOKEN_ENCRYPTION_KEY;
    expect(() => encryptToken("x")).toThrow(KeyMissingError);
    expect(() => decryptToken(validPacked)).toThrow(KeyMissingError);
  });

  it("throws on a key that doesn't decode to 32 bytes", () => {
    process.env.TOKEN_ENCRYPTION_KEY = Buffer.from("too-short").toString("base64");
    expect(() => encryptToken("x")).toThrow(/32 bytes/);
  });

  it("decrypt fails loudly on tampered ciphertext (auth tag check)", () => {
    const ciphertext = encryptToken("real-token");
    const buf = Buffer.from(ciphertext, "base64");
    // Flip the last byte of the ciphertext (after iv + authTag = 28 bytes).
    const lastIdx = buf.length - 1;
    buf.writeUInt8(buf.readUInt8(lastIdx) ^ 0xff, lastIdx);
    const tampered = buf.toString("base64");
    expect(() => decryptToken(tampered)).toThrow(DecryptionFailedError);
  });

  it("decrypt fails loudly on wrong key (different env value)", () => {
    const ciphertext = encryptToken("real-token");
    process.env.TOKEN_ENCRYPTION_KEY = randomBytes(32).toString("base64");
    expect(() => decryptToken(ciphertext)).toThrow(DecryptionFailedError);
  });

  it("decrypt fails on inputs too short to be a valid packed format", () => {
    expect(() => decryptToken("short")).toThrow(DecryptionFailedError);
    expect(() => decryptToken("")).toThrow(DecryptionFailedError);
  });
});
