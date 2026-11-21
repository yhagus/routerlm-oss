import { ExecutionContextHost } from "@nestjs/core/helpers/execution-context-host.js";
import type { NestNodeApplication } from "@nestjs/platform-node";
import request from "supertest";
import { IntegrationSecretAuth } from "@/integrations/providers/integration-secret-auth.js";

/** Creates an Integration through the dashboard API and returns its id and Integration Secret. */
export async function createIntegration(
  app: NestNodeApplication,
  cookie: string,
  newIntegration: object = { name: "Acme SaaS" },
): Promise<{ id: string; secret: string }> {
  const created = await request(app.getHttpServer())
    .post("/api/integrations")
    .set("Cookie", cookie)
    .send(newIntegration)
    .expect(201);
  return created.body;
}

/** Signs in with the Integration Secret the way a control plane route would, through IntegrationSecretAuth. */
export function authenticateWithIntegrationSecret(
  app: NestNodeApplication,
  secret: string,
): Promise<unknown> {
  const httpRequest = { headers: { authorization: `Bearer ${secret}` } };
  return app.get(IntegrationSecretAuth).authenticate(new ExecutionContextHost([httpRequest]));
}
