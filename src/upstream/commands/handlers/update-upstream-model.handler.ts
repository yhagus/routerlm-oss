import { NotFoundException } from "@nestjs/common";
import { CommandHandler, type ICommandHandler } from "@nestjs/cqrs";
import { InjectDrizzle } from "@nestjs/drizzle";
import { eq } from "drizzle-orm";
import type { Database } from "@/db/schemas/relations.js";
import { providers, upstreamModels } from "@/db/schemas/index.js";
import { SnapshotService } from "@/snapshot/providers/snapshot.service.js";
import {
  assertProviderServesKind,
  assertServiceTiersFitProvider,
  toUpstreamModelWriteError,
  type UpstreamModel,
} from "../../models/upstream-model.js";
import { UpdateUpstreamModelCommand } from "../impl/update-upstream-model.command.js";

@CommandHandler(UpdateUpstreamModelCommand)
export class UpdateUpstreamModelHandler implements ICommandHandler<UpdateUpstreamModelCommand> {
  constructor(
    @InjectDrizzle() private readonly db: Database,
    private readonly snapshot: SnapshotService,
  ) {}

  async execute({ upstreamModelId, changes }: UpdateUpstreamModelCommand): Promise<UpstreamModel> {
    let updated: UpstreamModel | undefined;
    try {
      updated = await this.db.transaction(async (tx) => {
        const [stored] = await tx
          .select({
            serviceTiers: upstreamModels.serviceTiers,
            tierPrices: upstreamModels.tierPrices,
            serviceTierValues: providers.serviceTierValues,
            endpoints: providers.endpoints,
          })
          .from(upstreamModels)
          .innerJoin(providers, eq(providers.id, upstreamModels.providerId))
          .where(eq(upstreamModels.id, upstreamModelId))
          .for("update", { of: upstreamModels });
        if (!stored) {
          return undefined;
        }

        if (changes.kind !== undefined) {
          assertProviderServesKind(changes.kind, stored.endpoints);
        }
        // A PATCH may change only the tiers or only their prices, so the result is what must fit.
        assertServiceTiersFitProvider(
          {
            serviceTiers: changes.serviceTiers ?? stored.serviceTiers,
            tierPrices: changes.tierPrices ?? stored.tierPrices,
          },
          stored.serviceTierValues,
        );
        const [row] = await tx
          .update(upstreamModels)
          .set(changes)
          .where(eq(upstreamModels.id, upstreamModelId))
          .returning();
        return row;
      });
    } catch (error) {
      throw toUpstreamModelWriteError(error, changes.upstreamModelId);
    }
    if (!updated) {
      throw new NotFoundException("Upstream Model not found");
    }
    await this.snapshot.changed();
    return updated;
  }
}
