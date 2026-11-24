import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import type { FactoryProvider } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type { Env } from "@/config/schemas/env.schema.js";

const ALGORITHM = "aes-256-gcm";
const IV_BYTES = 12;
const AUTH_TAG_BYTES = 16;
const FORMAT_VERSION = "v1";
const SEPARATOR = ".";

export class ProviderKeyCipher {
  private readonly encryptionKey: Buffer;

  constructor(encryptionKeyBase64: string) {
    this.encryptionKey = Buffer.from(encryptionKeyBase64, "base64");
  }

  encrypt(providerAccountKey: string, purpose?: string): string {
    const iv = randomBytes(IV_BYTES);
    const cipher = createCipheriv(ALGORITHM, this.encryptionKey, iv, {
      authTagLength: AUTH_TAG_BYTES,
    });
    if (purpose !== undefined) {
      cipher.setAAD(Buffer.from(purpose, "utf8"));
    }
    const ciphertext = Buffer.concat([cipher.update(providerAccountKey, "utf8"), cipher.final()]);
    const encodedParts = [iv, cipher.getAuthTag(), ciphertext].map((part) =>
      part.toString("base64url"),
    );
    return [FORMAT_VERSION, ...encodedParts].join(SEPARATOR);
  }

  decrypt(encryptedKey: string, purpose?: string): string {
    const [version, iv, authTag, ciphertext] = encryptedKey.split(SEPARATOR);
    if (version !== FORMAT_VERSION || !iv || !authTag || !ciphertext) {
      throw new Error("Not an encrypted Provider Account key");
    }
    const decipher = createDecipheriv(ALGORITHM, this.encryptionKey, Buffer.from(iv, "base64url"), {
      authTagLength: AUTH_TAG_BYTES,
    });
    decipher.setAuthTag(Buffer.from(authTag, "base64url"));
    if (purpose !== undefined) {
      decipher.setAAD(Buffer.from(purpose, "utf8"));
    }
    return Buffer.concat([
      decipher.update(Buffer.from(ciphertext, "base64url")),
      decipher.final(),
    ]).toString("utf8");
  }
}

export const providerKeyCipherProvider: FactoryProvider<ProviderKeyCipher> = {
  provide: ProviderKeyCipher,
  inject: [ConfigService],
  useFactory: (config: ConfigService<Env, true>) =>
    new ProviderKeyCipher(config.get("ENCRYPTION_KEY", { infer: true })),
};
