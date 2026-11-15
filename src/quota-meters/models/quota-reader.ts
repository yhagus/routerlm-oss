import type { QuotaMeterReading } from "./quota-meter.js";

/**
 * Reads the Quota Meters of one Provider Account from one quota endpoint
 * shape (ADR 0010). Throws QuotaReadError when the reading fails.
 */
export interface QuotaReader {
  /**
   * @param bearerCredential What the Provider Account authenticates with:
   *   its API key.
   */
  read(bearerCredential: string, provider: QuotaReaderProvider): Promise<QuotaMeterReading[]>;
}

/** What a reader may build its quota endpoint's URL from; each reader uses one of the two. */
export interface QuotaReaderProvider {
  /** The Provider's base URL, for a quota endpoint that lives beside inference. */
  baseUrl: string;
  /** The Provider's `quotaBaseUrl` quirk, for a quota endpoint that lives elsewhere. */
  quotaBaseUrl: string | undefined;
}

/** A reading that failed: the Provider refused it, timed out or answered something unreadable. */
export class QuotaReadError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = QuotaReadError.name;
  }
}
