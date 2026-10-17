export const LOCALES = [
  ["en", "English", "🇺🇸"],
  ["vi", "Tiếng Việt", "🇻🇳"],
  ["zh-CN", "简体中文", "🇨🇳"],
  ["zh-TW", "繁體中文", "🇹🇼"],
  ["ja", "日本語", "🇯🇵"],
  ["pt-BR", "Português (Brasil)", "🇧🇷"],
  ["pt-PT", "Português (Portugal)", "🇵🇹"],
  ["ko", "한국어", "🇰🇷"],
  ["es", "Español", "🇪🇸"],
  ["de", "Deutsch", "🇩🇪"],
  ["fr", "Français", "🇫🇷"],
  ["he", "עברית", "🇮🇱"],
  ["ar", "العربية", "🇸🇦"],
  ["ru", "Русский", "🇷🇺"],
  ["pl", "Polski", "🇵🇱"],
  ["cs", "Čeština", "🇨🇿"],
  ["nl", "Nederlands", "🇳🇱"],
  ["tr", "Türkçe", "🇹🇷"],
  ["uk", "Українська", "🇺🇦"],
  ["tl", "Tagalog", "🇵🇭"],
  ["id", "Indonesia", "🇮🇩"],
  ["th", "ไทย", "🇹🇭"],
  ["km", "ខ្មែរ", "🇰🇭"],
  ["hi", "हिन्दी", "🇮🇳"],
  ["bn", "বাংলা", "🇧🇩"],
  ["ur", "اردو", "🇵🇰"],
  ["ro", "Română", "🇷🇴"],
  ["sv", "Svenska", "🇸🇪"],
  ["it", "Italiano", "🇮🇹"],
  ["el", "Ελληνικά", "🇬🇷"],
  ["hu", "Magyar", "🇭🇺"],
  ["fi", "Suomi", "🇫🇮"],
  ["da", "Dansk", "🇩🇰"],
  ["no", "Norsk", "🇳🇴"],
  ["fa", "فارسی", "🇮🇷"],
] as const;

export type Locale = (typeof LOCALES)[number][0];

const localeSet = new Set<string>(LOCALES.map(([id]) => id));

export function normalizeLocale(value: string | null | undefined): Locale {
  const locale = value === "zh" ? "zh-CN" : value || "en";
  return localeSet.has(locale) ? (locale as Locale) : "en";
}

export function localeFromCookie(): Locale {
  const entry = document.cookie
    .split(";")
    .find((item) => item.trim().startsWith("locale="));
  return normalizeLocale(
    entry ? decodeURIComponent(entry.split("=")[1]) : "en",
  );
}

export function localeInfo(locale: Locale) {
  return LOCALES.find(([id]) => id === locale) || LOCALES[0];
}
