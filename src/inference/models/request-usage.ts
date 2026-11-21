import type { UsageJob } from "@/usage/models/usage-job.js";
import { ClientCancelledError } from "./attempt-failure.js";
import { GatewayError } from "./gateway-error.js";
import type { InferenceCaller } from "./inference.js";
import type { PromptCacheKeyOwner } from "./prompt-cache-key.js";
import type { UsageMeter } from "./usage-meter.js";

// What every inference request, of any Kind, records about itself.

const HTTP_INTERNAL_SERVER_ERROR = 500;
/** Recorded when the client left before any response; nginx's "client closed request". */
const CLIENT_CLOSED_REQUEST = 499;

const encoder = new TextEncoder();

/** The API Key or User a request is made for, as its Usage Log and prompt cache key name it. */
export function requestOwnerOf(caller: InferenceCaller): PromptCacheKeyOwner {
  if (caller.kind !== "api-key") {
    return { kind: "playground", userId: caller.userId };
  }
  const { apiKeyId, apiKeyName, customer } = caller.principal;
  return {
    kind: "api-key",
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

/** `text` encoded once, counted as sent: the client gets exactly these bytes. */
export function encodedFor(meter: UsageMeter, text: string): Uint8Array {
  const bytes = encoder.encode(text);
  meter.responseWritten(bytes.byteLength);
  return bytes;
}

/**
 * The usage job of a request that ended in an exception instead of a
 * response; `writeError` is the client endpoint's error envelope.
 */
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
  // A bug: Nest answers 500.
  meter.failedInGateway();
  return meter.finish(HTTP_INTERNAL_SERVER_ERROR, false);
}
