import { describe, expect, test } from "vitest";
import {
  connectionGroup,
  resolveModelProvider,
  withConnectionGroup,
} from "./routing";
import type { ProviderConnection } from "@/types/api";

const connection: ProviderConnection = {
  id: "account-1",
  provider: "openai",
  authType: "api-key",
  name: "Account",
  email: null,
  priority: 1,
  isActive: true,
  apiType: null,
  baseUrl: null,
  credentials: {},
  data: { group: "Team A" },
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

describe("withConnectionGroup", () => {
  test("clears a group with an explicit value for merged provider updates", () => {
    const data = withConnectionGroup(connection, "");

    expect(data).toMatchObject({ group: null });
    expect(connectionGroup({ ...connection, data })).toBe("");
  });
});

describe("resolveModelProvider", () => {
  test("resolves provider aliases before Combo account filtering", () => {
    expect(resolveModelProvider("cc/claude-sonnet", [], {}).providerId).toBe(
      "claude",
    );
  });
});
