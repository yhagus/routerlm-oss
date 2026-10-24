// Mirror of backend/src/services/platform/dataDir.ts defaultDataDir(): the CLI
// must agree with the server on where data lives.
const fs = require("fs");
const os = require("os");
const path = require("path");

const APP_NAME = "lobakai";
// Folder name used by installs from before the LobakAI rename.
const LEGACY_APP_NAME = "9router";

function appDir(name) {
  if (process.platform === "win32") {
    return path.join(process.env.APPDATA || path.join(os.homedir(), "AppData", "Roaming"), name);
  }
  return path.join(process.env.HOME || os.homedir(), `.${name}`);
}

function getDataDir() {
  if (process.env.DATA_DIR) return process.env.DATA_DIR;
  const current = appDir(APP_NAME);
  if (fs.existsSync(current)) return current;
  const legacy = appDir(LEGACY_APP_NAME);
  return fs.existsSync(legacy) ? legacy : current;
}

module.exports = { getDataDir };
