import { ExecutionContextHost } from "@nestjs/core/helpers/execution-context-host.js";
import type { NestNodeApplication } from "@nestjs/platform-node";
import request from "supertest";
import { ApiKeyAuth } from "@/api-keys/providers/api-key-auth.js";

/** Creates an API Key through the dashboard API and returns its id and whole key. */
export async function createApiKey(
  app: NestNodeApplication,
  cookie: string,
  newKey: object = { name: "CI" },
): Promise<{ id: string; key: string }> {
  const created = await request(app.getHttpServer())
    .post("/api/api-keys")
    .set("Cookie", cookie)
    .send(newKey)
    .expect(201);
  return created.body;
}

/** Signs in with the key the way an inference route would, through ApiKeyAuth. */
export function authenticateWithApiKey(app: NestNodeApplication, key: string): Promise<unknown> {
  const httpRequest = { headers: { authorization: `Bearer ${key}` } };
  return app.get(ApiKeyAuth).authenticate(new ExecutionContextHost([httpRequest]));
}
