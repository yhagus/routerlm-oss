import { Injectable } from "@nestjs/common";
import type { QuotaReaderName } from "@/db/schemas/index.js";
import type { QuotaReader } from "../models/quota-reader.js";
import { MiniMaxMPlanQuotaReader } from "./minimax-m-plan-quota-reader.js";

/** The quota reader a Provider names in `providers.quota_reader` (ADR 0010). */
@Injectable()
export class QuotaReaders {
  private readonly readers: Record<QuotaReaderName, QuotaReader>;

  constructor(miniMaxMPlan: MiniMaxMPlanQuotaReader) {
    this.readers = { "minimax-m-plan": miniMaxMPlan };
  }

  readerFor(name: QuotaReaderName): QuotaReader {
    return this.readers[name];
  }
}
