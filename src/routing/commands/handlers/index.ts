import { AddRouteHandler } from "./add-route.handler.js";
import { CreateModelHandler } from "./create-model.handler.js";
import { DeleteModelHandler } from "./delete-model.handler.js";
import { RemoveRouteHandler } from "./remove-route.handler.js";
import { ReorderRoutesHandler } from "./reorder-routes.handler.js";
import { UpdateModelHandler } from "./update-model.handler.js";
import { UpdateRouteHandler } from "./update-route.handler.js";

export const CommandHandlers = [
  CreateModelHandler,
  UpdateModelHandler,
  DeleteModelHandler,
  AddRouteHandler,
  UpdateRouteHandler,
  RemoveRouteHandler,
  ReorderRoutesHandler,
];
