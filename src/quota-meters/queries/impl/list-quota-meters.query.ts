import { Query } from "@nestjs/cqrs";
import type { QuotaMeter } from "@/quota-meters/models/quota-meter";

export type { QuotaMeter };

export class ListQuotaMetersQuery extends Query<Map<string, QuotaMeter[]>> {
  constructor(readonly providerAccountIds: string[]) {
    super();
  }
}
