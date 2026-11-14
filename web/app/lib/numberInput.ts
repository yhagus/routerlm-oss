// Number fields show digits in groups of three, split by a punctuation space
// (1 048 576), with "." as the decimal point. Plus Jakarta Sans draws the narrow
// no-break space about 1px wide, too thin to read as a gap. The value a field
// holds is the plain number as a string ("1048576", "0.15", or "" when empty).

export const GROUP_SEPARATOR = "\u2008";

/** Grouping marks people type or paste: spaces of any width, apostrophes, underscores. */
const GROUPING_MARKS = /[\s\u00a0\u202f'\u2019_]/g;
const SHORTHAND = /^(.*?)\s*([km])$/i;
const SHORTHAND_FACTOR: Record<string, number> = { k: 1_000, m: 1_000_000 };

export interface NumberInputRules {
  /** Whole numbers only: a typed "." is dropped. */
  isWhole?: boolean;
  /** Accepts 128k and 1m. */
  allowsShorthand?: boolean;
}

/** Commas are grouping in "1,048,576" or beside a ".", and a decimal point otherwise ("0,15"). */
function normalizeCommas(text: string): string {
  if (!text.includes(",")) return text;
  if (text.includes(".") || /^-?\d{1,3}(,\d{3})+$/.test(text)) return text.replaceAll(",", "");
  return text.replaceAll(",", ".");
}

/**
 * Keeps a sign, digits and one decimal point. Leading zeros stay: deleting
 * the 1 of "1 000 000" to retype it must not collapse the field to "0".
 */
function cleanDigits(text: string, isWhole: boolean): string {
  const isNegative = text.startsWith("-");
  const [first = "", ...fractionParts] = text.replace(/[^\d.]/g, "").split(".");
  const fraction = fractionParts.join("");
  const hasPoint = !isWhole && text.includes(".");
  const whole = hasPoint && first === "" ? "0" : first;
  const digits = hasPoint ? `${whole}.${fraction}` : whole;
  return isNegative ? `-${digits}` : digits;
}

/** What a field holds for what was typed or pasted. */
export function parseNumberInput(text: string, rules: NumberInputRules = {}): string {
  let value = normalizeCommas(text.trim().replace(GROUPING_MARKS, ""));
  const shorthand = rules.allowsShorthand ? SHORTHAND.exec(value) : null;
  if (shorthand) {
    const [, amount = "", suffix = ""] = shorthand;
    const base = Number(cleanDigits(amount, false));
    const factor = SHORTHAND_FACTOR[suffix.toLowerCase()] ?? 1;
    if (amount !== "" && Number.isFinite(base)) return String(Math.round(base * factor));
    value = amount;
  }
  return cleanDigits(value, rules.isWhole ?? false);
}

/** A held value as the field shows it: 1048576 → "1 048 576", "0." stays "0." while typing. */
export function formatNumberInput(value: string): string {
  if (value === "") return "";
  const isNegative = value.startsWith("-");
  const [whole = "", fraction] = value.replace("-", "").split(".");
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, GROUP_SEPARATOR);
  const shown = fraction === undefined ? grouped : `${grouped}.${fraction}`;
  return isNegative ? `-${shown}` : shown;
}

/** How many digits, signs and points sit before `position` in `text`; separators don't count. */
export function significantCharsBefore(text: string, position: number): number {
  return text.slice(0, position).replace(/[^\d.-]/g, "").length;
}

/** The position in `text` just after its `count`th digit, sign or point. */
export function positionAfterSignificantChars(text: string, count: number): number {
  if (count === 0) return 0;
  let seen = 0;
  for (let index = 0; index < text.length; index += 1) {
    if (/[\d.-]/.test(text.charAt(index))) seen += 1;
    if (seen === count) return index + 1;
  }
  return text.length;
}
