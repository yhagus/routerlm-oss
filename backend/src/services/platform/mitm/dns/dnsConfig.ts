import { exec, spawn, execSync } from "child_process";
import fs from "fs";
import path from "path";
import os from "os";
import { log, err } from "../logger.ts";
import { TOOL_HOSTS } from "../../shared/constants/mitmToolHosts.ts";
import { runElevatedPowerShell, isAdmin } from "../winElevated.ts";

/**
 * Atomic-ish write for Windows hosts file with rollback on failure.
 * Strategy: write `.new` sibling → rename current to `.bak` → rename `.new` to target.
 * If anything fails mid-way, restore from `.bak`. Same-volume renames are atomic on NTFS.
 */
function atomicWriteHostsWin(target: any, originalContent: any, newContent: any) {
  const tmpNew = `${target}.lobakai.new`;
  const tmpBak = `${target}.lobakai.bak`;
  try {
    fs.writeFileSync(tmpNew, newContent, "utf8");
    try { fs.unlinkSync(tmpBak); } catch { /* none */ }
    fs.renameSync(target, tmpBak);
    try {
      fs.renameSync(tmpNew, target);
    } catch (e: any) {
      // Rollback: restore original
      try { fs.renameSync(tmpBak, target); } catch { fs.writeFileSync(target, originalContent, "utf8"); }
      throw e;
    }
    try { fs.unlinkSync(tmpBak); } catch { /* best effort */ }
  } finally {
    try { fs.unlinkSync(tmpNew); } catch { /* already moved or never created */ }
  }
}

const IS_WIN = process.platform === "win32";
const IS_MAC = process.platform === "darwin";
const HOSTS_FILE = IS_WIN
  ? path.join(process.env.SystemRoot || "C:\\Windows", "System32", "drivers", "etc", "hosts")
  : "/etc/hosts";

/** True when `sudo` exists (e.g. missing on minimal Docker images like Alpine). */
function isSudoAvailable() {
  if (IS_WIN) return false;
  try {
    execSync("command -v sudo", { stdio: "ignore", windowsHide: true });
    return true;
  } catch {
    return false;
  }
}

function canRunSudoWithoutPassword() {
  if (IS_WIN || !isSudoAvailable()) return true;
  try {
    execSync("sudo -n true", { stdio: "ignore", windowsHide: true });
    return true;
  } catch {
    return false;
  }
}

function isSudoPasswordRequired() {
  return !IS_WIN && isSudoAvailable() && !canRunSudoWithoutPassword();
}

/**
 * Execute command with sudo password via stdin (macOS/Linux only).
 * Without sudo in PATH (containers), runs via sh — same user, no elevation.
 */
function execWithPassword(command: any, password: any) {
  return new Promise<any>((resolve, reject) => {
    const useSudo = isSudoAvailable();
    const child = useSudo
      ? spawn("sudo", ["-S", "sh", "-c", command], { stdio: ["pipe", "pipe", "pipe"], windowsHide: true })
      : spawn("sh", ["-c", command], { stdio: ["ignore", "pipe", "pipe"], windowsHide: true });

    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d: any) => { stdout += d; });
    child.stderr.on("data", (d: any) => { stderr += d; });

    child.on("close", (code: any) => {
      if (code === 0) resolve(stdout);
      else reject(new Error(stderr || `Exit code ${code}`));
    });

    if (useSudo) {
      (child.stdin as any).write(`${password}\n`);
      (child.stdin as any).end();
    }
  });
}

/**
 * Trim trailing blank lines/whitespace, ensure file ends with exactly one newline.
 */
function normalizeHostsContent(content: any) {
  const eol = IS_WIN ? "\r\n" : "\n";
  return content.replace(/[\r\n\s]+$/g, "") + eol;
}

/**
 * Flush DNS cache (macOS/Linux)
 */
async function flushDNS(sudoPassword: any) {
  if (IS_WIN) return; // Windows flushes inline via ipconfig
  if (IS_MAC) {
    await execWithPassword("dscacheutil -flushcache && killall -HUP mDNSResponder", sudoPassword);
  } else {
    await execWithPassword("resolvectl flush-caches 2>/dev/null || true", sudoPassword);
  }
}

/**
 * Check if DNS entry exists for a specific host
 */
function checkDNSEntry(host: any = null) {
  try {
    const hostsContent = fs.readFileSync(HOSTS_FILE, "utf8");
    if (host) return hostsContent.includes(host);
    // Legacy: check all antigravity hosts (backward compat)
    return TOOL_HOSTS.antigravity.every((h: any) => hostsContent.includes(h));
  } catch {
    return false;
  }
}

/**
 * Check DNS status per tool — returns { [tool]: boolean }
 */
function checkAllDNSStatus() {
  try {
    const hostsContent = fs.readFileSync(HOSTS_FILE, "utf8");
    const result: Record<string, any> = {};
    for (const [tool, hosts] of Object.entries(TOOL_HOSTS as Record<string, any>)) {
      result[tool] = hosts.every((h: any) => hostsContent.includes(h));
    }
    return result;
  } catch {
    return Object.fromEntries(Object.keys(TOOL_HOSTS).map(t => [t, false]));
  }
}

/**
 * Add DNS entries for a specific tool
 */
async function addDNSEntry(tool: any, sudoPassword: any) {
  const hosts = (TOOL_HOSTS as any)[tool];
  if (!hosts) throw new Error(`Unknown tool: ${tool}`);

  const entriesToAdd = hosts.filter((h: any) => !checkDNSEntry(h));
  if (entriesToAdd.length === 0) {
    log(`🌐 DNS ${tool}: already active`);
    return;
  }

  try {
    if (IS_WIN) {
      // Read → trim → append → atomic write (Node-side, no CLI size limit)
      const current = fs.readFileSync(HOSTS_FILE, "utf8");
      const trimmed = current.replace(/[\r\n\s]+$/g, "");
      const toAppend = entriesToAdd.map((h: any) => `127.0.0.1 ${h}`).join("\r\n");
      const next = `${trimmed}\r\n${toAppend}\r\n`;
      atomicWriteHostsWin(HOSTS_FILE, current, next);
      await runElevatedPowerShell("ipconfig /flushdns | Out-Null");
    } else {
      const current = fs.readFileSync(HOSTS_FILE, "utf8");
      const trimmed = current.replace(/[\r\n\s]+$/g, "");
      const toAppend = entriesToAdd.map((h: any) => `127.0.0.1 ${h}`).join("\n");
      const next = `${trimmed}\n${toAppend}\n`;
      // Use tee via sudo to overwrite atomically — escape single quotes in content
      const escaped = next.replace(/'/g, "'\\''");
      await execWithPassword(`printf '%s' '${escaped}' | tee ${HOSTS_FILE} > /dev/null`, sudoPassword);
      await flushDNS(sudoPassword);
    }
    log(`🌐 DNS ${tool}: ✅ added ${entriesToAdd.join(", ")}`);
  } catch (error: any) {
    const msg = error.message?.includes("incorrect password") ? "Wrong sudo password" : `Failed to add DNS entry: ${error.message}`;
    throw new Error(msg);
  }
}

/**
 * Remove DNS entries for a specific tool
 */
async function removeDNSEntry(tool: any, sudoPassword: any) {
  const hosts = (TOOL_HOSTS as any)[tool];
  if (!hosts) throw new Error(`Unknown tool: ${tool}`);

  const entriesToRemove = hosts.filter((h: any) => checkDNSEntry(h));
  if (entriesToRemove.length === 0) {
    log(`🌐 DNS ${tool}: already inactive`);
    return;
  }

  try {
    if (IS_WIN) {
      const current = fs.readFileSync(HOSTS_FILE, "utf8");
      const filtered = current.split(/\r?\n/).filter((l: any) => !entriesToRemove.some((h: any) => l.includes(h))).join("\r\n");
      const next = filtered.replace(/[\r\n\s]+$/g, "") + "\r\n";
      atomicWriteHostsWin(HOSTS_FILE, current, next);
      await runElevatedPowerShell("ipconfig /flushdns | Out-Null");
    } else {
      const current = fs.readFileSync(HOSTS_FILE, "utf8");
      const filtered = current.split(/\r?\n/).filter((l: any) => !entriesToRemove.some((h: any) => l.includes(h))).join("\n");
      const next = filtered.replace(/[\r\n\s]+$/g, "") + "\n";
      const escaped = next.replace(/'/g, "'\\''");
      await execWithPassword(`printf '%s' '${escaped}' | tee ${HOSTS_FILE} > /dev/null`, sudoPassword);
      await flushDNS(sudoPassword);
    }
    log(`🌐 DNS ${tool}: ✅ removed ${entriesToRemove.join(", ")}`);
  } catch (error: any) {
    const msg = error.message?.includes("incorrect password") ? "Wrong sudo password" : `Failed to remove DNS entry: ${error.message}`;
    throw new Error(msg);
  }
}

/**
 * Remove ALL tool DNS entries (used when stopping server)
 */
async function removeAllDNSEntries(sudoPassword: any) {
  for (const tool of Object.keys(TOOL_HOSTS)) {
    try {
      await removeDNSEntry(tool, sudoPassword);
    } catch (e: any) {
      err(`DNS ${tool}: failed to remove — ${e.message}`);
    }
  }
}

/**
 * Sync removal of ALL tool DNS entries — for use during process shutdown
 * when async ops aren't safe. Assumes caller already has root/admin rights.
 */
function removeAllDNSEntriesSync() {
  try {
    if (!fs.existsSync(HOSTS_FILE)) return;
    const allHosts = Object.values(TOOL_HOSTS).flat();
    const content = fs.readFileSync(HOSTS_FILE, "utf8");
    const eol = IS_WIN ? "\r\n" : "\n";
    const filtered = content.split(/\r?\n/).filter((l: any) => !allHosts.some(h => l.includes(h))).join(eol);
    const next = filtered.replace(/[\r\n\s]+$/g, "") + eol;
    if (next === content) return;
    fs.writeFileSync(HOSTS_FILE, next, "utf8");
    if (IS_WIN) {
      try { execSync("ipconfig /flushdns", { windowsHide: true, stdio: "ignore" }); } catch { /* ignore */ }
    } else if (IS_MAC) {
      try { execSync("dscacheutil -flushcache && killall -HUP mDNSResponder", { stdio: "ignore" }); } catch { /* ignore */ }
    } else {
      try { execSync("resolvectl flush-caches 2>/dev/null || true", { stdio: "ignore" }); } catch { /* ignore */ }
    }
  } catch { /* best effort during shutdown */ }
}

export {
  TOOL_HOSTS,
  addDNSEntry,
  removeDNSEntry,
  removeAllDNSEntries,
  removeAllDNSEntriesSync,
  execWithPassword,
  isSudoAvailable,
  canRunSudoWithoutPassword,
  isSudoPasswordRequired,
  checkDNSEntry,
  checkAllDNSStatus,
};
