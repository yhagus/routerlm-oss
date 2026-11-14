import { NestFactory } from "@nestjs/core";
import { McpStdioLogger, McpStdioServer } from "@nestjs/mcp";
import { StdioAppModule } from "./stdio-app.module.js";

const app = await NestFactory.createApplicationContext(StdioAppModule, {
  logger: new McpStdioLogger(),
});

await app.get(McpStdioServer).listen();
await app.close();
