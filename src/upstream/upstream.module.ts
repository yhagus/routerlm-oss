import { BullModule } from "@nestjs/bullmq";
import { Module } from "@nestjs/common";
import { HttpClientModule } from "@nestjs/http-client";
import { OutboundFetch } from "@/libs/providers/outbound-fetch";
import { OAUTH_SIGN_INS_QUEUE } from "@/queue/models/queue-names";
import { RedisModule } from "@/redis/redis.module";
import { SnapshotModule } from "@/snapshot/snapshot.module";
import { CommandHandlers } from "./commands/handlers";
import { OauthSignInPolling } from "./jobs/oauth-sign-in-polling";
import { ProviderAccountSignInsController } from "./provider-account-sign-ins.controller";
import { CooldownStore } from "./providers/cooldown-store";
import { KimiCodeLoginClient } from "./providers/kimi-code-login-client";
import { OauthLoginClient } from "./providers/oauth-login-client";
import { OAUTH_LOGIN_HTTP_CLIENT, OAUTH_LOGIN_TIMEOUT_MS } from "./providers/oauth-login-http";
import { OpenAiCodexLoginClient } from "./providers/openai-codex-login-client";
import { OauthRefreshLock } from "./providers/oauth-refresh-lock";
import { OauthSignInStore } from "./providers/oauth-sign-in-store";
import { ProviderAccountCredentials } from "./providers/provider-account-credentials";
import { ProviderAccountHealth } from "./providers/provider-account-health";
import { ProviderAccountsController } from "./provider-accounts.controller";
import { ProviderKeyCipher, providerKeyCipherProvider } from "./providers/provider-key-cipher";
import { ProvidersController } from "./providers.controller";
import { QueryHandlers } from "./queries/handlers";
import { UpstreamModelsController } from "./upstream-models.controller";

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
