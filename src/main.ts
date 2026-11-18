import { ConfigService } from "@nestjs/config";
import { NestFactory } from "@nestjs/core";
import type { NestNodeApplication } from "@nestjs/platform-node";
import { AppModule } from "@/app.module.js";
import type { Env } from "@/config/schemas/env.schema.js";
import { configureApp, createNodeAdapter } from "@/configure-app.js";

async function bootstrap() {
  const app = await NestFactory.create<NestNodeApplication>(AppModule, createNodeAdapter());
  configureApp(app);
  const config = app.get<ConfigService<Env, true>>(ConfigService);
  await app.listen(config.get("PORT", { infer: true }));
}
await bootstrap();
