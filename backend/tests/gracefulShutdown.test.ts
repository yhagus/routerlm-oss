import { afterEach, describe, expect, test } from "bun:test";
import { createApp } from "../src/app";
import { loadRuntimeConfig } from "../src/config";
import { createRuntime } from "../src/runtime";
import { setShutdownHandler } from "../src/services/platform/shutdown";

async function runtime() {
  return createRuntime(loadRuntimeConfig({
    BACKEND_HOST: "127.0.0.1",
    BACKEND_DATABASE_PATH: ":memory:",
    DATA_DIR: `/tmp/lobakai-v2-shutdown-${crypto.randomUUID()}`,
    REQUIRE_LOGIN: "false",
  }));
}

const realExit = process.exit;
afterEach(() => {
  process.exit = realExit;
  setShutdownHandler(null);
  delete process.env.SHUTDOWN_SECRET;
});

describe("shutdown route", () => {
  test("runs the graceful shutdown that the entry point registered, not a bare process exit", async () => {
    const instance = await runtime();
    try {
      const exits: Array<number | undefined> = [];
      process.exit = ((code?: number) => { exits.push(code); }) as typeof process.exit;
      const reasons: string[] = [];
      let shutdownRan!: () => void;
      const ran = new Promise<void>((resolve) => { shutdownRan = resolve; });
      setShutdownHandler((reason) => { reasons.push(reason); shutdownRan(); });
      process.env.SHUTDOWN_SECRET = "s3cret";

      const token = await instance.auth.createSession();
      const response = await createApp(instance).request("/api/shutdown", {
        method: "POST",
        headers: { cookie: `auth_token=${token}`, authorization: "Bearer s3cret" },
      });
      expect(response.status).toBe(200);

      await Promise.race([ran, new Promise((resolve) => setTimeout(resolve, 1_500))]);
      expect(reasons).toHaveLength(1);
      expect(exits).toEqual([]);
    } finally {
      instance.close();
    }
  });
});
