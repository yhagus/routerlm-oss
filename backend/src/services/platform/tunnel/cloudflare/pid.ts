import fs from "fs";
import path from "path";
import { TUNNEL_DIR, ensureTunnelDir } from "../shared/state.ts";

const PID_FILE = path.join(TUNNEL_DIR, "cloudflared.pid");

export function savePid(pid: any) {
  ensureTunnelDir();
  fs.writeFileSync(PID_FILE, pid.toString());
}

export function loadPid() {
  try {
    if (fs.existsSync(PID_FILE)) return parseInt(fs.readFileSync(PID_FILE, "utf8"));
  } catch { /* ignore */ }
  return null;
}

export function clearPid(expectedPid: any = null) {
  try {
    if (!fs.existsSync(PID_FILE)) return false;
    if (expectedPid !== null && loadPid() !== expectedPid) return false;
    fs.unlinkSync(PID_FILE);
    return true;
  } catch { /* ignore */ }
  return false;
}
