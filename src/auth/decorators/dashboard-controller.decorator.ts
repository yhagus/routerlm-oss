import { Authenticate } from "@nestjs/authentication";
import { applyDecorators, Controller } from "@nestjs/common";
import { SessionAuth } from "@/auth/providers/session-auth.js";

export const DASHBOARD_API_PREFIX = "api";

export function DashboardController(path: string): ClassDecorator {
  return applyDecorators(
    Controller(`${DASHBOARD_API_PREFIX}/${path}`),
    Authenticate({ providers: [SessionAuth] }),
  );
}
