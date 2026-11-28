import { CommandBus } from '@nestjs/cqrs';
import type { NestNodeApplication } from '@nestjs/platform-node';
import { Test, type TestingModule } from '@nestjs/testing';
import { and, eq } from 'drizzle-orm';
import request from 'supertest';
import { CatalogSeedModule } from '@/catalog/catalog-seed.module';
import { SeedCatalogCommand } from '@/catalog/commands/impl/seed-catalog.command';
import { CATALOG_DIRECTORY, loadCatalog } from '@/catalog/models/load-catalog';
import type { CatalogProvider } from '@/catalog/schemas/catalog.schema';
import type { Database } from '@/db/schemas/relations';
import { providers, upstreamModels } from '@/db/schemas';
import { FakeUpstream } from '@tests/support/fake-upstream';
import { addProviderAccount } from '@tests/support/inference';
import { createTestApp, setUpFirstUser } from '@tests/support/test-app';
import {
  FREE_TIER_PATH,
  freeTierReply,
  MODELS_PATH,
  modelsReply,
} from '@tests/support/tokenharbor-plans';
import { deleteAllUpstreamData } from '@tests/support/upstream';

const OPERATOR = { email: 'ops@example.com', password: 'ops password' };
const ACCOUNT_KEY = 'th-account-key-0123456789';
const COVERED_MODEL = 'glm-5.3';

describe('Re-seeding the Catalog over read Plan Coverage (e2e)', () => {
  let app: NestNodeApplication;
  let db: Database;
  let seedModule: TestingModule;
  let tokenHarbor: FakeUpstream;
  let catalogTokenHarbor: CatalogProvider;

  beforeAll(async () => {
    ({ app, db } = await createTestApp());
    seedModule = await Test.createTestingModule({ imports: [CatalogSeedModule] }).compile();
    await seedModule.init();
    tokenHarbor = await FakeUpstream.start();
    const catalog = await loadCatalog(CATALOG_DIRECTORY);
    const shipped = catalog.find((provider) => provider.slug === 'tokenharbor');
    if (!shipped) throw new Error('the Catalog has no TokenHarbor Provider');
    catalogTokenHarbor = shipped;
  });

  afterAll(async () => {
    await tokenHarbor.close();
    await seedModule.close();
    await app.close();
  });

  function seed() {
    return seedModule.get(CommandBus).execute(new SeedCatalogCommand([catalogTokenHarbor]));
  }

  it('keeps the coverage and when it was read', async () => {
    await deleteAllUpstreamData(app);
    const cookie = await setUpFirstUser(app, OPERATOR);
    await seed();
    const [provider] = await db
      .update(providers)
      .set({
        endpoints: [{ kind: 'chat', protocol: 'openai-chat', baseUrl: tokenHarbor.baseUrl }],
      })
      .where(eq(providers.slug, 'tokenharbor'))
      .returning({ id: providers.id });
    const accountId = await addProviderAccount(app, db, provider.id, {
      key: ACCOUNT_KEY,
      priority: 0,
    });
    tokenHarbor.replyTo(FREE_TIER_PATH, freeTierReply('Agent Pass'));
    tokenHarbor.replyTo(
      MODELS_PATH,
      modelsReply([{ id: COVERED_MODEL, coveredByPlans: ['Agent Pass'] }]),
    );
    await request(app.getHttpServer())
      .post(`/api/provider-accounts/${accountId}/plan`)
      .set('Cookie', cookie)
      .expect(200);
    const coverageOf = async () => {
      const [model] = await db
        .select({
          planCoverage: upstreamModels.planCoverage,
          planCoverageCheckedAt: upstreamModels.planCoverageCheckedAt,
        })
        .from(upstreamModels)
        .where(
          and(
            eq(upstreamModels.providerId, provider.id),
            eq(upstreamModels.upstreamModelId, COVERED_MODEL),
          ),
        );
      return model;
    };
    const readCoverage = await coverageOf();

    await seed();

    expect(readCoverage.planCoverage).toEqual(['Agent Pass']);
    expect(await coverageOf()).toEqual(readCoverage);
  });
});
