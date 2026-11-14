import { CreateProviderAccountHandler } from "./create-provider-account.handler.js";
import { CreateProviderHandler } from "./create-provider.handler.js";
import { CreateUpstreamModelHandler } from "./create-upstream-model.handler.js";
import { DeleteProviderAccountHandler } from "./delete-provider-account.handler.js";
import { DeleteProviderHandler } from "./delete-provider.handler.js";
import { DeleteUpstreamModelHandler } from "./delete-upstream-model.handler.js";
import { UpdateProviderAccountHandler } from "./update-provider-account.handler.js";
import { UpdateProviderHandler } from "./update-provider.handler.js";
import { UpdateUpstreamModelHandler } from "./update-upstream-model.handler.js";

export const CommandHandlers = [
  CreateProviderHandler,
  UpdateProviderHandler,
  DeleteProviderHandler,
  CreateUpstreamModelHandler,
  UpdateUpstreamModelHandler,
  DeleteUpstreamModelHandler,
  CreateProviderAccountHandler,
  UpdateProviderAccountHandler,
  DeleteProviderAccountHandler,
];
