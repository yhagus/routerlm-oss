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
import { DashboardController } from "../auth/decorators/dashboard-controller.decorator.js";
import { CreateUpstreamModelCommand } from "./commands/impl/create-upstream-model.command.js";
import { DeleteUpstreamModelCommand } from "./commands/impl/delete-upstream-model.command.js";
import { UpdateUpstreamModelCommand } from "./commands/impl/update-upstream-model.command.js";
import type { UpstreamModel } from "./models/upstream-model.js";
import { ListUpstreamModelsQuery } from "./queries/impl/list-upstream-models.query.js";
import {
  type NewUpstreamModel,
  newUpstreamModelSchema,
  type UpstreamModelChanges,
  upstreamModelChangesSchema,
} from "./schemas/upstream.schema.js";

@DashboardController("upstream-models")
export class UpstreamModelsController {
  constructor(
    private readonly commandBus: CommandBus,
    private readonly queryBus: QueryBus,
  ) {}

  @Get()
  listUpstreamModels(): Promise<UpstreamModel[]> {
    return this.queryBus.execute(new ListUpstreamModelsQuery());
  }

  @Post()
  createUpstreamModel(
    @Body({ schema: newUpstreamModelSchema }) newUpstreamModel: NewUpstreamModel,
  ): Promise<UpstreamModel> {
    return this.commandBus.execute(new CreateUpstreamModelCommand(newUpstreamModel));
  }

  /** Edits Capabilities, limits and prices, or enables or disables the Upstream Model. */
  @Patch(":id")
  updateUpstreamModel(
    @Param("id", ParseUUIDPipe) upstreamModelId: string,
    @Body({ schema: upstreamModelChangesSchema }) changes: UpstreamModelChanges,
  ): Promise<UpstreamModel> {
    return this.commandBus.execute(new UpdateUpstreamModelCommand(upstreamModelId, changes));
  }

  @Delete(":id")
  @HttpCode(HttpStatus.NO_CONTENT)
  deleteUpstreamModel(@Param("id", ParseUUIDPipe) upstreamModelId: string): Promise<void> {
    return this.commandBus.execute(new DeleteUpstreamModelCommand(upstreamModelId));
  }
}
