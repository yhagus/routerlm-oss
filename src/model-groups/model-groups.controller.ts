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
} from '@nestjs/common';
import { CommandBus, QueryBus } from '@nestjs/cqrs';
import { DashboardController } from '@/auth/decorators/dashboard-controller.decorator';
import { CreateModelGroupCommand } from './commands/impl/create-model-group.command';
import { DeleteModelGroupCommand } from './commands/impl/delete-model-group.command';
import { UpdateModelGroupCommand } from './commands/impl/update-model-group.command';
import type { ModelGroup, ModelGroupSummary } from './models/model-group';
import { ListModelGroupsQuery } from './queries/impl/list-model-groups.query';
import {
  type ModelGroupChanges,
  modelGroupChangesSchema,
  type NewModelGroup,
  newModelGroupSchema,
} from './schemas/model-group.schema';

@DashboardController('model-groups')
export class ModelGroupsController {
  constructor(
    private readonly commandBus: CommandBus,
    private readonly queryBus: QueryBus,
  ) {}

  @Get()
  listModelGroups(): Promise<ModelGroupSummary[]> {
    return this.queryBus.execute(new ListModelGroupsQuery());
  }

  @Post()
  createModelGroup(
    @Body({ schema: newModelGroupSchema }) newModelGroup: NewModelGroup,
  ): Promise<ModelGroup> {
    return this.commandBus.execute(new CreateModelGroupCommand(newModelGroup));
  }

  @Patch(':id')
  updateModelGroup(
    @Param('id', ParseUUIDPipe) modelGroupId: string,
    @Body({ schema: modelGroupChangesSchema }) changes: ModelGroupChanges,
  ): Promise<ModelGroup> {
    return this.commandBus.execute(new UpdateModelGroupCommand(modelGroupId, changes));
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  deleteModelGroup(@Param('id', ParseUUIDPipe) modelGroupId: string): Promise<void> {
    return this.commandBus.execute(new DeleteModelGroupCommand(modelGroupId));
  }
}
