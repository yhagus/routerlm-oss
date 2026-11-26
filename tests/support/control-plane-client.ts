import type { NestNodeApplication } from '@nestjs/platform-node';
import request from 'supertest';
import type { ControlPlaneErrorCode } from '@/control-plane/models/control-plane-error';
import type {
  ApiKeyJson,
  IssuedKeyJson,
  ListKeysResponseJson,
  ListModelsResponseJson,
  ListUsageLogsResponseJson,
} from '@/control-plane/models/proto-json';

export type ControlPlaneOutcome<T> =
  | { ok: true; body: T }
  | { ok: false; code: ControlPlaneErrorCode };

export interface ControlPlaneClient {
  createKey(
    secret: string | undefined,
    newKey: object,
  ): Promise<ControlPlaneOutcome<IssuedKeyJson>>;
  updateKey(secret: string, id: string, changes: object): Promise<ControlPlaneOutcome<ApiKeyJson>>;
  rotateKey(secret: string, id: string): Promise<ControlPlaneOutcome<IssuedKeyJson>>;
  revokeKey(secret: string, id: string): Promise<ControlPlaneOutcome<ApiKeyJson>>;
  getKey(secret: string, id: string): Promise<ControlPlaneOutcome<ApiKeyJson>>;
  listKeys(
    secret: string,
    query?: { customerId?: string; pageSize?: number; pageToken?: string },
  ): Promise<ControlPlaneOutcome<ListKeysResponseJson>>;
  listModels(secret: string): Promise<ControlPlaneOutcome<ListModelsResponseJson>>;
  listUsageLogs(
    secret: string,
    query?: { after?: string; pageSize?: number },
  ): Promise<ControlPlaneOutcome<ListUsageLogsResponseJson>>;
}

const PREFIX = '/integration/v1';

export function httpControlPlaneClient(app: NestNodeApplication): ControlPlaneClient {
  const server = app.getHttpServer();
  const send = async <T>(
    call: request.Test,
    secret: string | undefined,
  ): Promise<ControlPlaneOutcome<T>> => {
    const response = await (secret === undefined
      ? call
      : call.set('Authorization', `Bearer ${secret}`));
    if (response.status < 400) {
      return { ok: true, body: response.body };
    }
    return { ok: false, code: response.body.code };
  };
  return {
    createKey: (secret, newKey) =>
      send(request(server).post(`${PREFIX}/keys`).send(newKey), secret),
    updateKey: (secret, id, changes) =>
      send(request(server).patch(`${PREFIX}/keys/${id}`).send(changes), secret),
    rotateKey: (secret, id) => send(request(server).post(`${PREFIX}/keys/${id}/rotate`), secret),
    revokeKey: (secret, id) => send(request(server).post(`${PREFIX}/keys/${id}/revoke`), secret),
    getKey: (secret, id) => send(request(server).get(`${PREFIX}/keys/${id}`), secret),
    listKeys: (secret, query = {}) =>
      send(request(server).get(`${PREFIX}/keys`).query(query), secret),
    listModels: (secret) => send(request(server).get(`${PREFIX}/models`), secret),
    listUsageLogs: (secret, query = {}) =>
      send(request(server).get(`${PREFIX}/usage-logs`).query(query), secret),
  };
}
