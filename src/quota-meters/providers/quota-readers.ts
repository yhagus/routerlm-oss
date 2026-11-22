import { Injectable } from "@nestjs/common";
import type { QuotaReaderName } from "@/db/schemas/index.js";
import type { QuotaReader } from "@/quota-meters/models/quota-reader.js";
import { KimiCodeQuotaReader } from "./kimi-code-quota-reader.js";
import { MiniMaxMPlanQuotaReader } from "./minimax-m-plan-quota-reader.js";
import { OpenAiCodexQuotaReader } from "./openai-codex-quota-reader.js";

/** The quota reader a Provider names in `providers.quota_reader` (ADR 0010). */
@Injectable()
export class QuotaReaders {
  private readonly readers: Record<QuotaReaderName, QuotaReader>;

  constructor(
    miniMaxMPlan: MiniMaxMPlanQuotaReader,
    kimiCode: KimiCodeQuotaReader,
    openAiCodex: OpenAiCodexQuotaReader,
  ) {
    this.readers = {
      "minimax-m-plan": miniMaxMPlan,
      "kimi-code": kimiCode,
      "openai-codex": openAiCodex,
    };
  }

  readerFor(name: QuotaReaderName): QuotaReader {
    return this.readers[name];
  }
}
