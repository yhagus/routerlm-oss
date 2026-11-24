import { AuthenticationModule } from "@nestjs/authentication";
import { Module } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type { Env } from "@/config/schemas/env.schema.js";
import { UsersModule } from "@/users/users.module.js";
import { AuthController } from "./auth.controller.js";
import "./models/authentication-types.js";
import { DrizzleSessionStore } from "./providers/drizzle-session.store.js";
import { SessionAuth } from "./providers/session-auth.js";

@Module({
  imports: [
    AuthenticationModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) => ({
        session: {
          trustedOrigins: [config.get("WEB_ORIGIN", { infer: true })],
        },
      }),
    }),
    UsersModule,
  ],
  controllers: [AuthController],
  providers: [DrizzleSessionStore, SessionAuth],
})
export class AuthModule {}
