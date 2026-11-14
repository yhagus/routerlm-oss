import type { NestNodeApplication } from "@nestjs/platform-node";

/** Spec "Fallback": the request body limit. Inline images make inference bodies large. */
export const REQUEST_BODY_LIMIT = "20mb";

/** App-wide setup that main.ts and the e2e tests' app share. Call before `init()`/`listen()`. */
export function configureApp(app: NestNodeApplication): void {
  app.useBodyParser("json", { limit: REQUEST_BODY_LIMIT });
}
