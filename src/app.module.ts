import { Module } from "@nestjs/common";
import { ConfigModule, ConfigService } from "@nestjs/config";
import { CqrsModule } from "@nestjs/cqrs";
import { DrizzleModule } from "@nestjs/drizzle";
import { McpModule } from "@nestjs/mcp";
import { drizzle } from "drizzle-orm/node-postgres";
import { AppController } from "./app.controller.js";
import { type Env, envSchema } from "./config/env.schema.js";
import { EchoHandler } from "./cqrs/echo.handler.js";
import { GetProjectInfoHandler } from "./cqrs/project-info.handler.js";
import { relations } from "./db/relations.js";
import { McpToolsModule } from "./mcp/mcp-tools.module.js";

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, validationSchema: envSchema }),
    CqrsModule.forRoot(),
    DrizzleModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) => ({
        drizzle,
        connection: config.get("DATABASE_URL", { infer: true }),
        relations,
      }),
    }),
    McpModule.forRoot({
      name: "routerlm-nest",
      version: "0.0.1",
      instructions: "Use project_info for server details and echo for text checks.",
      path: "mcp",
    }),
    McpToolsModule,
  ],
  controllers: [AppController],
  providers: [EchoHandler, GetProjectInfoHandler],
})
export class AppModule {}
