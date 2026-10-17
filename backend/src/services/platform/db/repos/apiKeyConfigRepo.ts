import { getAdapter } from "../driver.ts";
import {
  DEFAULT_API_KEY_PREFIX,
  normalizeApiKeyPrefix,
} from "../../shared/utils/apiKey.ts";

export async function getApiKeyConfig() {
  const db = await getAdapter();
  const row = db.get(`SELECT prefix FROM apiKeyConfig WHERE id = 1`);
  let prefix = DEFAULT_API_KEY_PREFIX;
  try {
    prefix = normalizeApiKeyPrefix(row?.prefix || DEFAULT_API_KEY_PREFIX);
  } catch {
    // Repair invalid legacy/manual values by falling back to the safe default.
  }
  return { prefix };
}

export async function updateApiKeyConfig(updates: any = {}) {
  const prefix = normalizeApiKeyPrefix(updates.prefix);
  const db = await getAdapter();
  db.run(
    `INSERT INTO apiKeyConfig(id, prefix) VALUES(1, ?)
     ON CONFLICT(id) DO UPDATE SET prefix = excluded.prefix`,
    [prefix]
  );
  return { prefix };
}
