import { GetIntegrationHandler } from './get-integration.handler';
import { ListIntegrationCustomersHandler } from './list-integration-customers.handler';
import { ListIntegrationOfferedModelsHandler } from './list-integration-offered-models.handler';
import { ListIntegrationRotationsHandler } from './list-integration-rotations.handler';
import { ListIntegrationsHandler } from './list-integrations.handler';

export const QueryHandlers = [
  GetIntegrationHandler,
  ListIntegrationCustomersHandler,
  ListIntegrationOfferedModelsHandler,
  ListIntegrationRotationsHandler,
  ListIntegrationsHandler,
];
