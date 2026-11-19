// The Allow private upstreams Setting as this process last read it. The checks
// that use it are synchronous (module-constant URL schemas, OutboundFetch), so
// they cannot read the database: the snapshot reload publishes the value here
// (ADR 0020). It starts off, so a process that has not read it yet refuses, and
// a failed reload keeps the last value read.
let isAllowed = false;

/** Whether the Allow private upstreams Setting lifts both Provider URL rules (ADR 0019). */
export function allowsPrivateUpstreams(): boolean {
  return isAllowed;
}

/** Called by each successful snapshot reload with the Setting it read. */
export function publishPrivateUpstreamsAllowed(allowed: boolean): void {
  isAllowed = allowed;
}
