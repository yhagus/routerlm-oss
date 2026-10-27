import { afterEach, describe, expect, test } from "bun:test";
import { loadRuntimeConfig } from "../src/config";
import { createRuntime } from "../src/runtime";
import { installFetchMock } from "./fetchHarness";
import { clearAccountError, clearConnectionLocks, markAccountUnavailable, selectChatConnection } from "../src/services/chat/credentials";
import { getV2Executor } from "../src/services/chat/executors";
import { parseUpstreamError } from "../src/services/common/error";
import { CODEBUDDY_RESTRICTED_MARKER, isCodebuddyAccountRestricted } from "../src/services/providers/codebuddyRestricted";
import { codebuddyProbeDayKey, runCodebuddyProbeForConnection } from "../src/services/providers/codebuddyProbeScheduler";

const RESTRICTED_BODY = JSON.stringify({
  code: 11140,
  msg: "request illegal",
  requestId: "4ebf3c8039214734a16a75338e52cb1f",
  displayMsg: { en: "Your account has been restricted due to unusual activity" },
  actions: ["EDIT_INPUT", "SUBMIT_FEEDBACK"],
});
const RESTRICTED_MESSAGE = "CodeBuddy CLI account restricted by provider; appeal required";

async function runtime() {
  return createRuntime(loadRuntimeConfig({
    BACKEND_HOST: "127.0.0.1",
    BACKEND_DATABASE_PATH: ":memory:",
    DATA_DIR: `/tmp/lobakai-v2-codebuddy-restricted-${crypto.randomUUID()}`,
    REQUIRE_LOGIN: "false",
  }));
}

function codebuddyConnection(instance: Awaited<ReturnType<typeof runtime>>, name: string, data: Record<string, unknown> = {}) {
  return instance.repos.providers.create({
    provider: "codebuddy-intl-cli",
    authType: "oauth",
    name,
    credentials: {},
    data: { accessToken: `at-${name}`, refreshToken: `rt-${name}`, codebuddyUserId: `uid-${name}`, ...data },
  });
}

async function markRestricted(instance: Awaited<ReturnType<typeof runtime>>, connection: ReturnType<typeof codebuddyConnection>) {
  return markAccountUnavailable(instance, connection, 403, RESTRICTED_MESSAGE, "codebuddy-intl-cli", "claude-sonnet-4.5", null, false, "11140");
}

afterEach(() => {
  installFetchMock(null);
});

describe("codebuddy-intl-cli account restriction (11140)", () => {
  test("parseError maps 11140 to a 403 restriction without disabling the account", async () => {
    const response = new Response(RESTRICTED_BODY, { status: 403, headers: { "content-type": "application/json" } });
    const parsed = await parseUpstreamError(response, getV2Executor("codebuddy-intl-cli")) as Record<string, unknown>;
    expect(parsed).toMatchObject({ statusCode: 403, message: RESTRICTED_MESSAGE, code: "11140", disableAccount: false });
  });

  test("isCodebuddyAccountRestricted requires the provider and the exact code", () => {
    expect(isCodebuddyAccountRestricted("codebuddy-intl-cli", "11140")).toBe(true);
    expect(isCodebuddyAccountRestricted("codebuddy-intl-cli", "12153")).toBe(false);
    expect(isCodebuddyAccountRestricted("qoder", "11140")).toBe(false);
  });

  test("a restricted account stays active but chat selection skips it for every model", async () => {
    const instance = await runtime();
    try {
      const restricted = codebuddyConnection(instance, "one");
      const healthy = codebuddyConnection(instance, "two");
      expect(await markRestricted(instance, restricted)).toBe(true);

      const stored = instance.repos.providers.get(restricted.id)!;
      expect(stored.isActive).toBe(true);
      expect(stored.data[CODEBUDDY_RESTRICTED_MARKER]).toBeTruthy();

      // Even after the timed lock expires, the marker keeps it out of rotation.
      instance.repos.providers.patch(restricted.id, { data: { modelLock___all: null } });
      for (const model of ["claude-sonnet-4.5", "gpt-5"]) {
        expect(selectChatConnection(instance, "codebuddy-intl-cli", { model }).selected?.connection.id).toBe(healthy.id);
      }
    } finally {
      instance.close();
    }
  });

  test("manual cooldown reset and a successful request both clear the marker", async () => {
    const instance = await runtime();
    try {
      const reset = codebuddyConnection(instance, "one");
      await markRestricted(instance, reset);
      clearConnectionLocks(instance, reset.id);
      expect(instance.repos.providers.get(reset.id)!.data[CODEBUDDY_RESTRICTED_MARKER]).toBeFalsy();

      const succeeded = codebuddyConnection(instance, "two");
      await markRestricted(instance, succeeded);
      clearAccountError(instance, succeeded, "claude-sonnet-4.5");
      expect(instance.repos.providers.get(succeeded.id)!.data[CODEBUDDY_RESTRICTED_MARKER]).toBeFalsy();
    } finally {
      instance.close();
    }
  });

  test("the daily probe refreshes a restricted account's token and skips check-in and report", async () => {
    const instance = await runtime();
    try {
      const connection = codebuddyConnection(instance, "one", { expiresAt: new Date(Date.now() - 60_000).toISOString() });
      await markRestricted(instance, connection);

      const calls: string[] = [];
      installFetchMock(async (input: RequestInfo | URL) => {
        const url = String(input);
        calls.push(url);
        if (url.includes("/auth/token/refresh")) {
          return new Response(JSON.stringify({ code: 0, data: { accessToken: "at-fresh", refreshToken: "rt-fresh", expiresIn: 3600 } }), { status: 200, headers: { "content-type": "application/json" } });
        }
        return new Response("{}", { status: 200 });
      });

      const run = await runCodebuddyProbeForConnection(instance, connection.id);
      expect(run).toMatchObject({ ok: false, reported: false, checkin: null });
      expect(run.error).toContain("restricted");

      expect(calls.filter((url) => url.includes("/auth/token/refresh"))).toHaveLength(1);
      expect(calls.some((url) => url.includes("/v2/report") || url.includes("checkin"))).toBe(false);
      expect(instance.repos.providers.get(connection.id)!.data.accessToken).toBe("at-fresh");
      expect(instance.repos.autoclawTasks.get(connection.id, "daily_probe", codebuddyProbeDayKey())).toBeNull();
    } finally {
      instance.close();
    }
  });
});
