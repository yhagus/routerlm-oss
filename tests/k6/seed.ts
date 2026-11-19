import { createHash } from "node:crypto";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import {
  apiKeys,
  type AuthStyle,
  models,
  providerAccounts,
  providers,
  routes,
  type UpstreamProtocol,
  upstreamModels,
} from "@/db/schemas/index.js";
import { ProviderKeyCipher } from "@/upstream/providers/provider-key-cipher.js";

// Run by the `seed` service of tests/k6/docker-compose.yml, after migrations
// and before the backend starts (so the backend's snapshot already holds
// everything). Every Provider is the fake upstream; its URL path picks how it
// behaves (see fake-upstream.js):
//   perf-*      /paced    realistic latency and token speed
//   perf-large  /paced    the same, with a 1M-token context, for the 900K-token cases
//   raw-*       /instant  answers at once: the gateway alone
//   fault-*     /fault/*  one Route to an upstream that misbehaves
//   failover-*  /fault/*  that same fault first, then a healthy /paced Route

const API_KEY_PATTERN = /^rlm_([0-9a-f]{16})_[A-Za-z0-9_-]{43}$/;

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is not set`);
  }
  return value;
}

const apiKey = required("PERF_API_KEY");
const keyMatch = API_KEY_PATTERN.exec(apiKey);
if (!keyMatch) {
  throw new Error("PERF_API_KEY must look like rlm_<16 hex>_<43 base64url characters>");
}
// Ends in /v1; the Provider's protocol path is appended to it.
const upstreamOrigin = required("UPSTREAM_ORIGIN");
const cipher = new ProviderKeyCipher(required("ENCRYPTION_KEY"));

interface Speaks {
  protocol: UpstreamProtocol;
  authStyle: AuthStyle;
}
const OPENAI_CHAT: Speaks = { protocol: "openai-chat", authStyle: "bearer" };
const ANTHROPIC_MESSAGES: Speaks = { protocol: "anthropic-messages", authStyle: "x-api-key" };
const OPENAI_RESPONSES: Speaks = { protocol: "openai-responses", authStyle: "bearer" };

/**
 * Two Provider Accounts per healthy Provider, as a real deployment has: one
 * timeout puts a single account into Cooldown, and with only one the whole
 * Model would go offline. The fault Providers keep one, so a broken upstream
 * is the whole story.
 */
const ACCOUNTS_PER_PROVIDER = 2;

const DEFAULT_CONTEXT = 128_000;
const LARGE_CONTEXT = 1_000_000;

/** A fault Route gives up on a silent upstream after this long, so a hung one ends. */
const FAULT_ROUTE_TIMEOUTS = { firstTokenTimeoutMs: 2000, totalTimeoutMs: 5000 };

/** The kinds of fault fake-upstream.js knows. */
const FAULT_KINDS = ["5xx", "429", "timeout", "reset", "midstream", "malformed", "flap"];
/** The kinds that make sense to fall back from: not a lone broken stream. */
const FAILOVER_KINDS = ["5xx", "429", "timeout", "reset", "flap"];

const pool = new Pool({ connectionString: required("DATABASE_URL") });
try {
  const db = drizzle({ client: pool });
  await db.transaction(async (tx) => {
    /** A Provider at the fake upstream with one account and one Upstream Model; returns the Upstream Model's id. */
    async function addProvider(
      slug: string,
      speaks: Speaks,
      path: string,
      contextSize: number,
      accounts = ACCOUNTS_PER_PROVIDER,
    ): Promise<string> {
      const [provider] = await tx
        .insert(providers)
        .values({
          slug,
          name: slug,
          endpoints: [
            { kind: "chat", protocol: speaks.protocol, baseUrl: `${upstreamOrigin}${path}/v1` },
          ],
          authStyle: speaks.authStyle,
        })
        .returning({ id: providers.id });
      for (let priority = 0; priority < accounts; priority++) {
        const upstreamKey = `sk-perf-${slug}-${priority}-0123456789`;
        await tx.insert(providerAccounts).values({
          providerId: provider.id,
          name: `account ${priority}`,
          encryptedKey: cipher.encrypt(upstreamKey),
          keyLastFour: upstreamKey.slice(-4),
          priority,
        });
      }
      const [upstreamModel] = await tx
        .insert(upstreamModels)
        .values({
          providerId: provider.id,
          upstreamModelId: "perf-upstream-model",
          capabilities: ["tools"],
          contextSize,
        })
        .returning({ id: upstreamModels.id });
      return upstreamModel.id;
    }

    async function addModel(name: string): Promise<string> {
      const [model] = await tx.insert(models).values({ name }).returning({ id: models.id });
      return model.id;
    }

    async function addRoute(
      modelId: string,
      upstreamModelId: string,
      priority: number,
      timeouts: { firstTokenTimeoutMs?: number; totalTimeoutMs?: number } = {},
    ): Promise<void> {
      await tx.insert(routes).values({ modelId, upstreamModelId, priority, ...timeouts });
    }

    /** One Model with one Route to a Provider of its own. */
    async function simpleModel(
      name: string,
      speaks: Speaks,
      path: string,
      contextSize = DEFAULT_CONTEXT,
      timeouts?: { firstTokenTimeoutMs?: number; totalTimeoutMs?: number },
      accounts = ACCOUNTS_PER_PROVIDER,
    ): Promise<void> {
      const modelId = await addModel(name);
      const upstreamModelId = await addProvider(name, speaks, path, contextSize, accounts);
      await addRoute(modelId, upstreamModelId, 0, timeouts);
    }

    await simpleModel("perf-chat", OPENAI_CHAT, "/paced");
    await simpleModel("perf-messages", ANTHROPIC_MESSAGES, "/paced");
    await simpleModel("perf-responses", OPENAI_RESPONSES, "/paced");
    await simpleModel("perf-large", OPENAI_CHAT, "/paced", LARGE_CONTEXT);

    await simpleModel("raw-chat", OPENAI_CHAT, "/instant");
    await simpleModel("raw-messages", ANTHROPIC_MESSAGES, "/instant");
    await simpleModel("raw-responses", OPENAI_RESPONSES, "/instant");

    for (const kind of FAULT_KINDS) {
      await simpleModel(
        `fault-${kind}`,
        OPENAI_CHAT,
        `/fault/${kind}`,
        DEFAULT_CONTEXT,
        FAULT_ROUTE_TIMEOUTS,
        1,
      );
    }
    for (const kind of FAILOVER_KINDS) {
      const modelId = await addModel(`failover-${kind}`);
      const broken = await addProvider(
        `failover-${kind}-primary`,
        OPENAI_CHAT,
        `/fault/${kind}`,
        DEFAULT_CONTEXT,
        1,
      );
      await addRoute(modelId, broken, 0, FAULT_ROUTE_TIMEOUTS);
      const backup = await addProvider(
        `failover-${kind}-backup`,
        OPENAI_CHAT,
        "/paced",
        DEFAULT_CONTEXT,
      );
      await addRoute(modelId, backup, 1);
    }

    await tx.insert(apiKeys).values({
      name: "k6",
      keyId: keyMatch[1],
      hash: createHash("sha256").update(apiKey).digest("base64url"),
    });
  });
  console.log("Seeded the k6 Models and API Key");
} finally {
  await pool.end();
}
