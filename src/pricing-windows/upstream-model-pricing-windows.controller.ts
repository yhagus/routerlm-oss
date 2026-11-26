import { Body, Get, Param, ParseUUIDPipe, Put } from "@nestjs/common";
import { CommandBus, QueryBus } from "@nestjs/cqrs";
import { DashboardController } from "@/auth/decorators/dashboard-controller.decorator";
import { ReplaceUpstreamModelPricingWindowsCommand } from "./commands/impl/replace-upstream-model-pricing-windows.command";
import type { AttachedPricingWindow } from "./models/upstream-model-pricing-windows";
import { ListUpstreamModelPricingWindowsQuery } from "./queries/impl/list-upstream-model-pricing-windows.query";
import { type WindowPricesEntry, windowPricesListSchema } from "./schemas/pricing-window.schema";

@DashboardController("upstream-models")
export class UpstreamModelPricingWindowsController {
  constructor(
    private readonly commandBus: CommandBus,
    private readonly queryBus: QueryBus,
  ) {}

  @Get(":id/pricing-windows")
  listUpstreamModelPricingWindows(
    @Param("id", ParseUUIDPipe) upstreamModelId: string,
  ): Promise<AttachedPricingWindow[]> {
    return this.queryBus.execute(new ListUpstreamModelPricingWindowsQuery(upstreamModelId));
  }

  @Put(":id/pricing-windows")
  replaceUpstreamModelPricingWindows(
    @Param("id", ParseUUIDPipe) upstreamModelId: string,
    @Body({ schema: windowPricesListSchema }) entries: WindowPricesEntry[],
  ): Promise<AttachedPricingWindow[]> {
    return this.commandBus.execute(
      new ReplaceUpstreamModelPricingWindowsCommand(upstreamModelId, entries),
    );
  }
}
