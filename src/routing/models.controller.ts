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
import { CreateModelCommand } from "./commands/impl/create-model.command.js";
import { DeleteModelCommand } from "./commands/impl/delete-model.command.js";
import { UpdateModelCommand } from "./commands/impl/update-model.command.js";
import type { Model, ModelDetail, ModelSummary } from "./models/model.js";
import { GetModelQuery } from "./queries/impl/get-model.query.js";
import { ListModelsQuery } from "./queries/impl/list-models.query.js";
import {
  type ModelChanges,
  modelChangesSchema,
  type NewModel,
  newModelSchema,
} from "./schemas/routing.schema.js";

@DashboardController("models")
export class ModelsController {
  constructor(
    private readonly commandBus: CommandBus,
    private readonly queryBus: QueryBus,
  ) {}

  @Get()
  listModels(): Promise<ModelSummary[]> {
    return this.queryBus.execute(new ListModelsQuery());
  }

  /** The Model with its Routes, in the order the gateway tries them. */
  @Get(":id")
  getModel(@Param("id", ParseUUIDPipe) modelId: string): Promise<ModelDetail> {
    return this.queryBus.execute(new GetModelQuery(modelId));
  }

  @Post()
  createModel(@Body({ schema: newModelSchema }) newModel: NewModel): Promise<Model> {
    return this.commandBus.execute(new CreateModelCommand(newModel));
  }

  /** Renames, enables or disables the Model. */
  @Patch(":id")
  updateModel(
    @Param("id", ParseUUIDPipe) modelId: string,
    @Body({ schema: modelChangesSchema }) changes: ModelChanges,
  ): Promise<Model> {
    return this.commandBus.execute(new UpdateModelCommand(modelId, changes));
  }

  @Delete(":id")
  @HttpCode(HttpStatus.NO_CONTENT)
  deleteModel(@Param("id", ParseUUIDPipe) modelId: string): Promise<void> {
    return this.commandBus.execute(new DeleteModelCommand(modelId));
  }
}
