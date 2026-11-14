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
import { DashboardController } from "../auth/dashboard-controller.decorator.js";
import {
  type Model,
  type ModelDetail,
  ModelsService,
  type ModelSummary,
} from "./models.service.js";
import {
  type ModelChanges,
  modelChangesSchema,
  type NewModel,
  newModelSchema,
} from "./routing.schemas.js";

@DashboardController("models")
export class ModelsController {
  constructor(private readonly models: ModelsService) {}

  @Get()
  listModels(): Promise<ModelSummary[]> {
    return this.models.listModels();
  }

  /** The Model with its Routes, in the order the gateway tries them. */
  @Get(":id")
  getModel(@Param("id", ParseUUIDPipe) modelId: string): Promise<ModelDetail> {
    return this.models.getModel(modelId);
  }

  @Post()
  createModel(@Body({ schema: newModelSchema }) newModel: NewModel): Promise<Model> {
    return this.models.createModel(newModel);
  }

  /** Renames, enables or disables the Model. */
  @Patch(":id")
  updateModel(
    @Param("id", ParseUUIDPipe) modelId: string,
    @Body({ schema: modelChangesSchema }) changes: ModelChanges,
  ): Promise<Model> {
    return this.models.updateModel(modelId, changes);
  }

  @Delete(":id")
  @HttpCode(HttpStatus.NO_CONTENT)
  deleteModel(@Param("id", ParseUUIDPipe) modelId: string): Promise<void> {
    return this.models.deleteModel(modelId);
  }
}
