import { useEventListener, useResizeObserver } from "@vueuse/core";
import { nextTick, shallowRef, watch, type Ref, type ShallowRef } from "vue";

/** A heading counts as current once it is this close to the top: past the sticky top bar. */
const ACTIVATION_OFFSET_PX = 96;

/** Keys that scroll the page; pressing one ends a picked section's hold. */
const SCROLL_KEYS = new Set(["ArrowUp", "ArrowDown", "PageUp", "PageDown", "Home", "End", " "]);

/**
 * The section the reader picked in "On this page", shared by the list and the
 * scroll-spy. It stays current until the reader scrolls on their own, because
 * the sections near the end can't scroll up to the top bar and would
 * otherwise never light up.
 */
const usePickedHeading = () => useState<string | null>("docs-picked-heading", () => null);

/** Scrolls to a section, holds it as current and puts it in the address bar. */
export function pickHeading(id: string): void {
  const heading = document.getElementById(id);
  if (!heading) return;
  usePickedHeading().value = id;
  history.replaceState(history.state, "", `#${id}`);
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  // Next frame: the "On this page" disclosure closes on the same click, and
  // the scroll must aim at where the heading sits once it has.
  requestAnimationFrame(() =>
    heading.scrollIntoView({ behavior: reduceMotion ? "auto" : "smooth", block: "start" }),
  );
}

/** How long a linked section may take to render before the page gives up scrolling to it. */
const RENDER_WAIT_MS = 2000;

/**
 * Scrolls to a heading once the page body has rendered it. The section list
 * comes from the page data, which arrives before the rendered content.
 */
function scrollWhenRendered(id: string): void {
  const deadline = performance.now() + RENDER_WAIT_MS;
  const attempt = (): void => {
    const heading = document.getElementById(id);
    if (heading) {
      heading.scrollIntoView({ block: "start" });
      return;
    }
    if (performance.now() < deadline) requestAnimationFrame(attempt);
  };
  attempt();
}

/**
 * Scroll-spy for a page's headings: the picked section while it is held;
 * otherwise the last heading scrolled past the top bar, the first one before
 * any is, and the last one once the reader has scrolled to the page's end (a
 * short final section may never reach the top). A page that doesn't scroll,
 * or hasn't loaded yet, starts at the first.
 */
export function useActiveHeading(headingIds: Ref<string[]>): Readonly<ShallowRef<string | null>> {
  const activeId = shallowRef<string | null>(null);
  const picked = usePickedHeading();
  let frame = 0;

  function update(): void {
    frame = 0;
    const ids = headingIds.value;
    if (picked.value && ids.includes(picked.value)) {
      activeId.value = picked.value;
      return;
    }
    const isAtPageEnd =
      window.scrollY > 0 &&
      window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 2;
    if (isAtPageEnd && ids.length > 0) {
      activeId.value = ids[ids.length - 1] ?? null;
      return;
    }
    let current = ids[0] ?? null;
    for (const id of ids) {
      const heading = document.getElementById(id);
      if (!heading || heading.getBoundingClientRect().top > ACTIVATION_OFFSET_PX) break;
      current = id;
    }
    activeId.value = current;
  }

  function scheduleUpdate(): void {
    if (frame === 0) frame = requestAnimationFrame(update);
  }

  /** The reader scrolls by hand: the scroll position decides again. */
  function releasePick(): void {
    if (picked.value === null) return;
    picked.value = null;
    scheduleUpdate();
  }

  useEventListener(window, "scroll", scheduleUpdate, { passive: true });
  useEventListener(window, "resize", scheduleUpdate, { passive: true });
  useEventListener(window, "wheel", releasePick, { passive: true });
  useEventListener(window, "touchmove", releasePick, { passive: true });
  useEventListener(window, "keydown", (event: KeyboardEvent) => {
    if (SCROLL_KEYS.has(event.key)) releasePick();
  });
  // Content that renders after the headings are known changes where they sit.
  useResizeObserver(() => document.body, scheduleUpdate);
  watch(headingIds, () => nextTick(scheduleUpdate), { immediate: true });
  watch(picked, scheduleUpdate);

  // A link that arrives with a section in its hash goes to that section and
  // holds it. The router's own hash scroll runs before the page's content
  // loads, so it lands nowhere.
  watch(
    headingIds,
    (ids) => {
      const hashId = decodeURIComponent(window.location.hash.slice(1));
      if (hashId && ids.includes(hashId)) {
        picked.value = hashId;
        scrollWhenRendered(hashId);
      } else {
        picked.value = null;
      }
    },
    { immediate: true },
  );

  return activeId;
}
