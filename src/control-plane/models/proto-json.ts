import type {
  CustomerApiKey,
  CustomerApiKeyPage,
  IssuedCustomerApiKey,
} from "./customer-api-key.js";

// The HTTP adapter's bodies, in proto3's JSON mapping of control_plane.proto:
// lowerCamelCase names, Timestamps as RFC 3339 strings, unset optional fields left out.

export interface ApiKeyJson {
  id: string;
  keyId: string;
  name: string;
  customerId: string;
  createdAt: string;
  expiresAt?: string;
  revokedAt?: string;
  allowedModelIds: string[];
  spendLimit?: number;
  spent: number;
  requestRate?: number;
}

export interface IssuedKeyJson {
  apiKey: ApiKeyJson;
  key: string;
}

export interface ListKeysResponseJson {
  keys: ApiKeyJson[];
  nextPageToken?: string;
}

/** The body of an HTTP error: the gRPC status name and a message. */
export interface ErrorJson {
  code: string;
  message: string;
}

export function apiKeyJsonOf(apiKey: CustomerApiKey): ApiKeyJson {
  return {
    id: apiKey.id,
    keyId: apiKey.keyId,
    name: apiKey.name,
    customerId: apiKey.customerId,
    createdAt: apiKey.createdAt.toISOString(),
    expiresAt: apiKey.expiresAt?.toISOString(),
    revokedAt: apiKey.revokedAt?.toISOString(),
    allowedModelIds: apiKey.allowedModelIds,
    spendLimit: apiKey.spendLimit ?? undefined,
    spent: apiKey.spent,
    requestRate: apiKey.requestRate ?? undefined,
  };
}

export function issuedKeyJsonOf(issued: IssuedCustomerApiKey): IssuedKeyJson {
  return { apiKey: apiKeyJsonOf(issued.apiKey), key: issued.key };
}

export function listKeysResponseJsonOf(page: CustomerApiKeyPage): ListKeysResponseJson {
  return {
    keys: page.keys.map(apiKeyJsonOf),
    nextPageToken: page.nextPageToken ?? undefined,
  };
}
