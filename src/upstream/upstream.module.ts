import { Module } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type { Env } from "../config/schemas/env.schema.js";
import { RedisModule } from "../redis/redis.module.js";
import { SnapshotModule } from "../snapshot/snapshot.module.js";
import { CommandHandlers } from "./commands/handlers/index.js";
import { CooldownStore } from "./providers/cooldown-store.js";
import { ProviderAccountHealth } from "./providers/provider-account-health.js";
import { ProviderAccountsController } from "./provider-accounts.controller.js";
import { ProviderKeyCipher } from "./providers/provider-key-cipher.js";
import { ProvidersController } from "./providers.controller.js";
import { QueryHandlers } from "./queries/handlers/index.js";
import { UpstreamModelsController } from "./upstream-models.controller.js";

/** Dashboard management of Providers, Upstream Models and Provider Accounts. */
@Module({
  imports: [SnapshotModule, RedisModule],
  controllers: [ProvidersController, UpstreamModelsController, ProviderAccountsController],
  providers: [
    CooldownStore,
    ProviderAccountHealth,
    {
      provide: ProviderKeyCipher,
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) =>
        new ProviderKeyCipher(config.get("ENCRYPTION_KEY", { infer: true })),
    },
    ...CommandHandlers,
    ...QueryHandlers,
  ],
  // The gateway decrypts Provider Account keys, and keeps their Cooldown and
  // health.
  exports: [ProviderKeyCipher, CooldownStore, ProviderAccountHealth],
})
export class UpstreamModule {}
