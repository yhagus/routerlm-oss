import { Module } from '@nestjs/common';
import { SnapshotModule } from '@/snapshot/snapshot.module';
import { SpendLimitsModule } from '@/spend-limits/spend-limits.module';
import { providerKeyCipherProvider } from '@/upstream/providers/provider-key-cipher';
import { ApiKeyAuth } from './providers/api-key-auth';
import { ApiKeysController } from './api-keys.controller';
import { CommandHandlers } from './commands/handlers';
import { QueryHandlers } from './queries/handlers';

@Module({
  imports: [SnapshotModule, SpendLimitsModule],
  controllers: [ApiKeysController],
  providers: [ApiKeyAuth, providerKeyCipherProvider, ...CommandHandlers, ...QueryHandlers],
  exports: [ApiKeyAuth],
})
export class ApiKeysModule {}
