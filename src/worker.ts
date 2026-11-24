import { NestFactory } from "@nestjs/core";
import { controlPlanePortSchema } from "@/config/schemas/env.schema.js";
import { controlPlaneGrpcOptions } from "@/control-plane/models/control-plane-grpc.js";
import { WorkerModule } from "@/worker.module.js";

const controlPlanePort = controlPlanePortSchema.parse(process.env.CONTROL_PLANE_PORT);

if (controlPlanePort === undefined) {
  const app = await NestFactory.createApplicationContext(WorkerModule);
  app.enableShutdownHooks();
} else {
  const app = await NestFactory.createMicroservice(
    WorkerModule.withControlPlane(),
    controlPlaneGrpcOptions(controlPlanePort),
  );
  app.enableShutdownHooks();
  await app.listen();
}
