import { CreateIntegrationHandler } from "./create-integration.handler.js";
import { DeleteIntegrationHandler } from "./delete-integration.handler.js";
import { DisableIntegrationHandler } from "./disable-integration.handler.js";
import { EnableIntegrationHandler } from "./enable-integration.handler.js";
import { RotateIntegrationSecretHandler } from "./rotate-integration-secret.handler.js";
import { UpdateIntegrationHandler } from "./update-integration.handler.js";

export const CommandHandlers = [
  CreateIntegrationHandler,
  UpdateIntegrationHandler,
  RotateIntegrationSecretHandler,
  DisableIntegrationHandler,
  EnableIntegrationHandler,
  DeleteIntegrationHandler,
];
