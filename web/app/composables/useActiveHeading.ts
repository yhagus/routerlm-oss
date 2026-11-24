import { useEventListener, useResizeObserver } from "@vueuse/core";
import { nextTick, shallowRef, watch, type Ref, type ShallowRef } from "vue";

const ACTIVATION_OFFSET_PX = 96;

const SCROLL_KEYS = new Set(["ArrowUp", "ArrowDown", "PageUp", "PageDown", "Home", "End", " "]);

const usePickedHeading = () => useState<string | null>("docs-picked-heading", () => null);

export function pickHeading(id: string): void {
  const heading = document.getElementById(id);
  if (!heading) return;
  usePickedHeading().value = id;
  history.replaceState(history.state, "", `#${id}`);
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  requestAnimationFrame(() =>
    heading.scrollIntoView({ behavior: reduceMotion ? "auto" : "smooth", block: "start" }),
  );
}

const RENDER_WAIT_MS = 2000;

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
  useResizeObserver(() => document.body, scheduleUpdate);
  watch(headingIds, () => nextTick(scheduleUpdate), { immediate: true });
  watch(picked, scheduleUpdate);

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
