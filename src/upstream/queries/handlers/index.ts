import { GetOauthSignInHandler } from "./get-oauth-sign-in.handler.js";
import { GetProviderAccountKeyHandler } from "./get-provider-account-key.handler.js";
import { ListProviderAccountsHandler } from "./list-provider-accounts.handler.js";
import { ListProvidersHandler } from "./list-providers.handler.js";
import { ListUpstreamModelsHandler } from "./list-upstream-models.handler.js";

export const QueryHandlers = [
  ListProvidersHandler,
  ListUpstreamModelsHandler,
  ListProviderAccountsHandler,
  GetProviderAccountKeyHandler,
  GetOauthSignInHandler,
];
