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
import { type UpstreamModel, UpstreamModelsService } from "./upstream-models.service.js";
import {
  type NewUpstreamModel,
  newUpstreamModelSchema,
  type UpstreamModelChanges,
  upstreamModelChangesSchema,
} from "./upstream.schemas.js";

@DashboardController("upstream-models")
export class UpstreamModelsController {
  constructor(private readonly upstreamModels: UpstreamModelsService) {}

  @Get()
  listUpstreamModels(): Promise<UpstreamModel[]> {
    return this.upstreamModels.listUpstreamModels();
  }

  @Post()
  createUpstreamModel(
    @Body({ schema: newUpstreamModelSchema }) newUpstreamModel: NewUpstreamModel,
  ): Promise<UpstreamModel> {
    return this.upstreamModels.createUpstreamModel(newUpstreamModel);
  }

  /** Edits Capabilities, limits and prices, or enables or disables the Upstream Model. */
  @Patch(":id")
  updateUpstreamModel(
    @Param("id", ParseUUIDPipe) upstreamModelId: string,
    @Body({ schema: upstreamModelChangesSchema }) changes: UpstreamModelChanges,
  ): Promise<UpstreamModel> {
    return this.upstreamModels.updateUpstreamModel(upstreamModelId, changes);
  }

  @Delete(":id")
  @HttpCode(HttpStatus.NO_CONTENT)
  deleteUpstreamModel(@Param("id", ParseUUIDPipe) upstreamModelId: string): Promise<void> {
    return this.upstreamModels.deleteUpstreamModel(upstreamModelId);
  }
}
