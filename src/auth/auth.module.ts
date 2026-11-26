import { AuthenticationModule } from '@nestjs/authentication';
import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '@/config/schemas/env.schema';
import { UsersModule } from '@/users/users.module';
import { AuthController } from './auth.controller';
import './models/authentication-types';
import { DrizzleSessionStore } from './providers/drizzle-session.store';
import { SessionAuth } from './providers/session-auth';

@Module({
  imports: [
    AuthenticationModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) => ({
        session: {
          trustedOrigins: [config.get('WEB_ORIGIN', { infer: true })],
        },
      }),
    }),
    UsersModule,
  ],
  controllers: [AuthController],
  providers: [DrizzleSessionStore, SessionAuth],
})
export class AuthModule {}
