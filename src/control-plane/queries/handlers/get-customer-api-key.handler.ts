import { type IQueryHandler, QueryHandler } from "@nestjs/cqrs";
import { InjectDrizzle } from "@nestjs/drizzle";
import type { Database } from "@/db/schemas/relations.js";
import type { CustomerApiKey } from "../../models/customer-api-key.js";
import { findCustomerApiKey } from "../../models/customer-api-keys.js";
import { GetCustomerApiKeyQuery } from "../impl/get-customer-api-key.query.js";

@QueryHandler(GetCustomerApiKeyQuery)
export class GetCustomerApiKeyHandler implements IQueryHandler<GetCustomerApiKeyQuery> {
  constructor(@InjectDrizzle() private readonly db: Database) {}

  execute({ integration, id }: GetCustomerApiKeyQuery): Promise<CustomerApiKey> {
    return findCustomerApiKey(this.db, integration.integrationId, id);
  }
}
