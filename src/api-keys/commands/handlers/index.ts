import { CreateApiKeyHandler } from "./create-api-key.handler.js";
import { RevokeApiKeyHandler } from "./revoke-api-key.handler.js";
import { RotateApiKeyHandler } from "./rotate-api-key.handler.js";
import { UpdateApiKeyHandler } from "./update-api-key.handler.js";

export const CommandHandlers = [
  CreateApiKeyHandler,
  UpdateApiKeyHandler,
  RotateApiKeyHandler,
  RevokeApiKeyHandler,
];
