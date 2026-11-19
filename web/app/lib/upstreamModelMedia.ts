// The unit prices and limits of the media Kinds, as the Upstream Model form edits
// them and as the details dialog lists them. Chat keeps its token prices elsewhere.

import {
  type ModelKind,
  numberField,
  optionalNumber,
  type PricesByTier,
  type UpstreamModel,
} from "~/lib/upstream";

/** Number inputs hold a number, or "" when empty. */
type NumberInput = number | string;

/** Prices that depend on a tier the Provider names: the tiers in order, and a price for each. */
export interface TierPriceForm {
  tiers: string[];
  /** Keyed by tier; a tier without a typed price is left out. */
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

/** The fields of `POST /upstream-models` and `PATCH /upstream-models/:id` this form owns. */
export type MediaFields = Pick<
  UpstreamModel,
  | "pricePerImage"
  | "pricePerImageBySize"
  | "pricePerInputImage"
  | "pricePerSecondByResolution"
  | "pricePerMillionCharacters"
  | "pricePerAudioSecond"
  | "maxInputImages"
  | "minDurationSeconds"
  | "maxDurationSeconds"
  | "resolutions"
  | "sizes"
>;

function tierPriceForm(prices: PricesByTier | null): TierPriceForm {
  return { tiers: Object.keys(prices ?? {}), prices: { ...prices } };
}

/** The form for a new Upstream Model (no `model`) or prefilled from an existing one. */
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

/** The typed prices of the listed tiers; null when none was typed. */
function pricesByTierFromForm(form: TierPriceForm): PricesByTier | null {
  const prices: PricesByTier = {};
  for (const tier of form.tiers) {
    const price = optionalNumber(form.prices[tier] ?? "");
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

/**
 * Every media field, with only those of `kind` taken from the form: the
 * others are cleared, so switching Kind leaves no stale prices behind.
 */
export function mediaFieldsFromForm(form: MediaForm, kind: ModelKind): MediaFields {
  switch (kind) {
    case "image":
      return {
        ...NO_MEDIA_FIELDS,
        pricePerImage: optionalNumber(form.pricePerImage),
        pricePerImageBySize: pricesByTierFromForm(form.pricePerImageBySize),
        pricePerInputImage: optionalNumber(form.pricePerInputImage),
        maxInputImages: optionalNumber(form.maxInputImages),
        sizes: listOrNull(form.sizes),
      };
    case "video":
      return {
        ...NO_MEDIA_FIELDS,
        pricePerSecondByResolution: pricesByTierFromForm(form.pricePerSecondByResolution),
        maxInputImages: optionalNumber(form.maxInputImages),
        minDurationSeconds: optionalNumber(form.minDurationSeconds),
        maxDurationSeconds: optionalNumber(form.maxDurationSeconds),
        resolutions: listOrNull(form.resolutions),
      };
    case "speech":
      return {
        ...NO_MEDIA_FIELDS,
        pricePerMillionCharacters: optionalNumber(form.pricePerMillionCharacters),
      };
    case "transcription":
      return { ...NO_MEDIA_FIELDS, pricePerAudioSecond: optionalNumber(form.pricePerAudioSecond) };
    case "chat":
      return NO_MEDIA_FIELDS;
  }
}

/** Unit prices run to eight decimals: a price per audio second is a tiny number. */
export const unitPriceFormat = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 0,
  maximumFractionDigits: 8,
});

/** One line of the details dialog, such as "Per image" and "$0.04". */
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

/** The unit prices a media Upstream Model publishes; empty for chat or when none is known. */
export function unitPriceLines(model: UpstreamModel): DetailLine[] {
  switch (model.kind) {
    case "image":
      return [
        ...priceLine("Per image", model.pricePerImage),
        ...tierLines(model.pricePerImageBySize, "image"),
        ...priceLine("Per input image", model.pricePerInputImage),
      ];
    case "video":
      return tierLines(model.pricePerSecondByResolution, "per second");
    case "speech":
      return priceLine("Per 1M characters", model.pricePerMillionCharacters);
    case "transcription":
      return priceLine("Per audio second", model.pricePerAudioSecond);
    case "chat":
      return [];
  }
}

function countLine(label: string, count: number | null, unit: string): DetailLine[] {
  return count === null ? [] : [{ label, value: `${count} ${unit}` }];
}

function listLine(label: string, values: string[] | null): DetailLine[] {
  return values === null || values.length === 0 ? [] : [{ label, value: values.join(", ") }];
}

/** The limits a media Upstream Model publishes; empty for chat or when none is known. */
export function mediaLimitLines(model: UpstreamModel): DetailLine[] {
  return [
    ...countLine("Max input images", model.maxInputImages, "images"),
    ...countLine("Shortest video", model.minDurationSeconds, "s"),
    ...countLine("Longest video", model.maxDurationSeconds, "s"),
    ...listLine("Resolutions", model.resolutions),
    ...listLine("Sizes", model.sizes),
  ];
}
