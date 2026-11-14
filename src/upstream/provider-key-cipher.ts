import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const ALGORITHM = "aes-256-gcm";
// 96-bit IVs are what GCM is designed for.
const IV_BYTES = 12;
// Fixed so a truncated tag is refused instead of weakening authentication.
const AUTH_TAG_BYTES = 16;
const FORMAT_VERSION = "v1";
const SEPARATOR = ".";

/**
 * Encrypts Provider Account keys at rest with AES-256-GCM. The stored form is
 * `v1.<iv>.<auth tag>.<ciphertext>`, each part base64url; the version prefix
 * leaves room for a later change of format or encryption key.
 */
export class ProviderKeyCipher {
  private readonly encryptionKey: Buffer;

  /** @param encryptionKeyBase64 32 bytes in base64, as `ENCRYPTION_KEY` holds them. */
  constructor(encryptionKeyBase64: string) {
    this.encryptionKey = Buffer.from(encryptionKeyBase64, "base64");
  }

  encrypt(providerAccountKey: string): string {
    const iv = randomBytes(IV_BYTES);
    const cipher = createCipheriv(ALGORITHM, this.encryptionKey, iv, {
      authTagLength: AUTH_TAG_BYTES,
    });
    const ciphertext = Buffer.concat([cipher.update(providerAccountKey, "utf8"), cipher.final()]);
    const encodedParts = [iv, cipher.getAuthTag(), ciphertext].map((part) =>
      part.toString("base64url"),
    );
    return [FORMAT_VERSION, ...encodedParts].join(SEPARATOR);
  }

  /** Throws when the value was tampered with or encrypted under another encryption key. */
  decrypt(encryptedKey: string): string {
    const [version, iv, authTag, ciphertext] = encryptedKey.split(SEPARATOR);
    if (version !== FORMAT_VERSION || !iv || !authTag || !ciphertext) {
      throw new Error("Not an encrypted Provider Account key");
    }
    const decipher = createDecipheriv(ALGORITHM, this.encryptionKey, Buffer.from(iv, "base64url"), {
      authTagLength: AUTH_TAG_BYTES,
    });
    decipher.setAuthTag(Buffer.from(authTag, "base64url"));
    return Buffer.concat([
      decipher.update(Buffer.from(ciphertext, "base64url")),
      decipher.final(),
    ]).toString("utf8");
  }
}
