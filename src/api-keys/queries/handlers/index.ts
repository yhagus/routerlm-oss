import { ListApiKeyRotationsHandler } from "./list-api-key-rotations.handler.js";
import { ListApiKeysHandler } from "./list-api-keys.handler.js";
import { ListModelChoicesHandler } from "./list-model-choices.handler.js";
import { RevealApiKeyHandler } from "./reveal-api-key.handler.js";

export const QueryHandlers = [
  ListApiKeysHandler,
  ListApiKeyRotationsHandler,
  ListModelChoicesHandler,
  RevealApiKeyHandler,
];
