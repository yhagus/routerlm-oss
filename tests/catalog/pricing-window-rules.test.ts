import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CATALOG_DIRECTORY, loadCatalog } from '@/catalog/models/load-catalog';

interface CatalogFile {
  slug: string;
  endpoints: { kind: string; protocol: string; baseUrl: string }[];
  pricingWindows: { name: string }[];
  upstreamModels: { kind?: string; windowPrices: { pricingWindow: string }[] }[];
}

async function readDeepSeekFile(): Promise<CatalogFile> {
  return JSON.parse(await readFile(join(CATALOG_DIRECTORY, 'deepseek.json'), 'utf8'));
}

describe('Catalog Pricing Window rules', () => {
  const directories: string[] = [];
  afterEach(async () => {
    await Promise.all(directories.splice(0).map((d) => rm(d, { recursive: true, force: true })));
  });

  async function load(...files: CatalogFile[]) {
    const directory = await mkdtemp(join(tmpdir(), 'catalog-windows-'));
    directories.push(directory);
    await Promise.all(
      files.map((file) => writeFile(join(directory, `${file.slug}.json`), JSON.stringify(file))),
    );
    return loadCatalog(directory);
  }

  it("refuses Window Prices for a Pricing Window the file doesn't define", async () => {
    const file = await readDeepSeekFile();
    file.upstreamModels[0].windowPrices[0].pricingWindow = "Somebody Else's Night";

    await expect(load(file)).rejects.toThrow(
      /deepseek\.json: Upstream Model "deepseek-flash" prices Pricing Window "Somebody Else's Night" that the file doesn't define/,
    );
  });

  it("refuses a Pricing Window listed twice in one model's Window Prices", async () => {
    const file = await readDeepSeekFile();
    const [entry] = file.upstreamModels[0].windowPrices;
    file.upstreamModels[0].windowPrices = [entry, entry];

    await expect(load(file)).rejects.toThrow(
      /upstreamModels\[0\] \(deepseek-flash\)\.windowPrices: List each Pricing Window once/,
    );
  });

  it("refuses Window Prices on a model that isn't chat", async () => {
    const file = await readDeepSeekFile();
    file.endpoints.push({
      kind: 'image',
      protocol: 'dashscope-image',
      baseUrl: 'https://api.deepseek.com/api/v1',
    });
    file.upstreamModels[0].kind = 'image';

    await expect(load(file)).rejects.toThrow(
      /Upstream Model "deepseek-flash" has Window Prices, which only a chat model can have/,
    );
  });

  it('refuses a Pricing Window name defined twice in one file', async () => {
    const file = await readDeepSeekFile();
    file.pricingWindows.push(file.pricingWindows[0]);

    await expect(load(file)).rejects.toThrow(/pricingWindows: Name each Pricing Window once/);
  });

  it('refuses a Pricing Window name another file already defines', async () => {
    const first = await readDeepSeekFile();
    const second = { ...(await readDeepSeekFile()), slug: 'deepseek-mirror' };

    await expect(load(first, second)).rejects.toThrow(
      /Pricing Window "DeepSeek Off-Peak" is already defined by another file/,
    );
  });
});
