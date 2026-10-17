// Loaded via `bun test --preload` before any application module. The v1
// executor layer captures globalThis.fetch at import time (proxyFetch.js), so
// a mock installed later in a test never reaches it. This harness installs a
// dispatcher FIRST: the captured reference becomes the harness, and tests can
// swap the backing implementation at any time via installFetchMock.

import dns from "node:dns";

// proxyFetch.js routes MITM-bypass hosts (cloudcode-pa.googleapis.com,
// api2.cursor.sh, ...) through a raw TLS socket that never touches
// globalThis.fetch, so tests would leak to the real network. Kill its DNS
// resolution so resolveRealIP returns null and the bypass falls through to
// the harness-visible fetch path.
//
// Bun's dns.Resolver exposes its native methods on the *instance* prototype,
// which is a distinct object from dns.Resolver.prototype. Patch that object
// with a callback-style resolver so util.promisify rejects cleanly (an async
// function would hang promisify instead of settling).
const resolverProto = Object.getPrototypeOf(new dns.Resolver()) as {
  resolve4: (hostname: string, options: unknown, callback: (error: Error | null, addresses?: string[]) => void) => void;
};
resolverProto.resolve4 = (_hostname, options, callback) => {
  const done = typeof options === "function" ? options : callback;
  done?.(new Error("[fetchHarness] DNS disabled in tests"));
};

type FetchImplementation = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

const realFetch: FetchImplementation = globalThis.fetch.bind(globalThis);
let activeMock: FetchImplementation | null = null;

export function installFetchMock(mock: FetchImplementation | null): void {
  activeMock = mock;
}

const harness: FetchImplementation = (input, init) => (activeMock ? activeMock(input, init) : realFetch(input, init));

export { harness };

// Some v1 modules keep their own bound reference; the harness must also be
// the global so plain-fetch callers (v2 services) observe the same mock.
globalThis.fetch = harness as typeof fetch;
