import { NestFactory } from "@nestjs/core";
import { WorkerModule } from "./worker.module.js";

// A standalone application context: no HTTP listener, only queue processors.
// The BullMQ workers keep the process alive.
const app = await NestFactory.createApplicationContext(WorkerModule);
// Closes the workers gracefully on SIGTERM (docker compose stop, bun --watch restart).
app.enableShutdownHooks();
