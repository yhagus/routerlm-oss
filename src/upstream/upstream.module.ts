import { BullModule } from "@nestjs/bullmq";
import { Module } from "@nestjs/common";
import { HttpClientModule } from "@nestjs/http-client";
import { OutboundFetch } from "@/libs/providers/outbound-fetch.js";
import { OAUTH_SIGN_INS_QUEUE } from "@/queue/models/queue-names.js";
import { RedisModule } from "@/redis/redis.module.js";
import { SnapshotModule } from "@/snapshot/snapshot.module.js";
import { CommandHandlers } from "./commands/handlers/index.js";
import { OauthSignInPolling } from "./jobs/oauth-sign-in-polling.js";
import { ProviderAccountSignInsController } from "./provider-account-sign-ins.controller.js";
import { CooldownStore } from "./providers/cooldown-store.js";
import { KimiCodeLoginClient } from "./providers/kimi-code-login-client.js";
import { OauthLoginClient } from "./providers/oauth-login-client.js";
import { OAUTH_LOGIN_HTTP_CLIENT, OAUTH_LOGIN_TIMEOUT_MS } from "./providers/oauth-login-http.js";
import { OpenAiCodexLoginClient } from "./providers/openai-codex-login-client.js";
import { OauthRefreshLock } from "./providers/oauth-refresh-lock.js";
import { OauthSignInStore } from "./providers/oauth-sign-in-store.js";
import { ProviderAccountCredentials } from "./providers/provider-account-credentials.js";
import { ProviderAccountHealth } from "./providers/provider-account-health.js";
import { ProviderAccountsController } from "./provider-accounts.controller.js";
import { ProviderKeyCipher, providerKeyCipherProvider } from "./providers/provider-key-cipher.js";
import { ProvidersController } from "./providers.controller.js";
import { QueryHandlers } from "./queries/handlers/index.js";
import { UpstreamModelsController } from "./upstream-models.controller.js";

@Module({
  imports: [
    SnapshotModule,
    RedisModule,
    BullModule.registerQueue({ name: OAUTH_SIGN_INS_QUEUE }),
    HttpClientModule.registerAsync({
      name: OAUTH_LOGIN_HTTP_CLIENT,
      inject: [OutboundFetch],
      useFactory: (outbound: OutboundFetch) => ({
        timeout: OAUTH_LOGIN_TIMEOUT_MS,
        retry: false,
        redirect: "error",
        fetch: outbound.fetch,
      }),
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
    KimiCodeLoginClient,
    OpenAiCodexLoginClient,
    OauthLoginClient,
    OauthRefreshLock,
    OauthSignInStore,
    OauthSignInPolling,
    ProviderAccountCredentials,
    ProviderAccountHealth,
    providerKeyCipherProvider,
    ...CommandHandlers,
    ...QueryHandlers,
  ],
  exports: [ProviderKeyCipher, ProviderAccountCredentials, CooldownStore, ProviderAccountHealth],
})
export class UpstreamModule {}
