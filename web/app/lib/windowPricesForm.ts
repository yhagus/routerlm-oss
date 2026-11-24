import {
  type AttachedPricingWindow,
  type PricingWindow,
  type WindowPrices,
  type WindowPricesStatus,
} from "~/lib/pricingWindows";
import { numberField, optionalNumber } from "~/lib/upstream";
import {
  hasOpenBound,
  mayApplyTogether,
  periodsAround,
  type ValidityPeriod,
  type WindowPricesTiming,
} from "~/lib/validityPeriods";

export interface AttachedWindowForm {
  key: number;
  pricingWindowId: string;
  name: string;
  timeZone: string;
  ranges: PricingWindow["ranges"];
  isEnabled: boolean;
  status: WindowPricesStatus | undefined;
  savedPeriod: ValidityPeriod | undefined;
  validFrom: string;
  validUntil: string;
  prices: Record<keyof WindowPrices, string | number>;
}

let nextFormKey = 0;

function nextKey(): number {
  nextFormKey += 1;
  return nextFormKey;
}

export function attachedWindowFormOf(entry: AttachedPricingWindow): AttachedWindowForm {
  return {
    key: nextKey(),
    pricingWindowId: entry.pricingWindowId,
    name: entry.name,
    timeZone: entry.timeZone,
    ranges: entry.ranges,
    isEnabled: entry.isEnabled,
    status: entry.status,
    savedPeriod: { validFrom: entry.validFrom, validUntil: entry.validUntil },
    validFrom: entry.validFrom ?? "",
    validUntil: entry.validUntil ?? "",
    prices: {
      inputPrice: numberField(entry.inputPrice),
      outputPrice: numberField(entry.outputPrice),
      cacheReadPrice: numberField(entry.cacheReadPrice),
      cacheWritePrice: numberField(entry.cacheWritePrice),
    },
  };
}

export function newAttachedWindowForm(window: PricingWindow): AttachedWindowForm {
  return {
    key: nextKey(),
    pricingWindowId: window.id,
    name: window.name,
    timeZone: window.timeZone,
    ranges: window.ranges,
    isEnabled: window.isEnabled,
    status: undefined,
    savedPeriod: undefined,
    validFrom: "",
    validUntil: "",
    prices: { inputPrice: "", outputPrice: "", cacheReadPrice: "", cacheWritePrice: "" },
  };
}

export function validityPeriodOf(entry: AttachedWindowForm): ValidityPeriod {
  return {
    validFrom: entry.validFrom === "" ? null : entry.validFrom,
    validUntil: entry.validUntil === "" ? null : entry.validUntil,
  };
}

export type WindowPricesBody = { pricingWindowId: string } & WindowPrices & ValidityPeriod;

export function windowPricesBody(entry: AttachedWindowForm): WindowPricesBody {
  return {
    pricingWindowId: entry.pricingWindowId,
    inputPrice: optionalNumber(entry.prices.inputPrice),
    outputPrice: optionalNumber(entry.prices.outputPrice),
    cacheReadPrice: optionalNumber(entry.prices.cacheReadPrice),
    cacheWritePrice: optionalNumber(entry.prices.cacheWritePrice),
    ...validityPeriodOf(entry),
  };
}

export function emptyPeriodEntryOf(
  entries: readonly AttachedWindowForm[],
): AttachedWindowForm | undefined {
  return entries.find(
    (entry) =>
      entry.validFrom !== "" && entry.validUntil !== "" && entry.validFrom >= entry.validUntil,
  );
}

export function splitOpenEndedAround(
  entries: readonly AttachedWindowForm[],
): AttachedWindowForm[] | undefined {
  const cuts = entries.filter(hasNewPeriod);
  const cutKeys = new Set(cuts.map((cut) => cut.key));
  let result = [...entries];
  let hasSplit = false;
  for (const cut of cuts) {
    result = result.flatMap((entry) => {
      if (cutKeys.has(entry.key)) return [entry];
      const pieces = splitPiecesOf(entry, cut);
      if (pieces.length === 0) return [entry];
      hasSplit = true;
      return pieces;
    });
  }
  return hasSplit ? result : undefined;
}

function hasNewPeriod(entry: AttachedWindowForm): boolean {
  if (entry.savedPeriod === undefined) return true;
  const period = validityPeriodOf(entry);
  return (
    period.validFrom !== entry.savedPeriod.validFrom ||
    period.validUntil !== entry.savedPeriod.validUntil
  );
}

function splitPiecesOf(entry: AttachedWindowForm, cut: AttachedWindowForm): AttachedWindowForm[] {
  const entryTiming = timingOf(entry);
  const cutTiming = timingOf(cut);
  if (!hasOpenBound(entryTiming) || !mayApplyTogether(entryTiming, cutTiming)) return [];
  return periodsAround(entryTiming, cutTiming).map((period, index) => ({
    ...entry,
    key: index === 0 ? entry.key : nextKey(),
    status: undefined,
    savedPeriod: index === 0 ? entry.savedPeriod : undefined,
    validFrom: period.validFrom ?? "",
    validUntil: period.validUntil ?? "",
    prices: { ...entry.prices },
  }));
}

function timingOf(entry: AttachedWindowForm): WindowPricesTiming {
  return { timeZone: entry.timeZone, ranges: entry.ranges, ...validityPeriodOf(entry) };
}
