import { GetProviderAccountCredentialHandler } from "./get-provider-account-credential.handler";
import { GetOauthSignInHandler } from "./get-oauth-sign-in.handler";
import { ListProviderAccountsHandler } from "./list-provider-accounts.handler";
import { ListProvidersHandler } from "./list-providers.handler";
import { ListUpstreamModelsHandler } from "./list-upstream-models.handler";

export const QueryHandlers = [
  ListProvidersHandler,
  ListUpstreamModelsHandler,
  ListProviderAccountsHandler,
  GetOauthSignInHandler,
  GetProviderAccountCredentialHandler,
];
