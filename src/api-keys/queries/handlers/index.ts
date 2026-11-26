import { ListApiKeyRotationsHandler } from "./list-api-key-rotations.handler";
import { ListApiKeysHandler } from "./list-api-keys.handler";
import { ListModelChoicesHandler } from "./list-model-choices.handler";
import { RevealApiKeyHandler } from "./reveal-api-key.handler";

export const QueryHandlers = [
  ListApiKeysHandler,
  ListApiKeyRotationsHandler,
  ListModelChoicesHandler,
  RevealApiKeyHandler,
];
