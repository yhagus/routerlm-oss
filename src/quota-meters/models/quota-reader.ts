import type { QuotaMeterReading } from "./quota-meter.js";

/**
 * Reads the Quota Meters of one Provider Account from one quota endpoint
 * shape (ADR 0010). Throws QuotaReadError when the reading fails.
 */
export interface QuotaReader {
  /** @param quotaBaseUrl The Provider's `quotaBaseUrl` quirk. */
  read(providerAccountKey: string, quotaBaseUrl: string): Promise<QuotaMeterReading[]>;
}

/** A reading that failed: the Provider refused it, timed out or answered something unreadable. */
export class QuotaReadError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = QuotaReadError.name;
  }
}
