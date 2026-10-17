import { defaultDataDir } from "./services/platform/dataDir.ts";

const DEFAULT_HOST = "127.0.0.1";
const DEFAULT_PORT = 20129;
const DEFAULT_STREAM_STALL_TIMEOUT_MS = 360_000;
export const DEFAULT_SLOW_QUERY_MS = 100;
const SUPPORTED_HOSTS = new Set(["127.0.0.1", "::1", "localhost", "0.0.0.0"]);

export interface BackendConfig {
  host: string;
  port: number;
  dataDir?: string;
  databasePath?: string;
  legacyDatabasePath?: string;
  jwtSecret?: string;
  initialPassword?: string;
  requireLogin?: boolean;
  requireApiKey?: boolean;
  machineIdSalt?: string;
  streamStallTimeoutMs?: number;
  // SQLite statements slower than this write one log line. null turns the log off.
  slowQueryMs?: number | null;
}

export function loadConfig(
  env: Record<string, string | undefined> = process.env,
): BackendConfig {
  const host = env.BACKEND_HOST?.trim() || DEFAULT_HOST;
  if (!SUPPORTED_HOSTS.has(host)) {
    throw new Error(
      `BACKEND_HOST must be localhost or 0.0.0.0; received "${host}"`,
    );
  }

  const portValue = env.BACKEND_PORT?.trim();
  const port = portValue ? Number(portValue) : DEFAULT_PORT;
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`BACKEND_PORT must be an integer from 1 to 65535; received "${portValue}"`);
  }

  return { host, port };
}

export function loadRuntimeConfig(env: Record<string, string | undefined> = process.env): BackendConfig {
  const base = loadConfig(env);
  const dataDir = expandPath(env.DATA_DIR?.trim() || defaultDataDir());
  return {
    ...base,
    dataDir,
    databasePath: expandPath(env.BACKEND_DATABASE_PATH?.trim() || `${dataDir}/db/data.sqlite`),
    legacyDatabasePath: env.LEGACY_DATABASE_PATH?.trim() ? expandPath(env.LEGACY_DATABASE_PATH.trim()) : undefined,
    jwtSecret: env.JWT_SECRET?.trim() || undefined,
    initialPassword: env.INITIAL_PASSWORD || "123456",
    requireLogin: env.REQUIRE_LOGIN !== "false",
    requireApiKey: env.REQUIRE_API_KEY === "true",
    machineIdSalt: env.MACHINE_ID_SALT?.trim() || undefined,
    streamStallTimeoutMs: positiveMilliseconds(env.STREAM_STALL_TIMEOUT_MS, DEFAULT_STREAM_STALL_TIMEOUT_MS),
    slowQueryMs: slowQueryThreshold(env.SLOW_QUERY_MS),
  };
}

function positiveMilliseconds(value: string | undefined, fallback: number): number {
  if (!value?.trim()) return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

// SLOW_QUERY_MS=0 turns the slow-query log off. An invalid value keeps the default.
function slowQueryThreshold(value: string | undefined): number | null {
  if (value?.trim() === "0") return null;
  return positiveMilliseconds(value, DEFAULT_SLOW_QUERY_MS);
}

function expandPath(value: string): string {
  return value.startsWith("~/") ? `${process.env.HOME || "."}/${value.slice(2)}` : value;
}
