import { HttpClientError, HttpResponseError, HttpTimeoutError } from "@nestjs/http-client";
import { chatEndpointOf, providerQuirksSchema } from "@/catalog/schemas/catalog.schema.js";
import type { ProviderEndpoint } from "@/db/schemas/index.js";
import type { ProviderAccountCredential } from "@/upstream/models/provider-account-credential.js";
import type { QuotaMeterReading } from "./quota-meter.js";
import type { UsageResetPort } from "./usage-reset.js";

/**
 * Reads the Quota Meters of one Provider Account from one quota endpoint
 * shape (ADR 0010). Throws QuotaReadError when the reading fails.
 */
export interface QuotaReader {
  /**
   * @param credential What the Provider Account authenticates with: its API
   *   key, or its OAuth Login's access token and CLI identity headers. A
   *   reader sends the identity headers only when its endpoint wants them.
   */
  read(credential: ProviderAccountCredential, provider: QuotaReaderProvider): Promise<QuotaReading>;
  /** Present only when the Provider has Usage Resets; any other reader reports them unsupported. */
  readonly usageResets?: UsageResetPort;
}

/** What one quota reading reports. */
export interface QuotaReading {
  meters: QuotaMeterReading[];
  /**
   * How many Usage Resets the Provider says the account has; null when the
   * reading doesn't say. Only compared with the stored resets (ADR 0041).
   */
  usageResetCount: number | null;
}

/** What a reader may build its quota endpoint's URL from; each reader uses one of the two. */
export interface QuotaReaderProvider {
  /** The Provider's base URL, for a quota endpoint that lives beside inference. */
  baseUrl: string;
  /** The Provider's `quotaBaseUrl` quirk, for a quota endpoint that lives elsewhere. */
  quotaBaseUrl: string | undefined;
}

/**
 * What the quota reader and the Usage Resets of a Provider build their URLs
 * from. Throws QuotaReadError when the Provider has no chat endpoint, which
 * fails the call like a Provider that refuses it.
 */
export function quotaReaderProviderOf(provider: {
  endpoints: readonly ProviderEndpoint[];
  quirks: unknown;
}): QuotaReaderProvider {
  const chatEndpoint = chatEndpointOf(provider.endpoints);
  if (chatEndpoint === undefined) {
    throw new QuotaReadError("The Provider has no chat endpoint to reach its quota endpoints from");
  }
  const { quotaBaseUrl } = providerQuirksSchema.parse(provider.quirks);
  return { baseUrl: chatEndpoint.baseUrl, quotaBaseUrl };
}

/** A reading that failed: the Provider refused it, timed out or answered something unreadable. */
export class QuotaReadError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = QuotaReadError.name;
  }
}

/**
 * The QuotaReadError for an HTTP failure of `endpointName`, such as
 * "OpenAI quota"; any other error is a bug and is thrown as it is.
 */
export function asQuotaReadError(error: unknown, endpointName: string): QuotaReadError {
  if (error instanceof HttpTimeoutError) {
    return new QuotaReadError(
      `The ${endpointName} endpoint timed out after ${error.timeoutMs} ms`,
      { cause: error },
    );
  }
  if (error instanceof HttpResponseError) {
    return new QuotaReadError(`The ${endpointName} endpoint answered HTTP ${error.status}`, {
      cause: error,
    });
  }
  if (error instanceof HttpClientError) {
    return new QuotaReadError(
      `The ${endpointName} endpoint could not be reached: ${error.message}`,
      { cause: error },
    );
  }
  throw error;
}
