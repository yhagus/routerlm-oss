export const GROUP_SEPARATOR = '\u2008';

const GROUPING_MARKS = /[\s\u00a0\u202f'\u2019_]/g;
const SHORTHAND = /^(.*?)\s*([km])$/i;
const SHORTHAND_FACTOR: Record<string, number> = { k: 1_000, m: 1_000_000 };

export interface NumberInputRules {
  isWhole?: boolean;
  allowsShorthand?: boolean;
}

function normalizeCommas(text: string): string {
  if (!text.includes(',')) return text;
  if (text.includes('.') || /^-?\d{1,3}(,\d{3})+$/.test(text)) return text.replaceAll(',', '');
  return text.replaceAll(',', '.');
}

function cleanDigits(text: string, isWhole: boolean): string {
  const isNegative = text.startsWith('-');
  const [first = '', ...fractionParts] = text.replace(/[^\d.]/g, '').split('.');
  const fraction = fractionParts.join('');
  const hasPoint = !isWhole && text.includes('.');
  const whole = hasPoint && first === '' ? '0' : first;
  const digits = hasPoint ? `${whole}.${fraction}` : whole;
  return isNegative ? `-${digits}` : digits;
}

export function parseNumberInput(text: string, rules: NumberInputRules = {}): string {
  let value = normalizeCommas(text.trim().replace(GROUPING_MARKS, ''));
  const shorthand = rules.allowsShorthand ? SHORTHAND.exec(value) : null;
  if (shorthand) {
    const [, amount = '', suffix = ''] = shorthand;
    const base = Number(cleanDigits(amount, false));
    const factor = SHORTHAND_FACTOR[suffix.toLowerCase()] ?? 1;
    if (amount !== '' && Number.isFinite(base)) return String(Math.round(base * factor));
    value = amount;
  }
  return cleanDigits(value, rules.isWhole ?? false);
}

export function formatNumberInput(value: string): string {
  if (value === '') return '';
  const isNegative = value.startsWith('-');
  const [whole = '', fraction] = value.replace('-', '').split('.');
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, GROUP_SEPARATOR);
  const shown = fraction === undefined ? grouped : `${grouped}.${fraction}`;
  return isNegative ? `-${shown}` : shown;
}

export function significantCharsBefore(text: string, position: number): number {
  return text.slice(0, position).replace(/[^\d.-]/g, '').length;
}

export function positionAfterSignificantChars(text: string, count: number): number {
  if (count === 0) return 0;
  let seen = 0;
  for (let index = 0; index < text.length; index += 1) {
    if (/[\d.-]/.test(text.charAt(index))) seen += 1;
    if (seen === count) return index + 1;
  }
  return text.length;
}
