import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CATALOG_DIRECTORY, loadCatalog } from '@/catalog/models/load-catalog';

interface CatalogFile {
  endpoints: { kind: string; protocol: string; baseUrl: string }[];
  upstreamModels: { upstreamModelId: string; protocols?: string[] }[];
}

describe("Catalog rules for an Upstream Model's Protocols", () => {
  const directories: string[] = [];
  afterEach(async () => {
    await Promise.all(directories.splice(0).map((d) => rm(d, { recursive: true, force: true })));
  });

  async function load(change: (provider: CatalogFile) => void) {
    const directory = await mkdtemp(join(tmpdir(), 'catalog-protocols-'));
    directories.push(directory);
    const shipped: CatalogFile = JSON.parse(
      await readFile(join(CATALOG_DIRECTORY, 'anthropic.json'), 'utf8'),
    );
    change(shipped);
    await writeFile(join(directory, 'anthropic.json'), JSON.stringify(shipped));
    return loadCatalog(directory);
  }

  it('refuses a listed Protocol the file has no endpoint for, naming the model', async () => {
    await expect(
      load((provider) => {
        provider.upstreamModels[0].protocols = ['openai-responses'];
      }),
    ).rejects.toThrow(
      /lists Protocols openai-responses that the Provider has no chat endpoint for/,
    );
  });

  it('refuses two endpoints of the same Protocol', async () => {
    await expect(
      load((provider) => {
        provider.endpoints.push({ ...provider.endpoints[0], baseUrl: 'https://eu.example.com' });
      }),
    ).rejects.toThrow(/at most one endpoint per Protocol/);
  });
});
