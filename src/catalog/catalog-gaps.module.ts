import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { HttpClientModule } from '@nestjs/http-client';
import type { Env } from '@/config/schemas/env.schema';
import { CatalogGapsController } from './catalog-gaps.controller';
import { MODELS_DEV_HTTP_CLIENT } from './providers/models-dev-http-client';
import { ModelsDevReader } from './providers/models-dev-reader';
import { QueryHandlers } from './queries/handlers';

@Module({
  imports: [
    HttpClientModule.registerAsync({
      name: MODELS_DEV_HTTP_CLIENT,
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) => ({
        timeout: config.get('MODELS_DEV_TIMEOUT_MS', { infer: true }),
        retry: false,
        redirect: 'error',
      }),
    }),
  ],
  controllers: [CatalogGapsController],
  providers: [ModelsDevReader, ...QueryHandlers],
})
export class CatalogGapsModule {}
