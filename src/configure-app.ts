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
export function createNodeAdapter(): NodeAdapter {
  return new NodeAdapter({ trustProxy: trustProxyOf(process.env.TRUST_PROXY) });
}

function trustProxyOf(setting: string | undefined): NodeAdapterOptions["trustProxy"] {
  if (!setting || setting === "false") return false;
  if (setting === "true") return true;
  return setting;
}
