import { GetIntegrationHandler } from "./get-integration.handler.js";
import { ListIntegrationCustomersHandler } from "./list-integration-customers.handler.js";
import { ListIntegrationOfferedModelsHandler } from "./list-integration-offered-models.handler.js";
import { ListIntegrationRotationsHandler } from "./list-integration-rotations.handler.js";
import { ListIntegrationsHandler } from "./list-integrations.handler.js";

export const QueryHandlers = [
  GetIntegrationHandler,
  ListIntegrationCustomersHandler,
  ListIntegrationOfferedModelsHandler,
  ListIntegrationRotationsHandler,
  ListIntegrationsHandler,
];
