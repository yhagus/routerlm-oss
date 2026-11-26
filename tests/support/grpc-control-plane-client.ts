import { Client, credentials, Metadata, type ServiceError } from '@grpc/grpc-js';
import { loadSync, type ServiceDefinition } from '@grpc/proto-loader';
import {
  CONTROL_PLANE_ERROR_CODES,
  CONTROL_PLANE_ERRORS,
  type ControlPlaneErrorCode,
} from '@/control-plane/models/control-plane-error';
import { CONTROL_PLANE_PROTO_PATH } from '@/control-plane/models/control-plane-grpc';
import {
  type TimestampMessage,
  timestampMessageOf,
  timestampOf,
} from '@/control-plane/models/proto-grpc';
import type { ControlPlaneClient, ControlPlaneOutcome } from './control-plane-client';

const READY_TIMEOUT_MS = 20_000;
const CONTROL_PLANE_SERVICE_NAME = 'routerlm.integration.v1.ControlPlane';

const CLIENT_LOADER_OPTIONS = { keepCase: false, longs: String, defaults: true, oneofs: false };

function controlPlaneService(): ServiceDefinition {
  const definitions = loadSync(CONTROL_PLANE_PROTO_PATH, CLIENT_LOADER_OPTIONS);
  const service = definitions[CONTROL_PLANE_SERVICE_NAME];
  if (!service || 'format' in service) {
    throw new Error(`control_plane.proto declares no ${CONTROL_PLANE_SERVICE_NAME}`);
  }
  return service;
}

function errorCodeOf(error: ServiceError): ControlPlaneErrorCode {
  const code = CONTROL_PLANE_ERROR_CODES.find(
    (candidate) => CONTROL_PLANE_ERRORS[candidate].grpcCode === error.code,
  );
  if (!code) {
    throw new Error(`The control plane answered gRPC status ${error.code}: ${error.details}`);
  }
  return code;
}

const isTimestamp = (value: unknown): value is TimestampMessage =>
  typeof value === 'object' && value !== null && 'seconds' in value && 'nanos' in value;

function isEmptyMap(value: unknown): boolean {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    Object.keys(value).length === 0
  );
}

function protoJsonReviver(_name: string, value: unknown): unknown {
  if (isTimestamp(value)) {
    return timestampOf(value).toISOString();
  }
  if (value === null || value === '' || isEmptyMap(value)) {
    return undefined;
  }
  return value;
}

function keySettingsMessageOf(settings: object): object {
  const entries = Object.entries(settings)
    .filter(([, field]) => field !== null)
    .map(([name, field]) => [
      name,
      name === 'expiresAt' && typeof field === 'string'
        ? timestampMessageOf(new Date(field))
        : field,
    ]);
  return Object.fromEntries(entries);
}

const snakeCaseOf = (name: string): string =>
  name.replaceAll(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`);

export async function grpcControlPlaneClient(
  address: string,
): Promise<{ client: ControlPlaneClient; close: () => Promise<void> }> {
  const service = controlPlaneService();
  const channel = new Client(address, credentials.createInsecure());
  await new Promise<void>((resolve, reject) => {
    channel.waitForReady(new Date(Date.now() + READY_TIMEOUT_MS), (error) =>
      error ? reject(error) : resolve(),
    );
  });

  const call = <T>(
    methodName: string,
    secret: string | undefined,
    request: object,
  ): Promise<ControlPlaneOutcome<T>> => {
    const method = service[methodName];
    const metadata = new Metadata();
    if (secret !== undefined) metadata.set('authorization', `Bearer ${secret}`);
    return new Promise((resolve, reject) => {
      channel.makeUnaryRequest(
        method.path,
        method.requestSerialize,
        method.responseDeserialize,
        request,
        metadata,
        (error, response) => {
          if (!error) {
            resolve({ ok: true, body: JSON.parse(JSON.stringify(response), protoJsonReviver) });
            return;
          }
          try {
            resolve({ ok: false, code: errorCodeOf(error) });
          } catch (unexpected) {
            reject(unexpected);
          }
        },
      );
    });
  };

  const client: ControlPlaneClient = {
    createKey: (secret, newKey) => call('CreateKey', secret, keySettingsMessageOf(newKey)),
    updateKey: (secret, id, changes) =>
      call('UpdateKey', secret, {
        id,
        key: keySettingsMessageOf(changes),
        updateMask: { paths: Object.keys(changes).map(snakeCaseOf) },
      }),
    rotateKey: (secret, id) => call('RotateKey', secret, { id }),
    revokeKey: (secret, id) => call('RevokeKey', secret, { id }),
    getKey: (secret, id) => call('GetKey', secret, { id }),
    listKeys: (secret, query = {}) => call('ListKeys', secret, query),
    listModels: (secret) => call('ListModels', secret, {}),
    listUsageLogs: (secret, query = {}) => call('ListUsageLogs', secret, query),
  };
  return {
    client,
    close: async () => channel.close(),
  };
}
