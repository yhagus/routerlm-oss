import { BullModule } from "@nestjs/bullmq";
import { Module } from "@nestjs/common";
import { HttpClientModule } from "@nestjs/http-client";
import { OAUTH_SIGN_INS_QUEUE } from "@/queue/models/queue-names.js";
import { RedisModule } from "@/redis/redis.module.js";
import { SnapshotModule } from "@/snapshot/snapshot.module.js";
import { CommandHandlers } from "./commands/handlers/index.js";
import { OauthSignInPolling } from "./jobs/oauth-sign-in-polling.js";
import { ProviderAccountSignInsController } from "./provider-account-sign-ins.controller.js";
import { CooldownStore } from "./providers/cooldown-store.js";
import {
  OAUTH_LOGIN_HTTP_CLIENT,
  OAUTH_LOGIN_TIMEOUT_MS,
  OauthLoginClient,
} from "./providers/oauth-login-client.js";
import { OauthSignInStore } from "./providers/oauth-sign-in-store.js";
import { ProviderAccountHealth } from "./providers/provider-account-health.js";
import { ProviderAccountsController } from "./provider-accounts.controller.js";
import { ProviderKeyCipher, providerKeyCipherProvider } from "./providers/provider-key-cipher.js";
import { ProvidersController } from "./providers.controller.js";
import { QueryHandlers } from "./queries/handlers/index.js";
import { UpstreamModelsController } from "./upstream-models.controller.js";

/**
 * Dashboard management of Providers, Upstream Models and Provider Accounts,
 * and signing in to a Provider that offers OAuth Login. The worker imports it
 * too, and polls for the pending sign-ins.
 */
@Module({
  imports: [
    SnapshotModule,
    RedisModule,
    // The connection is the importing process's: QueueModule's in the backend, WorkerModule's in the worker.
    BullModule.registerQueue({ name: OAUTH_SIGN_INS_QUEUE }),
    // No retries: the next poll is the retry. A redirect fails rather than
    // carry a device code or a token to another host.
    HttpClientModule.register({
      name: OAUTH_LOGIN_HTTP_CLIENT,
      timeout: OAUTH_LOGIN_TIMEOUT_MS,
      retry: false,
      redirect: "error",
    }),
  ],
  controllers: [
    ProvidersController,
    UpstreamModelsController,
    ProviderAccountsController,
    ProviderAccountSignInsController,
  ],
  providers: [
    CooldownStore,
    OauthLoginClient,
    OauthSignInStore,
    OauthSignInPolling,
    ProviderAccountHealth,
    providerKeyCipherProvider,
    ...CommandHandlers,
    ...QueryHandlers,
  ],
  // The gateway decrypts Provider Account keys, and keeps their Cooldown and
  // health.
  exports: [ProviderKeyCipher, CooldownStore, ProviderAccountHealth],
})
export class UpstreamModule {}
