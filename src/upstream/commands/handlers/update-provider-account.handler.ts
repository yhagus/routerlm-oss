import { ConflictException, NotFoundException } from '@nestjs/common';
import { CommandHandler, type ICommandHandler } from '@nestjs/cqrs';
import { InjectDrizzle } from '@nestjs/drizzle';
import { eq } from 'drizzle-orm';
import type { Database } from '@/db/schemas/relations';
import { providerAccounts, providers } from '@/db/schemas';
import { SnapshotService } from '@/snapshot/providers/snapshot.service';
import {
  type ProviderAccount,
  providerAccountColumns,
  storedKey,
} from '@/upstream/models/provider-account';
import { assertPlanChoiceOffered } from '@/upstream/models/plan-choice';
import { ProviderKeyCipher } from '@/upstream/providers/provider-key-cipher';
import { UpdateProviderAccountCommand } from '@/upstream/commands/impl/update-provider-account.command';

@CommandHandler(UpdateProviderAccountCommand)
export class UpdateProviderAccountHandler implements ICommandHandler<UpdateProviderAccountCommand> {
  constructor(
    @InjectDrizzle() private readonly db: Database,
    private readonly keyCipher: ProviderKeyCipher,
    private readonly snapshot: SnapshotService,
  ) {}

  async execute({
    providerAccountId,
    changes,
  }: UpdateProviderAccountCommand): Promise<ProviderAccount> {
    const { key, ...fields } = changes;
    const values: Partial<typeof providerAccounts.$inferInsert> = { ...fields };
    if (key !== undefined) {
      await this.requireApiKeyAccount(providerAccountId);
      Object.assign(values, storedKey(this.keyCipher, key));
    }
    if (changes.planChoice !== undefined) {
      await this.requirePlanChoiceOffered(providerAccountId, changes.planChoice);
    }
    if (changes.isEnabled === true) {
      values.disabledReason = null;
    }
    const [updated] = await this.db
      .update(providerAccounts)
      .set(values)
      .where(eq(providerAccounts.id, providerAccountId))
      .returning(providerAccountColumns);
    if (!updated) {
      throw new NotFoundException('Provider Account not found');
    }
    await this.snapshot.changed();
    return updated;
  }

  private async requirePlanChoiceOffered(
    providerAccountId: string,
    planChoice: string,
  ): Promise<void> {
    const [provider] = await this.db
      .select({
        name: providers.name,
        plans: providers.plans,
        allowsNoPlan: providers.allowsNoPlan,
      })
      .from(providerAccounts)
      .innerJoin(providers, eq(providerAccounts.providerId, providers.id))
      .where(eq(providerAccounts.id, providerAccountId));
    if (provider) {
      assertPlanChoiceOffered(provider, planChoice);
    }
  }

  private async requireApiKeyAccount(providerAccountId: string): Promise<void> {
    const [account] = await this.db
      .select({ credentialKind: providerAccounts.credentialKind })
      .from(providerAccounts)
      .where(eq(providerAccounts.id, providerAccountId));
    if (account?.credentialKind === 'oauth-login') {
      throw new ConflictException(
        "Provider Account holds an OAuth Login, which a key can't replace",
      );
    }
  }
}
