import { CreateProviderAccountHandler } from './create-provider-account.handler';
import { CreateProviderHandler } from './create-provider.handler';
import { CreateUpstreamModelHandler } from './create-upstream-model.handler';
import { DeleteProviderAccountHandler } from './delete-provider-account.handler';
import { DeleteProviderHandler } from './delete-provider.handler';
import { DeleteUpstreamModelHandler } from './delete-upstream-model.handler';
import { EndProviderAccountExhaustedHandler } from './end-provider-account-exhausted.handler';
import { MarkProviderAccountExhaustedHandler } from './mark-provider-account-exhausted.handler';
import { PollOauthSignInHandler } from './poll-oauth-sign-in.handler';
import { StartOauthSignInHandler } from './start-oauth-sign-in.handler';
import { UpdateProviderAccountHandler } from './update-provider-account.handler';
import { UpdateProviderHandler } from './update-provider.handler';
import { UpdateUpstreamModelHandler } from './update-upstream-model.handler';

export const CommandHandlers = [
  CreateProviderHandler,
  UpdateProviderHandler,
  DeleteProviderHandler,
  CreateUpstreamModelHandler,
  UpdateUpstreamModelHandler,
  DeleteUpstreamModelHandler,
  CreateProviderAccountHandler,
  UpdateProviderAccountHandler,
  DeleteProviderAccountHandler,
  MarkProviderAccountExhaustedHandler,
  EndProviderAccountExhaustedHandler,
  StartOauthSignInHandler,
  PollOauthSignInHandler,
];
