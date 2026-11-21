import { and, desc, eq, type SQL } from "drizzle-orm";
import { z } from "zod";
import { assertModelsExist } from "@/api-keys/models/assert-models-exist.js";
import type { Database } from "@/db/schemas/relations.js";
import { apiKeys } from "@/db/schemas/index.js";
import type { IntegrationPrincipal } from "@/integrations/models/integration.js";
import { apiKeyNotFound, ControlPlaneError } from "./control-plane-error.js";
import type { CustomerApiKey } from "./customer-api-key.js";

const customerApiKeyColumns = {
  id: apiKeys.id,
  keyId: apiKeys.keyId,
  name: apiKeys.name,
  customerId: apiKeys.customerId,
  createdAt: apiKeys.createdAt,
  expiresAt: apiKeys.expiresAt,
  revokedAt: apiKeys.revokedAt,
  allowedModelIds: apiKeys.allowedModelIds,
  spendLimit: apiKeys.spendLimit,
  spent: apiKeys.spent,
  requestRate: apiKeys.requestRate,
};

/** The newest first order of an Integration's keys; the id breaks ties, for page tokens. */
const NEWEST_KEYS_FIRST = [desc(apiKeys.createdAt), desc(apiKeys.id)];

/** The Integration's API Keys, newest first, narrowed by `where`: never another Integration's or an operator's. */
export async function selectCustomerApiKeys(
  db: Database,
  integrationId: string,
  { where, limit }: { where?: SQL; limit?: number } = {},
): Promise<CustomerApiKey[]> {
  const query = db
    .select(customerApiKeyColumns)
    .from(apiKeys)
    .where(and(eq(apiKeys.integrationId, integrationId), where))
    .orderBy(...NEWEST_KEYS_FIRST);
  const rows = limit === undefined ? await query : await query.limit(limit);
  // Every key an Integration issues has a Customer id (enforced on create).
  return rows.map((row) => ({ ...row, customerId: row.customerId ?? "" }));
}

/**
 * One of the Integration's API Keys, revoked or not. NOT_FOUND for any other
 * id, another Integration's key or an operator's alike, so neither is revealed.
 */
export async function findCustomerApiKey(
  db: Database,
  integrationId: string,
  id: string,
): Promise<CustomerApiKey> {
  // Over gRPC the id is any string: one that is no uuid names no key.
  if (!z.uuid().safeParse(id).success) {
    throw apiKeyNotFound();
  }
  const [found] = await selectCustomerApiKeys(db, integrationId, { where: eq(apiKeys.id, id) });
  if (!found) {
    throw apiKeyNotFound();
  }
  return found;
}

/** As findCustomerApiKey, refusing a revoked key with FAILED_PRECONDITION and `revokedMessage`. */
export async function findUnrevokedCustomerApiKey(
  db: Database,
  integrationId: string,
  id: string,
  revokedMessage: string,
): Promise<CustomerApiKey> {
  const found = await findCustomerApiKey(db, integrationId, id);
  if (found.revokedAt !== null) {
    throw new ControlPlaneError("FAILED_PRECONDITION", revokedMessage);
  }
  return found;
}

/**
 * Refuses allowed Model ids outside the Integration's allowed Models (its
 * ceiling), or naming no Model. A ceiling that is empty allows every Model.
 */
export async function assertWithinCeiling(
  db: Database,
  integration: IntegrationPrincipal,
  modelIds: string[],
): Promise<void> {
  const ceiling = integration.allowedModelIds;
  const outside = modelIds.filter((id) => ceiling.length > 0 && !ceiling.includes(id));
  if (outside.length > 0) {
    throw new ControlPlaneError(
      "INVALID_ARGUMENT",
      `Not among the Integration's allowed Models: ${outside.join(", ")}`,
    );
  }
  await assertModelsExist(db, modelIds);
}
