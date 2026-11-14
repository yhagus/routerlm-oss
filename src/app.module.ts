import { Module } from "@nestjs/common";
import { CqrsModule } from "@nestjs/cqrs";
import { McpModule } from "@nestjs/mcp";
import { AppController } from "./app.controller.js";
import { EchoHandler } from "./cqrs/echo.handler.js";
import { GetProjectInfoHandler } from "./cqrs/project-info.handler.js";
import { McpToolsModule } from "./mcp/mcp-tools.module.js";

@Module({
  imports: [
    CqrsModule.forRoot(),
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
