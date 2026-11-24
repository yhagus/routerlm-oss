import { BadRequestException, NotFoundException } from "@nestjs/common";
import { CommandHandler, type ICommandHandler } from "@nestjs/cqrs";
import { InjectDrizzle } from "@nestjs/drizzle";
import { eq } from "drizzle-orm";
import type { Database } from "@/db/schemas/relations.js";
import { providers, routes, upstreamModels } from "@/db/schemas/index.js";
import { attachedPricingWindowNames } from "@/pricing-windows/models/upstream-model-pricing-windows.js";
import { SnapshotService } from "@/snapshot/providers/snapshot.service.js";
import {
  assertProviderServesKind,
  assertServiceTiersFitProvider,
  toUpstreamModelWriteError,
  type UpstreamModel,
} from "@/upstream/models/upstream-model.js";
import { UpdateUpstreamModelCommand } from "@/upstream/commands/impl/update-upstream-model.command.js";

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
            kind: upstreamModels.kind,
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

        if (changes.kind !== undefined && changes.kind !== stored.kind) {
          assertProviderServesKind(changes.kind, stored.endpoints);
          const [usedByRoute] = await tx
            .select({ id: routes.id })
            .from(routes)
            .where(eq(routes.upstreamModelId, upstreamModelId))
            .limit(1);
          if (usedByRoute) {
            throw new BadRequestException(
              "Routes use this Upstream Model, so its Kind can't change; remove them first",
            );
          }
          const pricingWindowNames = await attachedPricingWindowNames(tx, upstreamModelId);
          if (pricingWindowNames.length > 0) {
            throw new BadRequestException(
              `The Pricing Windows ${pricingWindowNames.join(", ")} give this Upstream Model Window Prices, so its Kind can't change; detach them first`,
            );
          }
        }
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
