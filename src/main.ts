import { ConfigService } from "@nestjs/config";
import { NestFactory } from "@nestjs/core";
import { NestNodeApplication, NodeAdapter } from "@nestjs/platform-node";
import { AppModule } from "./app.module.js";
import type { Env } from "./config/env.schema.js";

async function bootstrap() {
  const app = await NestFactory.create<NestNodeApplication>(AppModule, new NodeAdapter());
  const config = app.get<ConfigService<Env, true>>(ConfigService);
  await app.listen(config.get("PORT", { infer: true }));
}
await bootstrap();
