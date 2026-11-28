import { getQueueToken } from '@nestjs/bullmq';
import type { NestNodeApplication } from '@nestjs/platform-node';
import { Test, type TestingModule } from '@nestjs/testing';
import type { Queue } from 'bullmq';
import { asc } from 'drizzle-orm';
import request from 'supertest';
import type { Database } from '@/db/schemas/relations';
import { attempts, errorCaptures, usageLogs } from '@/db/schemas';
import { FakeUpstream, openAiChatFixture } from '@tests/support/fake-upstream';
import {
  addProviderAccount,
  insertApiKey,
  insertOpenAiChatModel,
  UPSTREAM_KEY,
} from '@tests/support/inference';
import { deleteAllUpstreamData } from '@tests/support/upstream';
import { untilUsageQueueIsDrained } from '@tests/support/usage-queue';

const redisUrl = new URL(process.env.REDIS_URL ?? 'redis://localhost:6379');
redisUrl.pathname = `/${(process.pid % 15) + 1}`;
process.env.REDIS_URL = redisUrl.toString();
const { createTestApp } = await import('@tests/support/test-app');
const { WorkerModule } = await import('@/worker.module');
const { USAGE_QUEUE } = await import('@/queue/models/queue-names');

const PROMPT_TEXT = 'Which umbrella should I pack for Lisbon?';
const CHAT_REQUEST = { model: 'smart', messages: [{ role: 'user', content: PROMPT_TEXT }] };
const BACKUP_KEY = 'sk-backup-secret-9876543210';
const SESSION_COOKIE = '__Host-sid=dashboard-session';
const WORKER_WRITE_TIMEOUT_MS = 5_000;
const CAPTURED_BODY_LIMIT_BYTES = 256 * 1024;
const QUOTES_BYTES = 2;
const POLL_INTERVAL_MS = 50;

describe('Error Captures written for failed requests (e2e)', () => {
  let app: NestNodeApplication;
  let db: Database;
  let worker: TestingModule;
  let upstream: FakeUpstream;
  let usageQueue: Queue;
  let apiKey: string;
  let providerId: string;

  beforeAll(async () => {
    ({ app, db } = await createTestApp());
    usageQueue = app.get<Queue>(getQueueToken(USAGE_QUEUE));
    await usageQueue.obliterate({ force: true });
    worker = await Test.createTestingModule({ imports: [WorkerModule] }).compile();
    await worker.init();
    upstream = await FakeUpstream.start();
  });

  beforeEach(async () => {
    upstream.reset();
    await untilUsageQueueIsDrained(usageQueue);
    await deleteAllUpstreamData(app, worker);
    ({ providerId } = await insertOpenAiChatModel(app, db, {
      modelName: 'smart',
      baseUrl: upstream.baseUrl,
    }));
    ({ key: apiKey } = await insertApiKey(app, db));
  });

  afterAll(async () => {
    await upstream.close();
    await worker.close();
    await usageQueue.obliterate({ force: true });
    await app.close();
  });

  function chat(body: object, key = apiKey) {
    return request(app.getHttpServer())
      .post('/v1/chat/completions')
      .set('Authorization', `Bearer ${key}`)
      .set('Cookie', SESSION_COOKIE)
      .send(body);
  }

  async function writtenCaptures() {
    const deadline = Date.now() + WORKER_WRITE_TIMEOUT_MS;
    while (Date.now() < deadline) {
      const [usageLog] = await db.select().from(usageLogs);
      if (usageLog) {
        const captures = await db
          .select()
          .from(errorCaptures)
          .orderBy(asc(errorCaptures.createdAt));
        const writtenAttempts = await db.select().from(attempts).orderBy(asc(attempts.startedAt));
        return { usageLog, attempts: writtenAttempts, captures };
      }
      await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
    }
    throw new Error('The worker wrote no Usage Log');
  }

  it("captures a failed Attempt's request and upstream response, with every credential redacted", async () => {
    upstream.reply({
      kind: 'json',
      status: 401,
      body: { error: { message: `Incorrect API key provided: ${UPSTREAM_KEY}` } },
      headers: { 'set-cookie': 'upstream-session=xyz', 'x-echoed-key': UPSTREAM_KEY },
    });

    await chat(CHAT_REQUEST).expect(502);

    const written = await writtenCaptures();
    expect(written.captures).toHaveLength(1);
    const [capture] = written.captures;
    expect(capture).toMatchObject({
      usageLogId: written.usageLog.id,
      attemptId: written.attempts[0].id,
      requestHeaders: expect.objectContaining({
        authorization: '[REDACTED]',
        cookie: '[REDACTED]',
        'content-type': 'application/json',
      }),
      responseHeaders: expect.objectContaining({
        'set-cookie': '[REDACTED]',
        'x-echoed-key': '[REDACTED]',
      }),
    });
    expect(JSON.parse(capture.requestBody)).toEqual(CHAT_REQUEST);
    expect(capture.responseBody).toContain('Incorrect API key provided: [REDACTED]');
    const stored = JSON.stringify(capture);
    expect(stored).not.toContain(apiKey);
    expect(stored).not.toContain(UPSTREAM_KEY);
    expect(stored).not.toContain('dashboard-session');
    expect(stored).not.toContain('upstream-session');
  });

  it('captures the client request alone when the request fails before any Attempt', async () => {
    await chat({ ...CHAT_REQUEST, model: 'missing' }).expect(404);

    const written = await writtenCaptures();
    expect(written.captures).toEqual([
      expect.objectContaining({ attemptId: null, responseHeaders: null, responseBody: null }),
    ]);
    expect(written.captures[0].requestBody).toContain(PROMPT_TEXT);
  });

  it('stores no capture for a successful request', async () => {
    upstream.reply({
      kind: 'json',
      status: 200,
      body: JSON.parse(openAiChatFixture('upstream-response-tool-call.json')),
    });

    await chat(CHAT_REQUEST).expect(200);

    expect((await writtenCaptures()).captures).toEqual([]);
  });

  it('captures a failed Attempt that Fallback recovered from, but not the successful request', async () => {
    await addProviderAccount(app, db, providerId, { key: BACKUP_KEY, priority: 1 });
    upstream.reply({ kind: 'json', status: 429, body: { error: 'slow down' } });
    upstream.reply({
      kind: 'json',
      status: 200,
      body: JSON.parse(openAiChatFixture('upstream-response-tool-call.json')),
    });

    await chat(CHAT_REQUEST).expect(200);

    const written = await writtenCaptures();
    expect(written.captures).toEqual([
      expect.objectContaining({
        attemptId: written.attempts[0].id,
        responseBody: JSON.stringify({ error: 'slow down' }),
      }),
    ]);
  });

  it('redacts the API Key a Messages client sends as x-api-key', async () => {
    await request(app.getHttpServer())
      .post('/v1/messages')
      .set('x-api-key', apiKey)
      .send({
        model: 'missing',
        max_tokens: 64,
        messages: [{ role: 'user', content: PROMPT_TEXT }],
      })
      .expect(404);

    const [capture] = (await writtenCaptures()).captures;
    expect(capture.requestHeaders).toMatchObject({ 'x-api-key': '[REDACTED]' });
  });

  async function capturedUpstreamBodyOf(text: string): Promise<string | null> {
    upstream.reply({ kind: 'json', status: 500, body: text });
    await chat(CHAT_REQUEST).expect(502);
    const [capture] = (await writtenCaptures()).captures;
    return capture.responseBody;
  }

  it('keeps a captured body of exactly 256 KB whole', async () => {
    const text = 'a'.repeat(CAPTURED_BODY_LIMIT_BYTES - QUOTES_BYTES);

    expect(await capturedUpstreamBodyOf(text)).toBe(JSON.stringify(text));
  });

  it('truncates a captured body over 256 KB and says how long it was', async () => {
    const text = 'a'.repeat(CAPTURED_BODY_LIMIT_BYTES + 10 - QUOTES_BYTES);

    const captured = await capturedUpstreamBodyOf(text);

    expect(captured).toBe(
      `"${'a'.repeat(CAPTURED_BODY_LIMIT_BYTES - 1)}` +
        '\n[truncated: 262154 bytes in total, 256 KB kept]',
    );
  });

  it('never cuts a multi-byte character in half when truncating a captured body', async () => {
    const kept = `"${'a'.repeat(CAPTURED_BODY_LIMIT_BYTES - QUOTES_BYTES)}`;
    const text = `${kept.slice(1)}é and more`;

    const captured = await capturedUpstreamBodyOf(text);

    expect(captured?.startsWith(`${kept}\n[truncated:`)).toBe(true);
  });

  it('stores no capture for a request without a valid API Key', async () => {
    await chat(CHAT_REQUEST, 'rlm_not-a-real-key').expect(401);

    expect((await writtenCaptures()).captures).toEqual([]);
  });
});
