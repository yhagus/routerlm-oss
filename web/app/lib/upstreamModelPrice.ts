import type { ModelKind, UpstreamModel } from '~/lib/upstream';
import { rangeOf } from '~/lib/upstreamModelStacks';
import { type DetailLine, unitPriceFormat, unitPriceLines } from '~/lib/upstreamModelMedia';

export interface PriceSummary {
  value: string;
  unit: string;
  lines: DetailLine[];
}

const tokenPriceFormat = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  minimumFractionDigits: 0,
  maximumFractionDigits: 4,
});

const PRICE_UNITS: Record<ModelKind, string> = {
  chat: 'in / out per 1M tokens',
  image: 'per image',
  video: 'per second',
  speech: 'per 1M characters',
  transcription: 'per audio second',
};

function compareNumbers(first: number, second: number): number {
  return first - second;
}

function formatRange(values: (number | null)[], format: Intl.NumberFormat): string | null {
  const range = rangeOf(values, compareNumbers);
  if (range === null) return null;
  const min = format.format(range.min);
  const max = format.format(range.max);
  return min === max ? min : `${min}–${max}`;
}

function outputUnitPrices(model: UpstreamModel): (number | null)[] {
  switch (model.kind) {
    case 'image':
      return [model.pricePerImage, ...Object.values(model.pricePerImageBySize ?? {})];
    case 'video':
      return Object.values(model.pricePerSecondByResolution ?? {});
    case 'speech':
      return [model.pricePerMillionCharacters];
    case 'transcription':
      return [model.pricePerAudioSecond];
    case 'chat':
      return [];
  }
}

function tokenPriceLines(model: UpstreamModel): DetailLine[] {
  return [
    { label: 'Input', price: model.inputPrice },
    { label: 'Output', price: model.outputPrice },
    { label: 'Cache read', price: model.cacheReadPrice },
    { label: 'Cache write', price: model.cacheWritePrice },
  ].flatMap(({ label, price }) =>
    price === null
      ? []
      : [{ label: `${label} per 1M tokens`, value: tokenPriceFormat.format(price) }],
  );
}

export function priceSummary(
  models: readonly UpstreamModel[],
  kind: ModelKind,
): PriceSummary | null {
  const single = models.length === 1 ? models[0] : undefined;
  if (kind === 'chat') {
    const input = formatRange(
      models.map((model) => model.inputPrice),
      tokenPriceFormat,
    );
    const output = formatRange(
      models.map((model) => model.outputPrice),
      tokenPriceFormat,
    );
    if (input === null && output === null) return null;
    return {
      value: `${input ?? '—'} / ${output ?? '—'}`,
      unit: PRICE_UNITS.chat,
      lines: single ? tokenPriceLines(single) : [],
    };
  }
  const value = formatRange(models.flatMap(outputUnitPrices), unitPriceFormat);
  if (value === null) return null;
  return { value, unit: PRICE_UNITS[kind], lines: single ? unitPriceLines(single) : [] };
}
