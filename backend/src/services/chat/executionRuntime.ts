// Executors shared with v1 may need runtime-owned stores (qoder's
// context-window overrides are the first case). The active runtime registers
// itself on creation so module-level resolvers injected into v1 executors can
// reach v2 persistence without threading a Runtime through the v1 executor
// interface. The backend runs one runtime per process; tests create them
// sequentially and the newest registration wins.
import type { Runtime } from "../../runtime";

let active: Runtime | null = null;

export function setActiveExecutionRuntime(runtime: Runtime): void {
  active = runtime;
}

export function activeExecutionRuntime(): Runtime | null {
  return active;
}
