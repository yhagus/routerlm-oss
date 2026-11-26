import { CreateModelGroupHandler } from './create-model-group.handler';
import { DeleteModelGroupHandler } from './delete-model-group.handler';
import { UpdateModelGroupHandler } from './update-model-group.handler';

export const CommandHandlers = [
  CreateModelGroupHandler,
  UpdateModelGroupHandler,
  DeleteModelGroupHandler,
];
