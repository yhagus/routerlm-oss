import { HttpClientError, HttpResponseError, HttpTimeoutError } from '@nestjs/http-client';
import type { ProviderEndpoint } from '@/db/schemas';
import type { ProviderAccountCredential } from '@/upstream/models/provider-account-credential';

export interface PlanReader {
  readPlan(
    credential: ProviderAccountCredential,
    endpoints: readonly ProviderEndpoint[],
  ): Promise<string | null>;
  readCoverage(
    credential: ProviderAccountCredential,
    endpoints: readonly ProviderEndpoint[],
  ): Promise<ListedPlanCoverage[]>;
}

export interface ListedPlanCoverage {
  upstreamModelId: string;
  planCoverage: string[] | null;
}

export class PlanReadError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = PlanReadError.name;
  }
}

export function asPlanReadError(error: unknown, endpointName: string): PlanReadError {
  if (error instanceof HttpTimeoutError) {
    return new PlanReadError(`The ${endpointName} endpoint timed out after ${error.timeoutMs} ms`, {
      cause: error,
    });
  }
  if (error instanceof HttpResponseError) {
    return new PlanReadError(`The ${endpointName} endpoint answered HTTP ${error.status}`, {
      cause: error,
    });
  }
  if (error instanceof HttpClientError) {
    return new PlanReadError(
      `The ${endpointName} endpoint could not be reached: ${error.message}`,
      {
        cause: error,
      },
    );
  }
  throw error;
}
