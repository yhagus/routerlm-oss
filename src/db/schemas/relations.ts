import { defineRelations } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import * as schema from "@/db/schemas";

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
  integrations: {
    createdBy: r.one.users({ from: r.integrations.createdById, to: r.users.id }),
    rotations: r.many.integrationRotations(),
    apiKeys: r.many.apiKeys(),
  },
  integrationRotations: {
    integration: r.one.integrations({
      from: r.integrationRotations.integrationId,
      to: r.integrations.id,
      optional: false,
    }),
    rotatedBy: r.one.users({ from: r.integrationRotations.rotatedById, to: r.users.id }),
  },
  apiKeys: {
    createdBy: r.one.users({ from: r.apiKeys.createdById, to: r.users.id }),
    integration: r.one.integrations({ from: r.apiKeys.integrationId, to: r.integrations.id }),
    rotations: r.many.apiKeyRotations(),
  },
  apiKeyRotations: {
    apiKey: r.one.apiKeys({
      from: r.apiKeyRotations.apiKeyId,
      to: r.apiKeys.id,
      optional: false,
    }),
    rotatedBy: r.one.users({ from: r.apiKeyRotations.rotatedById, to: r.users.id }),
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
    quotaMeters: r.many.quotaMeters(),
  },
  quotaMeters: {
    providerAccount: r.one.providerAccounts({
      from: r.quotaMeters.providerAccountId,
      to: r.providerAccounts.id,
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
    attempts: r.many.attempts(),
    errorCaptures: r.many.errorCaptures(),
  },
  attempts: {
    usageLog: r.one.usageLogs({ from: r.attempts.usageLogId, to: r.usageLogs.id, optional: false }),
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

export type Database = NodePgDatabase<typeof relations>;

export type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];
