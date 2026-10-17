import { createHash, createHmac, randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export const DEFAULT_API_KEY_PREFIX = "sk-";

export function normalizeApiKeyPrefix(value: unknown): string {
  const raw = String(value ?? "").trim();
  if (!raw) return DEFAULT_API_KEY_PREFIX;
  const prefix = raw.replace(/-+$/, "");
  if (!prefix || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,31}$/.test(prefix)) {
    throw new Error("API key prefix must start with a letter or number and contain only letters, numbers, underscores, or hyphens");
  }
  return `${prefix}-`;
}

export function validateCustomApiKey(value: unknown): string {
  const custom = String(value ?? "").trim();
  if (!custom || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(custom)) {
    throw new Error("Custom API key must start with a letter or number and contain only letters, numbers, underscores, hyphens, or tildes");
  }
  return custom;
}

export function getMachineId(dataDir: string): string {
  const file = join(dataDir, "machine-id");
  let raw = "";
  try { raw = readFileSync(file, "utf8").trim(); } catch { /* create below */ }
  if (!raw) {
    raw = randomBytes(32).toString("hex");
    try { mkdirSync(dataDir, { recursive: true }); writeFileSync(file, raw, { mode: 0o600 }); } catch { /* best effort */ }
  }
  return createHash("sha256").update(`${raw}endpoint-proxy-salt`).digest("hex").slice(0, 16);
}

export function generateApiKey(machineId: string, prefix = DEFAULT_API_KEY_PREFIX): string {
  const keyId = randomBytes(3).toString("hex");
  const crc = createHmac("sha256", process.env.API_KEY_SECRET || "endpoint-proxy-api-key-secret")
    .update(machineId + keyId).digest("hex").slice(0, 8);
  return `${normalizeApiKeyPrefix(prefix)}${machineId}-${keyId}-${crc}`;
}

export function parseApiKey(value: string): { machineId: string; keyId: string; isNewFormat: boolean } | null {
  if (!value || typeof value !== "string") return null;
  const generated = value.match(/^(.*?)([a-f0-9]{16})-([a-z0-9]{6})-([a-f0-9]{8})$/i);
  if (generated) {
    const [, prefix, machineId, keyId, crc] = generated;
    if (!prefix?.endsWith("-")) return null;
    const expected = createHmac("sha256", process.env.API_KEY_SECRET || "endpoint-proxy-api-key-secret")
      .update(machineId + keyId).digest("hex").slice(0, 8);
    return crc.toLowerCase() === expected ? { machineId, keyId, isNewFormat: true } : null;
  }
  if (/^sk-[^-]+$/.test(value)) return { machineId: "", keyId: value.slice(3), isNewFormat: false };
  return null;
}
