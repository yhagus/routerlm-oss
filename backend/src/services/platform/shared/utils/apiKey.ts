import crypto from "crypto";

const API_KEY_SECRET = process.env.API_KEY_SECRET || "endpoint-proxy-api-key-secret";
export const DEFAULT_API_KEY_PREFIX = "sk-";

/**
 * Normalize the display prefix while keeping generated keys unambiguous and safe
 * to place in an Authorization header.
 */
export function normalizeApiKeyPrefix(value: any) {
  const raw = String(value ?? "").trim();
  if (!raw) return DEFAULT_API_KEY_PREFIX;

  const withoutTrailingHyphens = raw.replace(/-+$/, "");
  if (!withoutTrailingHyphens || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,31}$/.test(withoutTrailingHyphens)) {
    throw new Error("API key prefix must start with a letter or number and contain only letters, numbers, underscores, or hyphens");
  }

  return `${withoutTrailingHyphens}-`;
}

/**
 * Generate 6-char random keyId
 */
function generateKeyId() {
  const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
  let result = "";
  for (let i = 0; i < 6; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

/**
 * Generate CRC (8-char HMAC)
 */
function generateCrc(machineId: any, keyId: any) {
  return crypto
    .createHmac("sha256", API_KEY_SECRET)
    .update(machineId + keyId)
    .digest("hex")
    .slice(0, 8);
}

/**
 * Generate API key with machineId embedded
 * Format: {prefix}{machineId}-{keyId}-{crc8}
 * @param {string} machineId - 16-char machine ID
 * @param {string} [prefix] - normalized or unnormalized key prefix
 * @returns {{ key: string, keyId: string }}
 */
export function generateApiKeyWithMachine(machineId: any, prefix = DEFAULT_API_KEY_PREFIX) {
  const keyId = generateKeyId();
  const crc = generateCrc(machineId, keyId);
  const key = `${normalizeApiKeyPrefix(prefix)}${machineId}-${keyId}-${crc}`;
  return { key, keyId };
}

/**
 * Parse API key and extract machineId + keyId
 * Supports both formats:
 * - New: {prefix}{machineId}-{keyId}-{crc8}
 * - Old: sk-{random8}
 * @param {string} apiKey
 * @returns {{ prefix: string, machineId: string, keyId: string, isNewFormat: boolean } | null}
 */
export function parseApiKey(apiKey: any) {
  if (!apiKey || typeof apiKey !== "string") return null;

  // The machine ID is a fixed 16-character hexadecimal value, so custom
  // prefixes can be parsed without storing the current prefix separately.
  const generated = apiKey.match(/^(.*?)([a-f0-9]{16})-([a-z0-9]{6})-([a-f0-9]{8})$/i);
  if (generated) {
    const [, prefix, machineId, keyId, crc] = generated;
    if (!prefix || !prefix.endsWith("-")) return null;
    const expectedCrc = generateCrc(machineId, keyId);
    if (crc !== expectedCrc) return null;
    return { prefix, machineId, keyId, isNewFormat: true };
  }

  // Old format: sk-{random8} = 2 parts.
  if (apiKey.startsWith("sk-")) {
    const parts = apiKey.split("-");
    if (parts.length === 2) {
      return { prefix: "sk-", machineId: null, keyId: parts[1], isNewFormat: false };
    }
  }

  return null;
}

/**
 * Verify API key CRC (only for new format)
 * @param {string} apiKey
 * @returns {boolean}
 */
export function verifyApiKeyCrc(apiKey: any) {
  const parsed = parseApiKey(apiKey);
  if (!parsed) return false;
  
  // Old format doesn't have CRC, always valid if parsed
  if (!parsed.isNewFormat) return true;
  
  // New format already verified in parseApiKey
  return true;
}

/**
 * Check if API key is new format (contains machineId)
 * @param {string} apiKey
 * @returns {boolean}
 */
export function isNewFormatKey(apiKey: any) {
  const parsed = parseApiKey(apiKey);
  return parsed?.isNewFormat === true;
}
