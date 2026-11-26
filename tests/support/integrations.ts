import { ExecutionContextHost } from '@nestjs/core/helpers/execution-context-host';
import type { NestNodeApplication } from '@nestjs/platform-node';
import request from 'supertest';
import { IntegrationSecretAuth } from '@/integrations/providers/integration-secret-auth';

export async function createIntegration(
  app: NestNodeApplication,
  cookie: string,
  newIntegration: object = { name: 'Acme SaaS' },
): Promise<{ id: string; secret: string }> {
  const created = await request(app.getHttpServer())
    .post('/api/integrations')
    .set('Cookie', cookie)
    .send(newIntegration)
    .expect(201);
  return created.body;
}

export function authenticateWithIntegrationSecret(
  app: NestNodeApplication,
  secret: string,
): Promise<unknown> {
  const httpRequest = { headers: { authorization: `Bearer ${secret}` } };
  return app.get(IntegrationSecretAuth).authenticate(new ExecutionContextHost([httpRequest]));
}
