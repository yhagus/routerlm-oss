import fs from "node:fs";
import path from "path";
import os from "os";

const APP_NAME = "lobakai";
// Folder name used by installs from before the LobakAI rename.
const LEGACY_APP_NAME = "9router";

function appDir(name: string) {
  if (process.platform === "win32") {
    return path.join(process.env.APPDATA || path.join(os.homedir(), "AppData", "Roaming"), name);
  }
  return path.join(process.env.HOME || os.homedir(), `.${name}`);
}

// ~/.lobakai wins when it exists. Otherwise an earlier install keeps its legacy
// folder, and a new install starts in ~/.lobakai.
export function defaultDataDir() {
  const current = appDir(APP_NAME);
  if (fs.existsSync(current)) return current;
  const legacy = appDir(LEGACY_APP_NAME);
  return fs.existsSync(legacy) ? legacy : current;
}

export function getDataDir() {
  const configured = process.env.DATA_DIR;
  if (!configured) return defaultDataDir();

  // On Windows, ignore Unix-style absolute paths (e.g. /var/lib/...) that come
  // from a Linux-targeted .env or Docker config — they are not valid here.
  if (process.platform === "win32" && /^\//.test(configured)) {
    console.warn(`[DATA_DIR] '${configured}' is a Unix path on Windows → fallback to default`);
    return defaultDataDir();
  }

  try {
    fs.mkdirSync(configured, { recursive: true });
    return configured;
  } catch (e: any) {
    if (e?.code === "EACCES" || e?.code === "EPERM") {
      const fallback = defaultDataDir();
      console.warn(`[DATA_DIR] '${configured}' not writable → fallback ${fallback}`);
      return fallback;
    }
    throw e;
  }
}

export const DATA_DIR = getDataDir();
