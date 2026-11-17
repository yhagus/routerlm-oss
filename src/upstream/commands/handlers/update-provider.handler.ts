import { ConflictException, NotFoundException } from "@nestjs/common";
import { CommandHandler, type ICommandHandler } from "@nestjs/cqrs";
import { InjectDrizzle } from "@nestjs/drizzle";
import { and, count, eq, inArray } from "drizzle-orm";
import type { Database } from "@/db/schemas/relations.js";
import {
  providerAccounts,
  providers,
  quotaMeters,
  type ServiceTierValues,
  upstreamModels,
} from "@/db/schemas/index.js";
import { SnapshotService } from "@/snapshot/providers/snapshot.service.js";
import { serviceTiersWithoutWireValue } from "@/catalog/schemas/catalog.schema.js";
import {
  assertQuirksFitProtocol,
  assertServiceTierValuesFitProtocol,
  type Provider,
} from "../../models/provider.js";
import { UpdateProviderCommand } from "../impl/update-provider.command.js";

type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];

@CommandHandler(UpdateProviderCommand)
export class UpdateProviderHandler implements ICommandHandler<UpdateProviderCommand> {
  constructor(
    @InjectDrizzle() private readonly db: Database,
    private readonly snapshot: SnapshotService,
  ) {}

  async execute({ providerId, changes }: UpdateProviderCommand): Promise<Provider> {
    const updated = await this.db.transaction(async (tx) => {
      const [stored] = await tx
        .select()
        .from(providers)
        .where(eq(providers.id, providerId))
        .for("update");
      if (!stored) {
        throw new NotFoundException("Provider not found");
      }

      // A PATCH may change only the Protocol or only the quirks, so the result is what must fit.
      assertQuirksFitProtocol(changes.protocol ?? stored.protocol, changes.quirks ?? stored.quirks);
      const serviceTierValues = changes.serviceTierValues ?? stored.serviceTierValues;
      assertServiceTierValuesFitProtocol(changes.protocol ?? stored.protocol, serviceTierValues);
      if (changes.serviceTierValues !== undefined) {
        await refuseWhileModelsListUnmappedTiers(tx, providerId, serviceTierValues);
      }
      if (changes.oauthLogin === null) {
        await refuseWhileOauthLoginAccountsExist(tx, providerId);
      }

      const [provider] = await tx
        .update(providers)
        .set(changes)
        .where(eq(providers.id, providerId))
        .returning();

      const isQuotaReaderChanged =
        changes.quotaReader !== undefined && changes.quotaReader !== stored.quotaReader;
      if (isQuotaReaderChanged) {
        await clearQuotaReadings(tx, providerId);
      }
      return provider;
    });
    await this.snapshot.changed();
    return updated;
  }
}

/** A tier the Provider stops mapping would be dropped from every Attempt of the Upstream Models that list it. */
async function refuseWhileModelsListUnmappedTiers(
  tx: Transaction,
  providerId: string,
  serviceTierValues: ServiceTierValues,
): Promise<void> {
  const models = await tx
    .select({
      upstreamModelId: upstreamModels.upstreamModelId,
      serviceTiers: upstreamModels.serviceTiers,
    })
    .from(upstreamModels)
    .where(eq(upstreamModels.providerId, providerId));
  const affected = models.filter(
    (model) => serviceTiersWithoutWireValue(model.serviceTiers, serviceTierValues).length > 0,
  );
  if (affected.length === 0) return;

  const names = affected.map((model) => `"${model.upstreamModelId}"`).join(", ");
  throw new ConflictException(
    `The Upstream Models ${names} list Service Tiers this change would leave unmapped; remove the tiers from them first`,
  );
}

/** Without OAuth Login these Provider Accounts could neither renew their tokens nor be signed in again. */
async function refuseWhileOauthLoginAccountsExist(
  tx: Transaction,
  providerId: string,
): Promise<void> {
  const [{ total }] = await tx
    .select({ total: count() })
    .from(providerAccounts)
    .where(
      and(
        eq(providerAccounts.providerId, providerId),
        eq(providerAccounts.credentialKind, "oauth-login"),
      ),
    );
  if (total === 0) return;

  const accounts = total === 1 ? "1 Provider Account signs" : `${total} Provider Accounts sign`;
  throw new ConflictException(
    `${accounts} in with OAuth; remove them or switch them to an API key first`,
  );
}

/**
 * Readings taken by the previous reader describe meters the new one may not
 * know, so the Provider Accounts start over as never read. Their Exhausted
 * state is left alone: it comes from the Provider's refusals, not from a reading.
 */
async function clearQuotaReadings(tx: Transaction, providerId: string): Promise<void> {
  const accountsOfProvider = tx
    .select({ id: providerAccounts.id })
    .from(providerAccounts)
    .where(eq(providerAccounts.providerId, providerId));
  await tx.delete(quotaMeters).where(inArray(quotaMeters.providerAccountId, accountsOfProvider));
  await tx
    .update(providerAccounts)
    .set({ quotaCheckedAt: null, quotaError: null })
    .where(eq(providerAccounts.providerId, providerId));
}
