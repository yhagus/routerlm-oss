import { describe, expect, test } from "bun:test";
import { loadConfig } from "../src/config";

describe("loadConfig", () => {
  test("uses local backend defaults", () => {
    expect(loadConfig({})).toEqual({
      host: "127.0.0.1",
      port: 20129,
    });
  });

  test("accepts loopback overrides", () => {
    expect(loadConfig({ BACKEND_HOST: "::1", BACKEND_PORT: "30129" })).toEqual({
      host: "::1",
      port: 30129,
    });
  });

  test("accepts the container listener", () => {
    expect(loadConfig({ BACKEND_HOST: "0.0.0.0" })).toEqual({
      host: "0.0.0.0",
      port: 20129,
    });
  });

  test("rejects unsupported listeners", () => {
    expect(() => loadConfig({ BACKEND_HOST: "192.168.1.10" })).toThrow(
      "BACKEND_HOST must be localhost or 0.0.0.0",
    );
  });

  test("rejects invalid ports", () => {
    expect(() => loadConfig({ BACKEND_PORT: "70000" })).toThrow(
      "BACKEND_PORT must be an integer from 1 to 65535",
    );
  });
});
