import type { ConfigService } from "@nestjs/config";
import type { NestNodeApplication } from "@nestjs/platform-node";
import { type BackendRole, type Env, envSchema } from "@/config/schemas/env.schema.js";
import { runGatewayProcesses } from "@/libs/models/gateway-processes.js";

async function bootstrap(role: BackendRole): Promise<void> {
  const { ConfigService: ConfigServiceToken } = await import("@nestjs/config");
  const { NestFactory } = await import("@nestjs/core");
  const { AppModule } = await import("@/app.module.js");
  const { configureApp, createNodeAdapter } = await import("@/configure-app.js");
  const app = await NestFactory.create<NestNodeApplication>(
    AppModule.forRole(role),
    createNodeAdapter(),
  );
  configureApp(app);
  app.enableShutdownHooks();
  const config = app.get<ConfigService<Env, true>>(ConfigServiceToken);
  await app.listen(config.get("PORT", { infer: true }));
}

const { BACKEND_PROCESSES, BACKEND_ROLE } = envSchema
  .pick({ BACKEND_PROCESSES: true, BACKEND_ROLE: true })
  .parse(process.env);
await runGatewayProcesses(BACKEND_PROCESSES, () => bootstrap(BACKEND_ROLE));
