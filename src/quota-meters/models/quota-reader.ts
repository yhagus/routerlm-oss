import { HttpClientError, HttpResponseError, HttpTimeoutError } from '@nestjs/http-client';
import { chatEndpointOf, providerQuirksSchema } from '@/catalog/schemas/catalog.schema';
import type { ProviderEndpoint } from '@/db/schemas';
import type { ProviderAccountCredential } from '@/upstream/models/provider-account-credential';
import type { QuotaMeterReading } from './quota-meter';
import type { UsageResetPort } from './usage-reset';

export interface QuotaReader {
  read(credential: ProviderAccountCredential, provider: QuotaReaderProvider): Promise<QuotaReading>;
  readonly usageResets?: UsageResetPort;
}

export interface QuotaReading {
  meters: QuotaMeterReading[];
  usageResetCount: number | null;
}

export interface QuotaReaderProvider {
  baseUrl: string;
  quotaBaseUrl: string | undefined;
}

export function quotaReaderProviderOf(provider: {
  endpoints: readonly ProviderEndpoint[];
  quirks: unknown;
}): QuotaReaderProvider {
  const chatEndpoint = chatEndpointOf(provider.endpoints);
  if (chatEndpoint === undefined) {
    throw new QuotaReadError('The Provider has no chat endpoint to reach its quota endpoints from');
  }
  const { quotaBaseUrl } = providerQuirksSchema.parse(provider.quirks);
  return { baseUrl: chatEndpoint.baseUrl, quotaBaseUrl };
}

export class QuotaReadError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = QuotaReadError.name;
  }
}

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
