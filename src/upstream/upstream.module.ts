import { Module } from "@nestjs/common";
import { SnapshotModule } from "../snapshot/snapshot.module.js";
import { ConfigService } from "@nestjs/config";
import type { Env } from "../config/env.schema.js";
import { ProviderAccountsController } from "./provider-accounts.controller.js";
import { ProviderAccountsService } from "./provider-accounts.service.js";
import { ProviderKeyCipher } from "./provider-key-cipher.js";
import { ProvidersController } from "./providers.controller.js";
import { ProvidersService } from "./providers.service.js";
import { UpstreamChangeSignal } from "./upstream-change-signal.js";
import { UpstreamModelsController } from "./upstream-models.controller.js";
import { UpstreamModelsService } from "./upstream-models.service.js";

/** Dashboard management of Providers, Upstream Models and Provider Accounts. */
@Module({
  imports: [SnapshotModule],
  controllers: [ProvidersController, UpstreamModelsController, ProviderAccountsController],
  providers: [
    ProvidersService,
    ProviderAccountsService,
    UpstreamModelsService,
    UpstreamChangeSignal,
    {
      provide: ProviderKeyCipher,
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) =>
        new ProviderKeyCipher(config.get("ENCRYPTION_KEY", { infer: true })),
    },
  ],
  // The gateway decrypts Provider Account keys; the snapshot refresh hooks into the signal.
  exports: [ProviderKeyCipher, UpstreamChangeSignal],
})
export class UpstreamModule {}
