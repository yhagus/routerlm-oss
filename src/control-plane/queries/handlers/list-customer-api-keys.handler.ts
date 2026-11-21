import { type IQueryHandler, QueryHandler } from "@nestjs/cqrs";
import { InjectDrizzle } from "@nestjs/drizzle";
import { and, eq, type SQL, sql } from "drizzle-orm";
import { z } from "zod";
import type { Database } from "@/db/schemas/relations.js";
import { apiKeys } from "@/db/schemas/index.js";
import { ControlPlaneError } from "../../models/control-plane-error.js";
import type { CustomerApiKeyPage } from "../../models/customer-api-key.js";
import { selectCustomerApiKeys } from "../../models/customer-api-keys.js";
import { ListCustomerApiKeysQuery } from "../impl/list-customer-api-keys.query.js";

@QueryHandler(ListCustomerApiKeysQuery)
export class ListCustomerApiKeysHandler implements IQueryHandler<ListCustomerApiKeysQuery> {
  constructor(@InjectDrizzle() private readonly db: Database) {}

  async execute({ integration, page }: ListCustomerApiKeysQuery): Promise<CustomerApiKeyPage> {
    // One more than the page, to tell whether another page follows.
    const keys = await selectCustomerApiKeys(this.db, integration.integrationId, {
      where: and(
        page.customerId === undefined ? undefined : eq(apiKeys.customerId, page.customerId),
        page.pageToken === undefined ? undefined : olderThan(lastKeyIdOf(page.pageToken)),
      ),
      limit: page.pageSize + 1,
    });
    const hasNextPage = keys.length > page.pageSize;
    const pageKeys = keys.slice(0, page.pageSize);
    return {
      keys: pageKeys,
      nextPageToken: hasNextPage ? pageTokenAfter(pageKeys[pageKeys.length - 1].id) : null,
    };
  }
}

// A page token is the last listed key's id, encoded so clients treat it as opaque.

function pageTokenAfter(lastKeyId: string): string {
  return Buffer.from(lastKeyId).toString("base64url");
}

function lastKeyIdOf(pageToken: string): string {
  const decoded = z.uuid().safeParse(Buffer.from(pageToken, "base64url").toString());
  if (!decoded.success) {
    throw new ControlPlaneError("INVALID_ARGUMENT", "Invalid pageToken");
  }
  return decoded.data;
}

/**
 * Keys after `lastKeyId` in the newest-first order. Compared in SQL against
 * that key's own row, since created_at holds microseconds a JS Date would round off.
 */
function olderThan(lastKeyId: string): SQL {
  return sql`(${apiKeys.createdAt}, ${apiKeys.id}) < (select created_at, id from api_keys where id = ${lastKeyId})`;
}
