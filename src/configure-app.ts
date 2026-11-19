import {
  type NestNodeApplication,
  NodeAdapter,
  type NodeAdapterOptions,
} from "@nestjs/platform-node";

/** Spec "Fallback": the request body limit. Inline images make inference bodies large. */
export const REQUEST_BODY_LIMIT = "20mb";

/** App-wide setup that main.ts and the e2e tests' app share. Call before `init()`/`listen()`. */
export function configureApp(app: NestNodeApplication): void {
  app.useBodyParser("json", { limit: REQUEST_BODY_LIMIT });
}

/** The HTTP adapter, which reads `TRUST_PROXY` to decide whose `X-Forwarded-For` it believes. */
/**
 * The longest route parameter matched. A video id is a sealed handle of a few
 * hundred characters (ADR 0027), well over the adapter's default of 100.
 */
const MAX_PARAM_LENGTH = 1024;

export function createNodeAdapter(): NodeAdapter {
  return new NodeAdapter({
    trustProxy: trustProxyOf(process.env.TRUST_PROXY),
    maxParamLength: MAX_PARAM_LENGTH,
  });
}

function trustProxyOf(setting: string | undefined): NodeAdapterOptions["trustProxy"] {
  if (!setting || setting === "false") return false;
  if (setting === "true") return true;
  return setting;
}
