import { defaultDataDir } from "./services/platform/dataDir.ts";
import { mkdirSync } from "node:fs";
import { Database } from "bun:sqlite";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { DEFAULT_SLOW_QUERY_MS, type BackendConfig } from "./config";
import { applyMigrations } from "./db/migrate";
import * as schema from "./db/schema";
import { createRepositories, type Repositories } from "./db/repositories";
import { createAuthService, type AuthService } from "./services/platform/auth";
import { createGateway, type Gateway } from "./services/chat/gateway";
import { createConsoleLogStore, type ConsoleLogStore } from "./services/platform/consoleLogs";
import { createCallbackProxyManager, type CallbackProxyManager } from "./services/platform/callbackProxy";
import { QuotaSnapshotManager } from "./services/billing/quotaSnapshotManager";
import { QuotaTracker, initQuotaTracker } from "./services/billing/quotaTracker";
import { ConnectionTestJobRunner } from "./services/providers/connectionTestJobRunner";
import { setActiveExecutionRuntime } from "./services/chat/executionRuntime";
import { applyOutboundProxyEnv } from "./services/platform/network/outboundProxy.ts";
import { bindLegacyDatabase, releaseLegacyDatabase } from "./services/platform/db/driver.ts";
import { flushRequestDetails } from "./services/chat/requestDetails";
import { startUsageRetention } from "./services/platform/usageRetention";
import { instrumentSlowQueries } from "./db/slowQueryLog";
import { createRuntimeMetrics, type RuntimeMetrics } from "./services/platform/runtimeMetrics";

export interface Runtime {
  config: BackendConfig;
  sqlite: Database;
  db: ReturnType<typeof drizzle<typeof schema>>;
  repos: Repositories;
  auth: AuthService;
  gateway: Gateway;
  consoleLogs: ConsoleLogStore;
  callbackProxy: CallbackProxyManager;
  quotaSnapshots: QuotaSnapshotManager;
  quotaTracker: QuotaTracker;
  connectionTestJobs: ConnectionTestJobRunner;
  metrics: RuntimeMetrics;
  close(): void;
}

export async function createRuntime(config: BackendConfig): Promise<Runtime> {
  const dataDir = config.dataDir || defaultDataDir();
  const databasePath = config.databasePath || `${dataDir}/db/data.sqlite`;
  mkdirSync(databasePath === ":memory:" ? dataDir : databasePath.slice(0, databasePath.lastIndexOf("/")), { recursive: true });
  const sqlite = new Database(databasePath);
  sqlite.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;");
  const slowQueries = instrumentSlowQueries(sqlite, config.slowQueryMs === undefined ? DEFAULT_SLOW_QUERY_MS : config.slowQueryMs);
  const metrics = createRuntimeMetrics(slowQueries);
  const db = drizzle(sqlite, { schema });
  applyMigrations(sqlite);
  // The legacy platform repos share this handle. No second connection exists.
  bindLegacyDatabase(sqlite);

  const repos = createRepositories(db, sqlite);
  const auth = createAuthService(config, repos);
  const gateway = createGateway(config, repos, auth, sqlite);
  const consoleLogs = createConsoleLogStore();
  const callbackProxy = createCallbackProxyManager(repos);
  let stopUsageRetention = () => {};
  const instance = {
    config,
    sqlite,
    db,
    repos,
    auth,
    gateway,
    consoleLogs,
    callbackProxy,
    metrics,
    quotaSnapshots: null as unknown as QuotaSnapshotManager,
    quotaTracker: null as unknown as QuotaTracker,
    connectionTestJobs: null as unknown as ConnectionTestJobRunner,
    // Order: stop jobs and schedulers, flush Usage and request details,
    // stop the metrics histogram, release the legacy layer, close SQLite.
    close: () => {
      stopUsageRetention();
      instance.connectionTestJobs.stop();
      instance.quotaSnapshots.stop();
      instance.quotaTracker.stop();
      callbackProxy.close();
      instance.repos.usage.flush();
      flushRequestDetails(instance);
      metrics.stop();
      releaseLegacyDatabase(sqlite);
      sqlite.close();
    },
  } satisfies Runtime;
  instance.quotaSnapshots = new QuotaSnapshotManager(instance);
  instance.quotaTracker = initQuotaTracker(instance);
  instance.quotaTracker.start();
  instance.connectionTestJobs = new ConnectionTestJobRunner(instance);
  instance.connectionTestJobs.start();
  stopUsageRetention = startUsageRetention(instance);
  setActiveExecutionRuntime(instance);
  // v1 initOutboundProxy: apply the configured outbound proxy to HTTP(S)_PROXY
  // env at boot so proxyAwareFetch picks it up.
  try { applyOutboundProxyEnv(repos.settings.get() as Record<string, unknown>); } catch { /* keep boot alive */ }
  return instance;
}
