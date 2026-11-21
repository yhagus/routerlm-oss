import { NestFactory } from "@nestjs/core";
import { controlPlanePortSchema } from "@/config/schemas/env.schema.js";
import { controlPlaneGrpcOptions } from "@/control-plane/models/control-plane-grpc.js";
import { WorkerModule } from "@/worker.module.js";

// Read before Nest starts: it decides which kind of app the worker is.
const controlPlanePort = controlPlanePortSchema.parse(process.env.CONTROL_PLANE_PORT);

if (controlPlanePort === undefined) {
  // A standalone application context: no listener, only queue processors.
  // The BullMQ workers keep the process alive.
  const app = await NestFactory.createApplicationContext(WorkerModule);
  // Closes the workers gracefully on SIGTERM (docker compose stop, bun --watch restart).
  app.enableShutdownHooks();
} else {
  // ADR 0033: the same queue processors, plus the control plane's gRPC server.
  const app = await NestFactory.createMicroservice(
    WorkerModule.withControlPlane(),
    controlPlaneGrpcOptions(controlPlanePort),
  );
  app.enableShutdownHooks();
  await app.listen();
}
