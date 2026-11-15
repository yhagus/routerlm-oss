import { getQueueToken } from "@nestjs/bullmq";
import { getDrizzleToken } from "@nestjs/drizzle";
import { Test, type TestingModule } from "@nestjs/testing";
import type { Queue } from "bullmq";
import { eq } from "drizzle-orm";
import type { Database } from "@/db/schemas/relations.js";
import { type QuotaReaderName, providerAccounts, providers } from "@/db/schemas/index.js";
import { ProviderKeyCipher } from "@/upstream/providers/provider-key-cipher.js";
import { FakeUpstream } from "../support/fake-upstream.js";
import { remainsAtPercentReply } from "../support/minimax-m-plan-remains.js";
import { deleteAllUpstreamData } from "../support/upstream.js";

// Needs Redis at REDIS_URL, in its own database (see tests/usage/records.test.ts).
const redisUrl = new URL(process.env.REDIS_URL ?? "redis://localhost:6379");
redisUrl.pathname = `/${(process.pid % 15) + 1}`;
process.env.REDIS_URL = redisUrl.toString();
const fakeUpstream = await FakeUpstream.start();
process.env.MINIMAX_M_PLAN_QUOTA_BASE_URL = fakeUpstream.baseUrl;
const { WorkerModule } = await import("@/worker.module.js");
const { QUOTA_METERS_QUEUE } = await import("@/queue/models/queue-names.js");
const { QuotaReadingSchedule, QUOTA_READING_SCHEDULER } =
  await import("@/quota-meters/jobs/quota-reading-schedule.js");

const NOW = new Date("2026-11-15T12:00:00Z");
const MINUTE_MS = 60 * 1000;

function minutesAfter(time: Date, minutes: number): Date {
  return new Date(time.getTime() + minutes * MINUTE_MS);
}

describe("Scheduled Quota Meter readings (e2e)", () => {
  let worker: TestingModule;
  let db: Database;
  const keyCipher = new ProviderKeyCipher(process.env.ENCRYPTION_KEY ?? "");

  beforeAll(async () => {
    worker = await Test.createTestingModule({ imports: [WorkerModule] }).compile();
    await worker.init();
    db = worker.get<Database>(getDrizzleToken());
  });

  beforeEach(async () => {
    fakeUpstream.reset();
    await deleteAllUpstreamData(db);
  });

  afterAll(async () => {
    await worker.get<Queue>(getQueueToken(QUOTA_METERS_QUEUE)).obliterate({ force: true });
    await worker.close();
    await fakeUpstream.close();
  });

  async function insertAccount(
    quotaReader: QuotaReaderName | null,
    fields: { isEnabled?: boolean } = {},
  ): Promise<string> {
    const [provider] = await db
      .insert(providers)
      .values({
        slug: `plan-${quotaReader ?? "none"}`,
        name: "Plan",
        protocol: "anthropic-messages",
        baseUrl: "https://api.plan.example/anthropic",
        authStyle: "bearer",
        quotaReader,
      })
      .onConflictDoUpdate({ target: providers.slug, set: { name: "Plan" } })
      .returning({ id: providers.id });
    const [account] = await db
      .insert(providerAccounts)
      .values({
        providerId: provider.id,
        name: `Account ${Math.random()}`,
        encryptedKey: keyCipher.encrypt("sk-cp-0123456789abcdef"),
        keyLastFour: "cdef",
        ...fields,
      })
      .returning({ id: providerAccounts.id });
    return account.id;
  }

  function readDueAccounts(now: Date): Promise<void> {
    return worker.get(QuotaReadingSchedule).readDueProviderAccounts(now);
  }

  it("schedules the repeating reading job when the worker starts", async () => {
    const queue = worker.get<Queue>(getQueueToken(QUOTA_METERS_QUEUE));

    expect(await queue.getJobScheduler(QUOTA_READING_SCHEDULER)).toBeTruthy();
  });

  it("reads enabled accounts at Providers with a reader, and no others", async () => {
    const readAccountId = await insertAccount("minimax-m-plan");
    await insertAccount("minimax-m-plan", { isEnabled: false });
    await insertAccount(null);
    fakeUpstream.reply(remainsAtPercentReply(50));

    await readDueAccounts(NOW);

    expect(fakeUpstream.requests).toHaveLength(1);
    const [account] = await db
      .select({ quotaCheckedAt: providerAccounts.quotaCheckedAt })
      .from(providerAccounts)
      .where(eq(providerAccounts.id, readAccountId));
    expect(account.quotaCheckedAt).not.toBeNull();
  });

  it("reads every minute while a meter is below 10%, and every 5 minutes once it recovers", async () => {
    const accountId = await insertAccount("minimax-m-plan");
    fakeUpstream.reply(remainsAtPercentReply(8));
    await readDueAccounts(NOW);
    const lowReadingAt = await quotaCheckedAtOf(accountId);

    fakeUpstream.reply(remainsAtPercentReply(50));
    await readDueAccounts(minutesAfter(lowReadingAt, 1));
    const recoveredAt = await quotaCheckedAtOf(accountId);
    await readDueAccounts(minutesAfter(recoveredAt, 1));
    expect(fakeUpstream.requests).toHaveLength(2);

    fakeUpstream.reply(remainsAtPercentReply(50));
    await readDueAccounts(minutesAfter(recoveredAt, 5));
    expect(fakeUpstream.requests).toHaveLength(3);
  });

  async function quotaCheckedAtOf(providerAccountId: string): Promise<Date> {
    const [account] = await db
      .select({ quotaCheckedAt: providerAccounts.quotaCheckedAt })
      .from(providerAccounts)
      .where(eq(providerAccounts.id, providerAccountId));
    if (!account.quotaCheckedAt) {
      throw new Error("The account was never read");
    }
    return account.quotaCheckedAt;
  }
});
