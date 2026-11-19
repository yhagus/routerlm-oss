import { ConflictException } from "@nestjs/common";
import { type IQueryHandler, QueryHandler } from "@nestjs/cqrs";
import { InjectDrizzle } from "@nestjs/drizzle";
import type { Database } from "@/db/schemas/relations.js";
import { ProviderKeyCipher } from "@/upstream/providers/provider-key-cipher.js";
import { API_KEY_CIPHER_PURPOSE } from "../../models/api-key.js";
import { findUnrevokedApiKey } from "../../models/find-unrevoked-api-key.js";
import { RevealApiKeyQuery } from "../impl/reveal-api-key.query.js";

@QueryHandler(RevealApiKeyQuery)
export class RevealApiKeyHandler implements IQueryHandler<RevealApiKeyQuery> {
  constructor(
    @InjectDrizzle() private readonly db: Database,
    private readonly keyCipher: ProviderKeyCipher,
  ) {}

  async execute({ id }: RevealApiKeyQuery): Promise<{ key: string }> {
    const { encryptedKey } = await findUnrevokedApiKey(
      this.db,
      id,
      "A revoked API Key can't be shown.",
    );
    if (encryptedKey === null) {
      throw new ConflictException(
        "This API Key can't be shown again: it was created before keys were kept, or it is revoked. Rotate it to get a copyable key.",
      );
    }
    return { key: this.keyCipher.decrypt(encryptedKey, API_KEY_CIPHER_PURPOSE) };
  }
}
