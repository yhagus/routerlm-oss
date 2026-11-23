import {
  Body,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
} from "@nestjs/common";
import { CommandBus, QueryBus } from "@nestjs/cqrs";
import { DashboardController } from "@/auth/decorators/dashboard-controller.decorator.js";
import { CreatePricingWindowCommand } from "./commands/impl/create-pricing-window.command.js";
import { DeletePricingWindowCommand } from "./commands/impl/delete-pricing-window.command.js";
import { UpdatePricingWindowCommand } from "./commands/impl/update-pricing-window.command.js";
import type { PricingWindow, PricingWindowSummary } from "./models/pricing-window.js";
import { ListPricingWindowsQuery } from "./queries/impl/list-pricing-windows.query.js";
import {
  type NewPricingWindow,
  newPricingWindowSchema,
  type PricingWindowChanges,
  pricingWindowChangesSchema,
} from "./schemas/pricing-window.schema.js";

@DashboardController("pricing-windows")
export class PricingWindowsController {
  constructor(
    private readonly commandBus: CommandBus,
    private readonly queryBus: QueryBus,
  ) {}

  @Get()
  listPricingWindows(): Promise<PricingWindowSummary[]> {
    return this.queryBus.execute(new ListPricingWindowsQuery());
  }

  @Post()
  createPricingWindow(
    @Body({ schema: newPricingWindowSchema }) newPricingWindow: NewPricingWindow,
  ): Promise<PricingWindow> {
    return this.commandBus.execute(new CreatePricingWindowCommand(newPricingWindow));
  }

  @Patch(":id")
  updatePricingWindow(
    @Param("id", ParseUUIDPipe) pricingWindowId: string,
    @Body({ schema: pricingWindowChangesSchema }) changes: PricingWindowChanges,
  ): Promise<PricingWindow> {
    return this.commandBus.execute(new UpdatePricingWindowCommand(pricingWindowId, changes));
  }

  @Delete(":id")
  @HttpCode(HttpStatus.NO_CONTENT)
  deletePricingWindow(@Param("id", ParseUUIDPipe) pricingWindowId: string): Promise<void> {
    return this.commandBus.execute(new DeletePricingWindowCommand(pricingWindowId));
  }
}
