import { AuthenticationModule } from "@nestjs/authentication";
import { Module } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type { Env } from "../config/env.schema.js";
import { UsersModule } from "../users/users.module.js";
import { AuthController } from "./auth.controller.js";
import "./authentication-types.js";
import { DrizzleSessionStore } from "./drizzle-session.store.js";
import { SessionAuth } from "./session-auth.js";

/**
 * Dashboard sign-in. AuthenticationModule is global and installs a global
 * guard: every route needs a signed-in User unless it is `@Public()`.
 */
@Module({
  imports: [
    AuthenticationModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) => ({
        session: {
          // The browser calls the web app, whose server forwards to us with the page's Origin.
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
