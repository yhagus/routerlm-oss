import { NotFoundException } from "@nestjs/common";
import { CommandHandler, type ICommandHandler } from "@nestjs/cqrs";
import { InjectDrizzle } from "@nestjs/drizzle";
import type { Database } from "@/db/schemas/relations";
import { eq } from "drizzle-orm";
import { providers, upstreamModels } from "@/db/schemas";
import { kindOf } from "@/libs/models/provider-protocols";
import { SnapshotService } from "@/snapshot/providers/snapshot.service";
import {
  assertProtocolsFitProvider,
  assertProviderServesKind,
  assertServiceTiersFitProvider,
  toUpstreamModelWriteError,
  type UpstreamModel,
} from "@/upstream/models/upstream-model";
import { CreateUpstreamModelCommand } from "@/upstream/commands/impl/create-upstream-model.command";

@CommandHandler(CreateUpstreamModelCommand)
export class CreateUpstreamModelHandler implements ICommandHandler<CreateUpstreamModelCommand> {
  constructor(
    @InjectDrizzle() private readonly db: Database,
    private readonly snapshot: SnapshotService,
  ) {}

  async execute({ newUpstreamModel }: CreateUpstreamModelCommand): Promise<UpstreamModel> {
    const [provider] = await this.db
      .select({ endpoints: providers.endpoints, serviceTierValues: providers.serviceTierValues })
      .from(providers)
      .where(eq(providers.id, newUpstreamModel.providerId));
    if (!provider) {
      throw new NotFoundException("Provider not found");
    }
    assertProviderServesKind(kindOf(newUpstreamModel), provider.endpoints);
    assertProtocolsFitProvider(newUpstreamModel, provider.endpoints);
    assertServiceTiersFitProvider(
      {
        serviceTiers: newUpstreamModel.serviceTiers ?? [],
        tierPrices: newUpstreamModel.tierPrices ?? {},
      },
      provider.serviceTierValues,
    );
    try {
      const [created] = await this.db.insert(upstreamModels).values(newUpstreamModel).returning();
      await this.snapshot.changed();
      return created;
    } catch (error) {
      throw toUpstreamModelWriteError(error, newUpstreamModel.upstreamModelId);
    }
  }
}
