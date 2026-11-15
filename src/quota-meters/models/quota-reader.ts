import { HttpClientError, HttpResponseError, HttpTimeoutError } from "@nestjs/http-client";
import type { QuotaMeterReading } from "./quota-meter.js";

/**
 * Reads the Quota Meters of one Provider Account from one quota endpoint
 * shape (ADR 0010). Throws QuotaReadError when the reading fails.
 */
export interface QuotaReader {
  /**
   * @param bearerCredential What the Provider Account authenticates with:
   *   its API key, or its OAuth Login's access token.
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

/**
 * The QuotaReadError for an HTTP failure of the quota endpoint of
 * `providerName`; any other error is a bug and is thrown as it is.
 */
export function asQuotaReadError(error: unknown, providerName: string): QuotaReadError {
  if (error instanceof HttpTimeoutError) {
    return new QuotaReadError(
      `The ${providerName} quota endpoint timed out after ${error.timeoutMs} ms`,
      { cause: error },
    );
  }
  if (error instanceof HttpResponseError) {
    return new QuotaReadError(`The ${providerName} quota endpoint answered HTTP ${error.status}`, {
      cause: error,
    });
  }
  if (error instanceof HttpClientError) {
    return new QuotaReadError(
      `The ${providerName} quota endpoint could not be reached: ${error.message}`,
      { cause: error },
    );
  }
  throw error;
}
