import { mkdir, rename, rm } from "node:fs/promises";
import { dirname } from "node:path";

export async function readText(path: string): Promise<string | null> {
  const file = Bun.file(path);
  return (await file.exists()) ? file.text() : null;
}

export async function readJson<T>(path: string, fallback: T): Promise<T> {
  const text = await readText(path);
  if (text == null) return fallback;
  try {
    return JSON.parse(stripJsonc(text)) as T;
  } catch {
    return fallback;
  }
}

export async function writeText(path: string, value: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await Bun.write(path, value);
}

export async function writeJson(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.${crypto.randomUUID()}.tmp`;
  try {
    await Bun.write(temporary, `${JSON.stringify(value, null, 2)}\n`);
    await rename(temporary, path);
  } finally {
    await rm(temporary, { force: true }).catch(() => undefined);
  }
}

export async function pathExists(path: string): Promise<boolean> {
  return Bun.file(path).exists();
}

export interface ProcessResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  timedOut: boolean;
}

/** Run a fixed executable and argument vector. No shell interpolation is used. */
export async function runProcess(
  executable: string,
  args: string[] = [],
  options: { timeoutMs?: number; env?: Record<string, string | undefined>; cwd?: string } = {} as any,
): Promise<ProcessResult> {
  const child = Bun.spawn([executable, ...args], {
    cwd: options.cwd,
    env: options.env ? { ...process.env, ...options.env } : process.env,
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
  });
  const timeoutMs = options.timeoutMs ?? 2_000;
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    child.kill();
  }, timeoutMs);
  try {
    const [exitCode, stdout, stderr] = await Promise.all([
      child.exited,
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
    ]);
    return { exitCode, stdout, stderr, timedOut };
  } finally {
    clearTimeout(timer);
  }
}

export async function commandExists(command: string): Promise<boolean> {
  const lookup = process.platform === "win32" ? "where.exe" : "which";
  const result = await runProcess(lookup, [command], { timeoutMs: 1_500 });
  return result.exitCode === 0 && !result.timedOut && result.stdout.trim().length > 0;
}

export function stripJsonc(value: string): string {
  let result = "";
  let string = false;
  let escaped = false;
  let lineComment = false;
  let blockComment = false;
  for (let index = 0; index < value.length; index += 1) {
    const current = value[index];
    const next = value[index + 1];
    if (lineComment) {
      if (current === "\n") {
        lineComment = false;
        result += current;
      }
      continue;
    }
    if (blockComment) {
      if (current === "*" && next === "/") {
        blockComment = false;
        index += 1;
      } else if (current === "\n") {
        result += current;
      }
      continue;
    }
    if (string) {
      result += current;
      if (escaped) escaped = false;
      else if (current === "\\") escaped = true;
      else if (current === '"') string = false;
      continue;
    }
    if (current === '"') {
      string = true;
      result += current;
    } else if (current === "/" && next === "/") {
      lineComment = true;
      index += 1;
    } else if (current === "/" && next === "*") {
      blockComment = true;
      index += 1;
    } else {
      result += current;
    }
  }
  return result.replace(/,\s*([}\]])/g, "$1");
}

export function homeDir(): string {
  return process.env.HOME || process.env.USERPROFILE || ".";
}
