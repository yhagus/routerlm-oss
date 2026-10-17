import { localeFromCookie } from "@/lib/locales";

let translations: Record<string, string> = {};
// The previous locale's table lets a locale switch recognize text that this
// module translated earlier, so it is not mistaken for new framework output.
let previousTranslations: Record<string, string> = {};
let observer: MutationObserver | null = null;
const originalText = new WeakMap<Text, string>();
const attributes = ["alt", "aria-label", "placeholder", "title"];

function translate(value: string): string {
  return translations[value.trim()] || value;
}

// Vue can rewrite an attribute or text node after this module translated it.
// The stored source is valid only while the DOM still shows that source or a
// translation of it. Otherwise the current value is the new source.
function currentSource(current: string, stored: string | null | undefined) {
  if (stored == null) return current;
  const key = stored.trim();
  return current === stored ||
    current === (translations[key] || stored) ||
    current === (previousTranslations[key] || stored)
    ? stored
    : current;
}

function skip(element: Element | null): boolean {
  return Boolean(element?.closest("[data-i18n-skip]"));
}

function translateAttributes(element: Element) {
  if (skip(element)) return;
  for (const attribute of attributes) {
    const value = element.getAttribute(attribute);
    if (!value?.trim()) continue;
    const key = `data-i18n-original-${attribute}`;
    const source = currentSource(value, element.getAttribute(key));
    if (element.getAttribute(key) !== source) element.setAttribute(key, source);
    const next = translate(source);
    if (next !== value) element.setAttribute(attribute, next);
  }
}

function translateText(node: Text) {
  if (!node.nodeValue?.trim() || skip(node.parentElement)) return;
  const tag = node.parentElement?.tagName.toLowerCase();
  if (
    ["script", "style", "code", "pre", "select", "option", "datalist"].includes(
      tag || "",
    )
  )
    return;
  const current = node.nodeValue ?? "";
  const source = currentSource(current, originalText.get(node));
  originalText.set(node, source);
  const next = translate(source);
  if (next !== current) node.nodeValue = next;
}

function translateElement(root: Node) {
  if (root.nodeType === Node.TEXT_NODE) return translateText(root as Text);
  if (root.nodeType !== Node.ELEMENT_NODE) return;
  const element = root as Element;
  translateAttributes(element);
  element.querySelectorAll("*").forEach(translateAttributes);
  const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
  let node: Node | null;
  while ((node = walker.nextNode())) translateText(node as Text);
}

export async function reloadTranslations() {
  const locale = localeFromCookie();
  previousTranslations = translations;
  if (locale === "en") translations = {};
  else {
    const response = await fetch(
      `/i18n/literals/${encodeURIComponent(locale)}.json`,
    );
    translations = response.ok
      ? ((await response.json()) as Record<string, string>)
      : {};
  }
  translateElement(document.body);
}

export async function initializeTranslations() {
  if (observer) return reloadTranslations();
  await reloadTranslations();
  observer = new MutationObserver((mutations) => {
    for (const mutation of mutations)
      mutation.addedNodes.forEach(translateElement);
  });
  observer.observe(document.body, { childList: true, subtree: true });
}
