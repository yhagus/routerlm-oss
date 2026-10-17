import { afterEach, describe, expect, test } from "bun:test";
import { installFetchMock } from "./fetchHarness";
import { fetchDailyCheckin, type CheckinFetcher } from "../src/services/providers/codebuddyCheckin";

afterEach(() => {
  installFetchMock(null);
});

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

describe("fetchDailyCheckin", () => {
  test("claims credit when today_checked_in is false", async () => {
    const calls: { status: number; claim: number } = { status: 0, claim: 0 };
    const fetcher: CheckinFetcher = async (input, init) => {
      const url = String(input);
      if (url.includes("checkin-activity-status") && init?.method === "POST") {
        calls.status += 1;
        return jsonResponse({ code: 0, data: { today_checked_in: false, active: true, streak_days: 3 } });
      }
      if (url.includes("daily-checkin") && init?.method === "POST") {
        calls.claim += 1;
        return jsonResponse({ code: 0, data: { credit: 50, streak_days: 4 } });
      }
      return new Response("not found", { status: 404 });
    };

    const result = await fetchDailyCheckin({ token: "test-token", fetcher });
    expect(result.state).toBe("claimed");
    expect(result.credit).toBe(50);
    expect(result.streakDays).toBe(4);
    expect(result.error).toBeNull();
    expect(calls.status).toBe(1);
    expect(calls.claim).toBe(1);
  });

  test("returns already_claimed when status says today_checked_in is true", async () => {
    const calls: { status: number; claim: number } = { status: 0, claim: 0 };
    const fetcher: CheckinFetcher = async (input, init) => {
      const url = String(input);
      if (url.includes("checkin-activity-status") && init?.method === "POST") {
        calls.status += 1;
        return jsonResponse({ code: 0, data: { today_checked_in: true, active: true, streak_days: 7 } });
      }
      if (url.includes("daily-checkin")) {
        calls.claim += 1;
      }
      return new Response("not found", { status: 404 });
    };

    const result = await fetchDailyCheckin({ token: "test-token", fetcher });
    expect(result.state).toBe("already_claimed");
    expect(result.streakDays).toBe(7);
    expect(calls.status).toBe(1);
    expect(calls.claim).toBe(0);
  });

  test("returns already_claimed on business code 1001 from claim endpoint", async () => {
    const fetcher: CheckinFetcher = async (input, init) => {
      const url = String(input);
      if (url.includes("checkin-activity-status") && init?.method === "POST") {
        return jsonResponse({ code: 0, data: { today_checked_in: false, active: true, streak_days: 2 } });
      }
      if (url.includes("daily-checkin") && init?.method === "POST") {
        return jsonResponse({ code: 1001, msg: "already checked in today" });
      }
      return new Response("not found", { status: 404 });
    };

    const result = await fetchDailyCheckin({ token: "test-token", fetcher });
    expect(result.state).toBe("already_claimed");
    expect(result.streakDays).toBe(2);
  });

  test("returns not_eligible on business code 1002", async () => {
    const fetcher: CheckinFetcher = async (input, init) => {
      const url = String(input);
      if (url.includes("checkin-activity-status") && init?.method === "POST") {
        return jsonResponse({ code: 0, data: { today_checked_in: false, active: true } });
      }
      if (url.includes("daily-checkin") && init?.method === "POST") {
        return jsonResponse({ code: 1002 });
      }
      return new Response("not found", { status: 404 });
    };

    const result = await fetchDailyCheckin({ token: "test-token", fetcher });
    expect(result.state).toBe("not_eligible");
  });

  test("returns event_ended on business code 1003", async () => {
    const fetcher: CheckinFetcher = async (input, init) => {
      const url = String(input);
      if (url.includes("checkin-activity-status") && init?.method === "POST") {
        return jsonResponse({ code: 0, data: { today_checked_in: false, active: true } });
      }
      if (url.includes("daily-checkin") && init?.method === "POST") {
        return jsonResponse({ code: 1003 });
      }
      return new Response("not found", { status: 404 });
    };

    const result = await fetchDailyCheckin({ token: "test-token", fetcher });
    expect(result.state).toBe("event_ended");
  });

  test("returns unavailable when active is false", async () => {
    const fetcher: CheckinFetcher = async (input, init) => {
      const url = String(input);
      if (url.includes("checkin-activity-status") && init?.method === "POST") {
        return jsonResponse({ code: 0, data: { active: false } });
      }
      return new Response("not found", { status: 404 });
    };

    const result = await fetchDailyCheckin({ token: "test-token", fetcher });
    expect(result.state).toBe("unavailable");
  });

  test("returns error on 401 from status endpoint", async () => {
    const fetcher: CheckinFetcher = async () => new Response("unauthorized", { status: 401 });

    const result = await fetchDailyCheckin({ token: "test-token", fetcher });
    expect(result.state).toBe("error");
    expect(result.error).toContain("Credential invalid or expired");
  });

  test("returns error when status endpoint returns non-zero code", async () => {
    const fetcher: CheckinFetcher = async (input, init) => {
      const url = String(input);
      if (url.includes("checkin-activity-status") && init?.method === "POST") {
        return jsonResponse({ code: 500, msg: "server error" });
      }
      return new Response("not found", { status: 404 });
    };

    const result = await fetchDailyCheckin({ token: "test-token", fetcher });
    expect(result.state).toBe("error");
    expect(result.error).toContain("code 500");
  });

  test("returns error when token is empty", async () => {
    const result = await fetchDailyCheckin({ token: "" });
    expect(result.state).toBe("error");
    expect(result.error).toContain("no stored credential");
  });

  test("retries on 5xx from claim endpoint then succeeds", async () => {
    let claimAttempts = 0;
    const fetcher: CheckinFetcher = async (input, init) => {
      const url = String(input);
      if (url.includes("checkin-activity-status") && init?.method === "POST") {
        return jsonResponse({ code: 0, data: { today_checked_in: false, active: true, streak_days: 1 } });
      }
      if (url.includes("daily-checkin") && init?.method === "POST") {
        claimAttempts += 1;
        if (claimAttempts < 3) return new Response("server error", { status: 503 });
        return jsonResponse({ code: 0, data: { credit: 30, streak_days: 2 } });
      }
      return new Response("not found", { status: 404 });
    };

    const result = await fetchDailyCheckin({ token: "test-token", fetcher });
    expect(result.state).toBe("claimed");
    expect(result.credit).toBe(30);
    expect(claimAttempts).toBe(3);
  });

  test("handles Tencent double-wrapped envelope data.Response.Data", async () => {
    const fetcher: CheckinFetcher = async (input, init) => {
      const url = String(input);
      if (url.includes("checkin-activity-status") && init?.method === "POST") {
        return jsonResponse({
          code: 0,
          data: { Response: { Data: { today_checked_in: false, active: true, streak_days: 5 } } },
        });
      }
      if (url.includes("daily-checkin") && init?.method === "POST") {
        return jsonResponse({
          code: 0,
          data: { Response: { Data: { credit: 100, streak_days: 6 } } },
        });
      }
      return new Response("not found", { status: 404 });
    };

    const result = await fetchDailyCheckin({ token: "test-token", fetcher });
    expect(result.state).toBe("claimed");
    expect(result.credit).toBe(100);
    expect(result.streakDays).toBe(6);
  });

  test("detects already-claimed via prose message with success envelope", async () => {
    const fetcher: CheckinFetcher = async (input, init) => {
      const url = String(input);
      if (url.includes("checkin-activity-status") && init?.method === "POST") {
        return jsonResponse({ code: 0, data: { today_checked_in: false, active: true, streak_days: 9 } });
      }
      if (url.includes("daily-checkin") && init?.method === "POST") {
        return jsonResponse({ code: 0, msg: "已签到" });
      }
      return new Response("not found", { status: 404 });
    };

    const result = await fetchDailyCheckin({ token: "test-token", fetcher });
    expect(result.state).toBe("already_claimed");
    expect(result.streakDays).toBe(9);
  });

  test("routes through proxyAwareFetch when proxyOptions is provided", async () => {
    // When proxyOptions is provided, fetchDailyCheckin uses proxyAwareFetch
    // instead of the injected fetcher. proxyAwareFetch falls through to
    // originalFetch (the test harness) when no proxy URL resolves. So the
    // injected fetcher should NOT be called; the mock should be called via
    // the harness.
    const fetcher: CheckinFetcher = async () => {
      throw new Error("fetcher should not be called when proxyOptions is set");
    };
    installFetchMock(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("checkin-activity-status") && init?.method === "POST") {
        return jsonResponse({ code: 0, data: { today_checked_in: true, active: true, streak_days: 5 } });
      }
      return new Response("not found", { status: 404 });
    });

    const result = await fetchDailyCheckin({ token: "test-token", fetcher, proxyOptions: {} });
    expect(result.state).toBe("already_claimed");
    expect(result.streakDays).toBe(5);
  });
});
