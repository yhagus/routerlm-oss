import { ExecutionContextHost } from "@nestjs/core/helpers/execution-context-host";
import type { NestNodeApplication } from "@nestjs/platform-node";
import request from "supertest";
import { ApiKeyAuth } from "@/api-keys/providers/api-key-auth";

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

export function authenticateWithApiKey(app: NestNodeApplication, key: string): Promise<unknown> {
  const httpRequest = { headers: { authorization: `Bearer ${key}` } };
  return app.get(ApiKeyAuth).authenticate(new ExecutionContextHost([httpRequest]));
}
