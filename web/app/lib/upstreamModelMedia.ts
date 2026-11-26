import {
  type ModelKind,
  numberField,
  optionalNumber,
  type PricesByTier,
  type UpstreamModel,
} from '~/lib/upstream';

type NumberInput = number | string;

export interface TierPriceForm {
  tiers: string[];
  prices: Record<string, NumberInput>;
}

export interface MediaForm {
  pricePerImage: NumberInput;
  pricePerImageBySize: TierPriceForm;
  pricePerInputImage: NumberInput;
  pricePerSecondByResolution: TierPriceForm;
  pricePerMillionCharacters: NumberInput;
  pricePerAudioSecond: NumberInput;
  maxInputImages: NumberInput;
  minDurationSeconds: NumberInput;
  maxDurationSeconds: NumberInput;
  resolutions: string[];
  sizes: string[];
}

export type MediaFields = Pick<
  UpstreamModel,
  | 'pricePerImage'
  | 'pricePerImageBySize'
  | 'pricePerInputImage'
  | 'pricePerSecondByResolution'
  | 'pricePerMillionCharacters'
  | 'pricePerAudioSecond'
  | 'maxInputImages'
  | 'minDurationSeconds'
  | 'maxDurationSeconds'
  | 'resolutions'
  | 'sizes'
>;

function tierPriceForm(prices: PricesByTier | null): TierPriceForm {
  return { tiers: Object.keys(prices ?? {}), prices: { ...prices } };
}

export function mediaFormFor(model?: UpstreamModel): MediaForm {
  return {
    pricePerImage: numberField(model?.pricePerImage ?? null),
    pricePerImageBySize: tierPriceForm(model?.pricePerImageBySize ?? null),
    pricePerInputImage: numberField(model?.pricePerInputImage ?? null),
    pricePerSecondByResolution: tierPriceForm(model?.pricePerSecondByResolution ?? null),
    pricePerMillionCharacters: numberField(model?.pricePerMillionCharacters ?? null),
    pricePerAudioSecond: numberField(model?.pricePerAudioSecond ?? null),
    maxInputImages: numberField(model?.maxInputImages ?? null),
    minDurationSeconds: numberField(model?.minDurationSeconds ?? null),
    maxDurationSeconds: numberField(model?.maxDurationSeconds ?? null),
    resolutions: [...(model?.resolutions ?? [])],
    sizes: [...(model?.sizes ?? [])],
  };
}

function pricesByTierFromForm(form: TierPriceForm): PricesByTier | null {
  const prices: PricesByTier = {};
  for (const tier of form.tiers) {
    const price = optionalNumber(form.prices[tier] ?? '');
    if (price !== null) prices[tier] = price;
  }
  return Object.keys(prices).length > 0 ? prices : null;
}

function listOrNull(values: string[]): string[] | null {
  return values.length > 0 ? [...values] : null;
}

const NO_MEDIA_FIELDS: MediaFields = {
  pricePerImage: null,
  pricePerImageBySize: null,
  pricePerInputImage: null,
  pricePerSecondByResolution: null,
  pricePerMillionCharacters: null,
  pricePerAudioSecond: null,
  maxInputImages: null,
  minDurationSeconds: null,
  maxDurationSeconds: null,
  resolutions: null,
  sizes: null,
};

export function mediaFieldsFromForm(form: MediaForm, kind: ModelKind): MediaFields {
  switch (kind) {
    case 'image':
      return {
        ...NO_MEDIA_FIELDS,
        pricePerImage: optionalNumber(form.pricePerImage),
        pricePerImageBySize: pricesByTierFromForm(form.pricePerImageBySize),
        pricePerInputImage: optionalNumber(form.pricePerInputImage),
        maxInputImages: optionalNumber(form.maxInputImages),
        sizes: listOrNull(form.sizes),
      };
    case 'video':
      return {
        ...NO_MEDIA_FIELDS,
        pricePerSecondByResolution: pricesByTierFromForm(form.pricePerSecondByResolution),
        maxInputImages: optionalNumber(form.maxInputImages),
        minDurationSeconds: optionalNumber(form.minDurationSeconds),
        maxDurationSeconds: optionalNumber(form.maxDurationSeconds),
        resolutions: listOrNull(form.resolutions),
      };
    case 'speech':
      return {
        ...NO_MEDIA_FIELDS,
        pricePerMillionCharacters: optionalNumber(form.pricePerMillionCharacters),
      };
    case 'transcription':
      return { ...NO_MEDIA_FIELDS, pricePerAudioSecond: optionalNumber(form.pricePerAudioSecond) };
    case 'chat':
      return NO_MEDIA_FIELDS;
  }
}

export const unitPriceFormat = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  minimumFractionDigits: 0,
  maximumFractionDigits: 8,
});

export interface DetailLine {
  label: string;
  value: string;
}

function tierLines(prices: PricesByTier | null, unit: string): DetailLine[] {
  return Object.entries(prices ?? {}).map(([tier, price]) => ({
    label: `${tier} ${unit}`,
    value: unitPriceFormat.format(price),
  }));
}

function priceLine(label: string, price: number | null): DetailLine[] {
  return price === null ? [] : [{ label, value: unitPriceFormat.format(price) }];
}

export function unitPriceLines(model: UpstreamModel): DetailLine[] {
  switch (model.kind) {
    case 'image':
      return [
        ...priceLine('Per image', model.pricePerImage),
        ...tierLines(model.pricePerImageBySize, 'image'),
        ...priceLine('Per input image', model.pricePerInputImage),
      ];
    case 'video':
      return tierLines(model.pricePerSecondByResolution, 'per second');
    case 'speech':
      return priceLine('Per 1M characters', model.pricePerMillionCharacters);
    case 'transcription':
      return priceLine('Per audio second', model.pricePerAudioSecond);
    case 'chat':
      return [];
  }
}

function countLine(label: string, count: number | null, unit: string): DetailLine[] {
  return count === null ? [] : [{ label, value: `${count} ${unit}` }];
}

function listLine(label: string, values: string[] | null): DetailLine[] {
  return values === null || values.length === 0 ? [] : [{ label, value: values.join(', ') }];
}

export function mediaLimitLines(model: UpstreamModel): DetailLine[] {
  return [
    ...countLine('Max input images', model.maxInputImages, 'images'),
    ...countLine('Shortest video', model.minDurationSeconds, 's'),
    ...countLine('Longest video', model.maxDurationSeconds, 's'),
    ...listLine('Resolutions', model.resolutions),
    ...listLine('Sizes', model.sizes),
  ];
}
