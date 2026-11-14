import { Authenticate } from "@nestjs/authentication";
import { applyDecorators, Controller } from "@nestjs/common";
import { SessionAuth } from "./session-auth.js";

/** Where the dashboard API lives; the web app's server forwards `/api/**` here. */
export const DASHBOARD_API_PREFIX = "api";

/**
 * A controller of the dashboard API, at `/api/<path>`. Every route needs a
 * signed-in User's session cookie, and only that: an API Key can never call
 * it. Mark a route `@Public()` to let anyone in.
 */
export function DashboardController(path: string): ClassDecorator {
  return applyDecorators(
    Controller(`${DASHBOARD_API_PREFIX}/${path}`),
    Authenticate({ providers: [SessionAuth] }),
  );
}
