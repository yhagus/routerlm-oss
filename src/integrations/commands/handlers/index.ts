import { CreateIntegrationHandler } from "./create-integration.handler";
import { DeleteIntegrationHandler } from "./delete-integration.handler";
import { DisableIntegrationHandler } from "./disable-integration.handler";
import { EnableIntegrationHandler } from "./enable-integration.handler";
import { RotateIntegrationSecretHandler } from "./rotate-integration-secret.handler";
import { UpdateIntegrationHandler } from "./update-integration.handler";

export const CommandHandlers = [
  CreateIntegrationHandler,
  UpdateIntegrationHandler,
  RotateIntegrationSecretHandler,
  DisableIntegrationHandler,
  EnableIntegrationHandler,
  DeleteIntegrationHandler,
];
