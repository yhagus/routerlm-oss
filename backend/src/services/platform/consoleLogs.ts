export type ConsoleLogEvent = "line" | "clear";
export type ConsoleLogListener = (value?: string) => void;

const MAX_LINES = 1000;
const LEVELS = ["log", "info", "warn", "error", "debug"] as const;
const ANSI_ESCAPE = /\x1b\[[0-9;]*m/g;

function formatArgument(value: unknown): string {
  if (typeof value === "string") return value.replace(ANSI_ESCAPE, "");
  if (value instanceof Error) return (value.stack || value.message).replace(ANSI_ESCAPE, "");
  try {
    return JSON.stringify(value)?.replace(ANSI_ESCAPE, "") || String(value);
  } catch {
    return String(value).replace(ANSI_ESCAPE, "");
  }
}

class ConsoleLogStore {
  private readonly logs: string[] = [];
  private readonly listeners = new Map<ConsoleLogEvent, Set<ConsoleLogListener>>([
    ["line", new Set()],
    ["clear", new Set()],
  ]);

  list(): string[] {
    return [...this.logs];
  }

  append(level: string, args: unknown[]): void {
    const line = args.map(formatArgument).join(" ");
    this.logs.push(line);
    if (this.logs.length > MAX_LINES) this.logs.splice(0, this.logs.length - MAX_LINES);
    this.emit("line", line);
  }

  clear(): void {
    this.logs.splice(0, this.logs.length);
    this.emit("clear");
  }

  subscribe(event: ConsoleLogEvent, listener: ConsoleLogListener): () => void {
    const listeners = this.listeners.get(event)!;
    listeners.add(listener);
    return () => listeners.delete(listener);
  }

  private emit(event: ConsoleLogEvent, value?: string): void {
    for (const listener of [...this.listeners.get(event)!]) {
      try {
        listener(value);
      } catch {
        // A disconnected SSE consumer must not affect log capture.
      }
    }
  }
}

const store = new ConsoleLogStore();
let captureInitialized = false;

export function createConsoleLogStore(): ConsoleLogStore {
  if (!captureInitialized) {
    const target = console as unknown as Record<string, (...args: unknown[]) => void>;
    for (const level of LEVELS) {
      const original = target[level];
      if (typeof original !== "function") continue;
      target[level] = (...args: unknown[]) => {
        store.append(level, args);
        original.apply(console, args);
      };
    }
    captureInitialized = true;
  }
  return store;
}

export type { ConsoleLogStore };
