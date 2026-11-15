import { ConflictException, NotFoundException } from "@nestjs/common";
import { type IQueryHandler, QueryHandler } from "@nestjs/cqrs";
import { InjectDrizzle } from "@nestjs/drizzle";
import { eq } from "drizzle-orm";
import type { Database } from "@/db/schemas/relations.js";
import { providerAccounts } from "@/db/schemas/index.js";
import { ProviderKeyCipher } from "../../providers/provider-key-cipher.js";
import { GetProviderAccountKeyQuery } from "../impl/get-provider-account-key.query.js";

@QueryHandler(GetProviderAccountKeyQuery)
export class GetProviderAccountKeyHandler implements IQueryHandler<GetProviderAccountKeyQuery> {
  constructor(
    @InjectDrizzle() private readonly db: Database,
    private readonly keyCipher: ProviderKeyCipher,
  ) {}

  async execute({ providerAccountId }: GetProviderAccountKeyQuery): Promise<string> {
    const [account] = await this.db
      .select({ encryptedKey: providerAccounts.encryptedKey })
      .from(providerAccounts)
      .where(eq(providerAccounts.id, providerAccountId));
    if (!account) {
      throw new NotFoundException("Provider Account not found");
    }
    if (account.encryptedKey === null) {
      throw new ConflictException("Provider Account holds an OAuth Login, not an API key");
    }
    return this.keyCipher.decrypt(account.encryptedKey);
  }
}
