import type { UsageJob } from '@/usage/models/usage-job';
import { ClientCancelledError } from './attempt-failure';
import { GatewayError } from './gateway-error';
import type { InferenceCaller } from './inference';
import type { PromptCacheKeyOwner } from './prompt-cache-key';
import type { UsageMeter } from './usage-meter';

const HTTP_INTERNAL_SERVER_ERROR = 500;
const CLIENT_CLOSED_REQUEST = 499;

const encoder = new TextEncoder();

export function requestOwnerOf(caller: InferenceCaller): PromptCacheKeyOwner {
  if (caller.kind !== 'api-key') {
    return { kind: 'playground', userId: caller.userId };
  }
  const { apiKeyId, apiKeyName, customer } = caller.principal;
  return {
    kind: 'api-key',
    apiKeyId,
    apiKeyName,
    ...(customer && {
      customer: {
        integrationId: customer.integrationId,
        integrationName: customer.integrationName,
        customerId: customer.customerId,
      },
    }),
  };
}

export function encodedFor(meter: UsageMeter, text: string): Uint8Array {
  const bytes = encoder.encode(text);
  meter.responseWritten(bytes.byteLength);
  return bytes;
}

export function failedRequestUsage(
  meter: UsageMeter,
  writeError: (error: GatewayError) => unknown,
  error: unknown,
): UsageJob {
  if (error instanceof GatewayError) {
    return meter.finishWithError(error, writeError(error));
  }
  if (error instanceof ClientCancelledError) {
    return meter.finish(CLIENT_CLOSED_REQUEST, true);
  }
  meter.failedInGateway();
  return meter.finish(HTTP_INTERNAL_SERVER_ERROR, false);
}
