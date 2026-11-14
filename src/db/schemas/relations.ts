import { defineRelations } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import * as schema from "./index.js";

export const relations = defineRelations(schema, (r) => ({
  users: {
    createdBy: r.one.users({ from: r.users.createdById, to: r.users.id, alias: "createdUsers" }),
    createdUsers: r.many.users({ alias: "createdUsers" }),
    sessions: r.many.sessions(),
    apiKeys: r.many.apiKeys(),
  },
  sessions: {
    user: r.one.users({ from: r.sessions.userId, to: r.users.id, optional: false }),
  },
  apiKeys: {
    createdBy: r.one.users({ from: r.apiKeys.createdById, to: r.users.id }),
    usageLogs: r.many.usageLogs(),
  },
  providers: {
    providerAccounts: r.many.providerAccounts(),
    upstreamModels: r.many.upstreamModels(),
  },
  providerAccounts: {
    provider: r.one.providers({
      from: r.providerAccounts.providerId,
      to: r.providers.id,
      optional: false,
    }),
  },
  upstreamModels: {
    provider: r.one.providers({
      from: r.upstreamModels.providerId,
      to: r.providers.id,
      optional: false,
    }),
    routes: r.many.routes(),
  },
  models: {
    routes: r.many.routes(),
  },
  routes: {
    model: r.one.models({ from: r.routes.modelId, to: r.models.id, optional: false }),
    upstreamModel: r.one.upstreamModels({
      from: r.routes.upstreamModelId,
      to: r.upstreamModels.id,
      optional: false,
    }),
  },
  usageLogs: {
    apiKey: r.one.apiKeys({ from: r.usageLogs.apiKeyId, to: r.apiKeys.id }),
    user: r.one.users({ from: r.usageLogs.userId, to: r.users.id }),
    model: r.one.models({ from: r.usageLogs.modelId, to: r.models.id }),
    route: r.one.routes({ from: r.usageLogs.routeId, to: r.routes.id }),
    providerAccount: r.one.providerAccounts({
      from: r.usageLogs.providerAccountId,
      to: r.providerAccounts.id,
    }),
    attempts: r.many.attempts(),
    errorCaptures: r.many.errorCaptures(),
  },
  attempts: {
    usageLog: r.one.usageLogs({ from: r.attempts.usageLogId, to: r.usageLogs.id, optional: false }),
    route: r.one.routes({ from: r.attempts.routeId, to: r.routes.id }),
    providerAccount: r.one.providerAccounts({
      from: r.attempts.providerAccountId,
      to: r.providerAccounts.id,
    }),
  },
  errorCaptures: {
    usageLog: r.one.usageLogs({
      from: r.errorCaptures.usageLogId,
      to: r.usageLogs.id,
      optional: false,
    }),
    attempt: r.one.attempts({ from: r.errorCaptures.attemptId, to: r.attempts.id }),
  },
}));

/** Inject with `@InjectDrizzle() private readonly db: Database`. */
export type Database = NodePgDatabase<typeof relations>;
