import { CreateApiKeyHandler } from "./create-api-key.handler.js";
import { RevokeApiKeyHandler } from "./revoke-api-key.handler.js";

export const CommandHandlers = [CreateApiKeyHandler, RevokeApiKeyHandler];
