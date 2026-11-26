import { CreateApiKeyHandler } from './create-api-key.handler';
import { RevokeApiKeyHandler } from './revoke-api-key.handler';
import { RotateApiKeyHandler } from './rotate-api-key.handler';
import { UpdateApiKeyHandler } from './update-api-key.handler';

export const CommandHandlers = [
  CreateApiKeyHandler,
  UpdateApiKeyHandler,
  RotateApiKeyHandler,
  RevokeApiKeyHandler,
];
