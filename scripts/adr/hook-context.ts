import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join, relative } from 'node:path';
import { adrDir, areasForPath, knownAreas, readAdrs } from './adrs';

const STATE_DIR = join(tmpdir(), 'routerlm-adr-hook');

function field(source: unknown, key: string): unknown {
  return typeof source === 'object' && source !== null ? Reflect.get(source, key) : undefined;
}

function text(source: unknown, key: string): string | undefined {
  const value = field(source, key);
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function repoRoot(file: string): string | undefined {
  let dir = dirname(file);
  for (let depth = 0; depth < 20; depth += 1) {
    if (existsSync(adrDir(dir)) && existsSync(join(dir, 'src'))) return dir;
    const parent = dirname(dir);
    if (parent === dir) return undefined;
    dir = parent;
  }
  return undefined;
}

function safeName(value: string): string {
  return value.replace(/[^\w-]/g, '_');
}

function stateFile(sessionId: string, agentId: string): string {
  return join(STATE_DIR, `${safeName(sessionId)}--${safeName(agentId)}.json`);
}

function readShown(path: string): Set<string> {
  if (!existsSync(path)) return new Set();
  const parsed: unknown = JSON.parse(readFileSync(path, 'utf8'));
  return new Set(Array.isArray(parsed) ? parsed.filter((item) => typeof item === 'string') : []);
}

function forgetSession(sessionId: string): void {
  if (!existsSync(STATE_DIR)) return;
  const prefix = `${safeName(sessionId)}--`;
  for (const name of readdirSync(STATE_DIR)) {
    if (name.startsWith(prefix)) rmSync(join(STATE_DIR, name), { force: true });
  }
}

function contextFor(input: unknown): string | undefined {
  const sessionId = text(input, 'session_id');
  const file = text(field(input, 'tool_input'), 'file_path');
  if (sessionId === undefined || file === undefined) return undefined;
  const cwd = text(input, 'cwd') ?? process.cwd();
  const absolute = isAbsolute(file) ? file : join(cwd, file);
  const root = repoRoot(absolute);
  if (root === undefined) return undefined;
  const path = relative(root, absolute);
  const areas = areasForPath(path, new Set(knownAreas(root)));
  if (areas.length === 0) return undefined;

  const state = stateFile(sessionId, text(input, 'agent_id') ?? 'main');
  const shown = readShown(state);
  const fresh = readAdrs(root).adrs.filter(
    (adr) =>
      adr.status === 'accepted' &&
      !shown.has(adr.number) &&
      adr.areas.some((area) => areas.includes(area)),
  );
  if (fresh.length === 0) return undefined;

  mkdirSync(STATE_DIR, { recursive: true });
  writeFileSync(state, JSON.stringify([...shown, ...fresh.map((adr) => adr.number)]));
  return [
    `Decisions recorded for ${path} (areas: ${areas.join(', ')}). Read the ones that bear on this change before making it; docs/adr/README.md indexes all ADRs by area.`,
    ...fresh.map((adr) => `- docs/adr/${adr.file}: ${adr.title}`),
  ].join('\n');
}

function main(): void {
  const input: unknown = JSON.parse(readFileSync(0, 'utf8'));
  const event = text(input, 'hook_event_name');
  if (event === 'SessionStart') {
    const sessionId = text(input, 'session_id');
    if (sessionId !== undefined) forgetSession(sessionId);
    return;
  }
  const context = contextFor(input);
  if (context === undefined) return;
  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: { hookEventName: 'PreToolUse', additionalContext: context },
    }),
  );
}

try {
  main();
} catch {
  process.exit(0);
}
