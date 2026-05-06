import {
  randomBytes,
  createCipheriv,
  createDecipheriv,
  type CipherGCM,
  type DecipherGCM,
} from "node:crypto";

/**
 * Application-layer token encryption per docs/rules/database-security.md.
 *
 * Format: base64(iv ‖ authTag ‖ ciphertext)
 *   - iv:        12 bytes (random per encryption — AES-GCM standard)
 *   - authTag:   16 bytes (GCM authentication tag)
 *   - ciphertext: variable (AES-256 of utf8(plaintext))
 *
 * Encrypts before write, decrypts on read. Decryption failure is fatal — never
 * silently retried. RLS is the second line of defense; this is the first.
 */

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12;
const AUTH_TAG_LENGTH = 16;
const KEY_LENGTH = 32;

export class KeyMissingError extends Error {
  constructor() {
    super("TOKEN_ENCRYPTION_KEY env var is not set.");
    this.name = "KeyMissingError";
  }
}

export class DecryptionFailedError extends Error {
  constructor() {
    super("Token decryption failed (wrong key, malformed input, or tampered ciphertext).");
    this.name = "DecryptionFailedError";
  }
}

function getKey(): Buffer {
  const raw = process.env.TOKEN_ENCRYPTION_KEY;
  if (!raw) throw new KeyMissingError();
  const buf = Buffer.from(raw, "base64");
  if (buf.length !== KEY_LENGTH) {
    throw new Error(
      `TOKEN_ENCRYPTION_KEY must decode to ${KEY_LENGTH} bytes (got ${buf.length}). Use \`openssl rand -base64 32\`.`,
    );
  }
  return buf;
}

export function encryptToken(plaintext: string): string {
  if (typeof plaintext !== "string" || plaintext.length === 0) {
    throw new Error("encryptToken: plaintext must be a non-empty string.");
  }
  const key = getKey();
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv) as CipherGCM;
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return Buffer.concat([iv, authTag, ciphertext]).toString("base64");
}

export function decryptToken(packed: string): string {
  if (typeof packed !== "string" || packed.length === 0) {
    throw new DecryptionFailedError();
  }
  const buf = Buffer.from(packed, "base64");
  if (buf.length < IV_LENGTH + AUTH_TAG_LENGTH + 1) {
    throw new DecryptionFailedError();
  }
  const iv = buf.subarray(0, IV_LENGTH);
  const authTag = buf.subarray(IV_LENGTH, IV_LENGTH + AUTH_TAG_LENGTH);
  const ciphertext = buf.subarray(IV_LENGTH + AUTH_TAG_LENGTH);
  const key = getKey();
  const decipher = createDecipheriv(ALGORITHM, key, iv) as DecipherGCM;
  decipher.setAuthTag(authTag);
  try {
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
  } catch {
    throw new DecryptionFailedError();
  }
}
