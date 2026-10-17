import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { defaultDataDir } from "../src/services/platform/dataDir.ts";

const originalHome = process.env.HOME;
afterEach(() => { process.env.HOME = originalHome; });

describe.skipIf(process.platform === "win32")("default data dir", () => {
  test("prefers ~/.lobakai, falls back to an existing legacy folder, else starts in ~/.lobakai", () => {
    const home = mkdtempSync(join(tmpdir(), "lobakai-home-"));
    process.env.HOME = home;
    expect(defaultDataDir()).toBe(join(home, ".lobakai"));

    mkdirSync(join(home, ".9router"));
    expect(defaultDataDir()).toBe(join(home, ".9router"));

    mkdirSync(join(home, ".lobakai"));
    expect(defaultDataDir()).toBe(join(home, ".lobakai"));
  });
});
