import { Hono } from "hono";
import type { Runtime } from "../runtime";
import { listAllJobs, removeJob } from "../services/platform/jobRegistry";
// Side-effect imports ensure each job registry registers itself into the hub.
import "../services/providers/grokCliProbe407";

export function queueJobRoutes(runtime: Runtime) {
  return new Hono()
    .use("*", runtime.auth.adminMiddleware())
    .get("/", (c) => {
      c.header("Cache-Control", "no-store");
      return c.json({ jobs: listAllJobs() });
    })
    .delete("/:jobId", (c) => {
      const jobId = c.req.param("jobId");
      const removed = removeJob(jobId);
      c.header("Cache-Control", "no-store");
      if (!removed) return c.json({ ok: false, error: "Job not found" }, 404);
      return c.json({ ok: true, jobId });
    })
    .delete("/", (c) => {
      const before = listAllJobs().length;
      for (const job of listAllJobs()) removeJob(job.jobId);
      c.header("Cache-Control", "no-store");
      return c.json({ ok: true, removed: before });
    });
}
