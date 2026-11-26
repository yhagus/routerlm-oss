import { AddRouteHandler } from './add-route.handler';
import { CreateModelHandler } from './create-model.handler';
import { DeleteModelHandler } from './delete-model.handler';
import { RemoveRouteHandler } from './remove-route.handler';
import { ReorderRoutesHandler } from './reorder-routes.handler';
import { UpdateModelHandler } from './update-model.handler';
import { UpdateRouteHandler } from './update-route.handler';

export const CommandHandlers = [
  CreateModelHandler,
  UpdateModelHandler,
  DeleteModelHandler,
  AddRouteHandler,
  UpdateRouteHandler,
  RemoveRouteHandler,
  ReorderRoutesHandler,
];
