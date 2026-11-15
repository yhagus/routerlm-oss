import { Query } from "@nestjs/cqrs";
import type { QuotaMeter } from "../../models/quota-meter.js";

export type { QuotaMeter };

/** The latest Quota Meters of each of the Provider Accounts, by account id, ordered by key; an account without any is absent. */
export class ListQuotaMetersQuery extends Query<Map<string, QuotaMeter[]>> {
  constructor(readonly providerAccountIds: string[]) {
    super();
  }
}
