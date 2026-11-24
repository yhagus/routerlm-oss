import { and, desc, eq, type SQL } from "drizzle-orm";
import { z } from "zod";
import { assertModelsExist } from "@/libs/models/allowed-models.js";
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

const NEWEST_KEYS_FIRST = [desc(apiKeys.createdAt), desc(apiKeys.id)];

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
  return rows.map((row) => ({ ...row, customerId: row.customerId ?? "" }));
}

export async function findCustomerApiKey(
  db: Database,
  integrationId: string,
  id: string,
): Promise<CustomerApiKey> {
  if (!z.uuid().safeParse(id).success) {
    throw apiKeyNotFound();
  }
  const [found] = await selectCustomerApiKeys(db, integrationId, { where: eq(apiKeys.id, id) });
  if (!found) {
    throw apiKeyNotFound();
  }
  return found;
}

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
