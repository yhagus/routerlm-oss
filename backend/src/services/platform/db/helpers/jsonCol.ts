export function parseJson(str: any, fallback: any = null) {
  if (str == null) return fallback;
  if (typeof str !== "string") return str;
  try { return JSON.parse(str); } catch { return fallback; }
}

export function stringifyJson(value: any) {
  return JSON.stringify(value ?? null);
}
