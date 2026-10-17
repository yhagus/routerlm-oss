// In-memory scheduler history log. Each scheduler appends entries; the dashboard
// reads them through the /api/scheduler route. Capped at MAX_HISTORY entries per
// scheduler to bound memory.

export interface SchedulerHistoryEntry {
  timestamp: string;
  status: "success" | "failure" | "skipped";
  detail?: string;
  durationMs?: number;
}

interface SchedulerState {
  id: string;
  name: string;
  description: string;
  interval: string;
  enabled: boolean;
  history: SchedulerHistoryEntry[];
}

const MAX_HISTORY = 50;
const states = new Map<string, SchedulerState>();

export function registerScheduler(input: {
  id: string;
  name: string;
  description: string;
  interval: string;
  enabled: boolean;
}): void {
  const existing = states.get(input.id);
  if (existing) {
    existing.enabled = input.enabled;
    existing.interval = input.interval;
    return;
  }
  states.set(input.id, {
    id: input.id,
    name: input.name,
    description: input.description,
    interval: input.interval,
    enabled: input.enabled,
    history: [],
  });
}

export function logSchedulerAction(
  id: string,
  status: "success" | "failure" | "skipped",
  detail?: string,
  durationMs?: number,
): void {
  const state = states.get(id);
  if (!state) return;
  const entry: SchedulerHistoryEntry = {
    timestamp: new Date().toISOString(),
    status,
    detail,
    durationMs,
  };
  state.history.unshift(entry);
  if (state.history.length > MAX_HISTORY) state.history.length = MAX_HISTORY;
}

export function setSchedulerEnabled(id: string, enabled: boolean): boolean {
  const state = states.get(id);
  if (!state) return false;
  state.enabled = enabled;
  return true;
}

export function getSchedulerStates(): SchedulerState[] {
  return Array.from(states.values());
}
