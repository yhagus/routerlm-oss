import { Hono } from "hono";
import type { Runtime } from "../runtime";
import { getSchedulerStates, setSchedulerEnabled } from "../services/schedulerHistory";
import { configureQuotaAutoPing, stopQuotaAutoPing, startQuotaAutoPing } from "../services/billing/quotaAutoPing";
import { configureAutoclawTasks, stopAutoclawTasks, startAutoclawTasks } from "../services/billing/autoclawTasksScheduler";
import { configureCodebuddyProbe, stopCodebuddyProbe, startCodebuddyProbe } from "../services/providers/codebuddyProbeScheduler";
import { startTokenRefreshScheduler, stopTokenRefreshScheduler } from "../services/billing/tokenRefreshScheduler";

const SCHEDULER_ACTIONS: Record<string, {
  start: (runtime: Runtime) => void;
  stop: () => void;
  configure: (runtime: Runtime, settings: Record<string, unknown>) => void;
}> = {
  tokenRefresh: {
    start: (runtime) => startTokenRefreshScheduler(runtime),
    stop: () => stopTokenRefreshScheduler(),
    configure: (runtime) => startTokenRefreshScheduler(runtime),
  },
  quotaAutoPing: {
    start: (runtime) => startQuotaAutoPing(runtime),
    stop: () => stopQuotaAutoPing(),
    configure: (runtime, settings) => configureQuotaAutoPing(runtime, settings),
  },
  autoclawTasks: {
    start: (runtime) => startAutoclawTasks(runtime),
    stop: () => stopAutoclawTasks(),
    configure: (runtime, settings) => configureAutoclawTasks(runtime, settings),
  },
  codebuddyProbe: {
    start: (runtime) => startCodebuddyProbe(runtime),
    stop: () => stopCodebuddyProbe(),
    configure: (runtime, settings) => configureCodebuddyProbe(runtime, settings),
  },
};

export function schedulerRoutes(runtime: Runtime) {
  return new Hono()
    .use("*", runtime.auth.adminMiddleware())
    .get("/", (c) => {
      return c.json({ schedulers: getSchedulerStates() });
    })
    .post("/:id/toggle", async (c) => {
      const id = c.req.param("id");
      const body = await c.req.json<{ enabled: boolean }>().catch(() => null);
      if (body?.enabled === undefined) return c.json({ error: "enabled is required" }, 400);
      const updated = setSchedulerEnabled(id, body.enabled);
      if (!updated) return c.json({ error: "Scheduler not found" }, 404);
      const action = SCHEDULER_ACTIONS[id];
      if (!action) return c.json({ error: "Unknown scheduler" }, 404);
      try {
        if (body.enabled) {
          const settings = runtime.repos.settings.get() as Record<string, unknown>;
          action.configure(runtime, settings);
        } else {
          action.stop();
        }
        return c.json({ success: true, enabled: body.enabled });
      } catch (error) {
        return c.json({ error: error instanceof Error ? error.message : "Failed to toggle scheduler" }, 500);
      }
    });
}
