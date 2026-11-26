import { CATALOG_DIRECTORY, loadCatalog } from '@/catalog/models/load-catalog';

describe('The Plans the Catalog lists', () => {
  async function shipped(slug: string) {
    const catalog = await loadCatalog(CATALOG_DIRECTORY);
    const provider = catalog.find((entry) => entry.slug === slug);
    if (!provider) throw new Error(`the Catalog has no ${slug} Provider`);
    return provider;
  }

  async function planNamesOf(slug: string): Promise<string[] | undefined> {
    const provider = await shipped(slug);
    return provider.plans?.map((plan) => plan.name);
  }

  it('lists the TokenHarbor Passes under their own names and offers None', async () => {
    const provider = await shipped('tokenharbor');

    expect(provider.plans).toEqual([
      { value: 'Agent Pass', name: 'Agent Pass' },
      { value: 'Office Pass', name: 'Office Pass' },
      { value: 'Frontier Pass', name: 'Frontier Pass' },
    ]);
    expect(provider.allowsNoPlan).toBe(true);
  });

  it('lists the ChatGPT plans under the plan type Codex reports', async () => {
    const provider = await shipped('openai-codex');

    expect(provider.plans).toEqual([
      { value: 'free', name: 'Free' },
      { value: 'go', name: 'Go' },
      { value: 'plus', name: 'Plus' },
      { value: 'prolite', name: 'Pro' },
      { value: 'pro', name: 'Pro (More)' },
      { value: 'promax', name: 'Pro (Max)' },
      { value: 'team', name: 'Team' },
      { value: 'business', name: 'Business' },
    ]);
    expect(provider.allowsNoPlan).toBeUndefined();
  });

  it('lists the tiers of the Providers no reader sees', async () => {
    expect({
      opencodeGo: await planNamesOf('opencode-go'),
      kimiCode: await planNamesOf('kimi-code'),
      minimaxMPlan: await planNamesOf('minimax-m-plan'),
      zaiCodingPlan: await planNamesOf('zai-coding-plan'),
      alibabaTokenPlan: await planNamesOf('alibaba-token-plan'),
      xiaomiMimoTokenPlan: await planNamesOf('xiaomi-mimo-token-plan'),
    }).toEqual({
      opencodeGo: ['Go', 'Go Plus', 'Go Teams'],
      kimiCode: ['Plus', 'Pro', 'Andante', 'Moderato', 'Allegretto'],
      minimaxMPlan: ['Go', 'Explore', 'Build'],
      zaiCodingPlan: ['Lite', 'Pro', 'Max', 'Team'],
      alibabaTokenPlan: [
        'Lite',
        'Essential',
        'Standard',
        'Pro',
        'Team Standard',
        'Team Advanced',
        'Team Premium',
      ],
      xiaomiMimoTokenPlan: [
        'Lite',
        'Standard',
        'Pro',
        'Max',
        'Team Standard',
        'Team Pro',
        'Team Max',
      ],
    });
  });
});
