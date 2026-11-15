import {
  computed,
  shallowRef,
  toValue,
  watch,
  type MaybeRefOrGetter,
  type WritableComputedRef,
} from "vue";
import type { LocationQuery, Router } from "vue-router";

/**
 * Changes made in one tick, merged into a single `router.replace`: Clear
 * filters sets several params at once, and a filter change also resets the
 * page, so separate replaces would each start from the old URL and undo the
 * others.
 */
let pendingPatch: Record<string, string | undefined> = {};
let isFlushScheduled = false;

function scheduleQueryPatch(router: Router, patch: Record<string, string | undefined>): void {
  pendingPatch = { ...pendingPatch, ...patch };
  if (isFlushScheduled) return;
  isFlushScheduled = true;
  queueMicrotask(() => {
    const query: LocationQuery = { ...router.currentRoute.value.query };
    for (const [key, value] of Object.entries(pendingPatch)) {
      if (value === undefined) delete query[key];
      else query[key] = value;
    }
    pendingPatch = {};
    isFlushScheduled = false;
    void router.replace({ query });
  });
}

/** Accepts any text, for searches and ids. */
export function anyText(value: string): value is string {
  return value !== "";
}

/** Accepts one of `values`. */
export function oneOf<Value extends string>(values: readonly Value[]) {
  return (value: string): value is Value => values.some((allowed) => allowed === value);
}

interface QueryParamOptions<Value extends string> {
  /** Shown when the param is absent or invalid, and left out of the URL. */
  default: Value;
  /** Whether a value from the URL is one this param accepts; anything else means the default. */
  isValid: (value: string) => value is Value;
  /** Milliseconds to wait before writing to the URL, for text typed key by key. */
  debounce?: number;
}

/**
 * A filter held in the URL query, so a refresh, a bookmark or a shared link
 * restores it. Writes replace the URL in place (no history entry), and a
 * value at its default leaves the URL. Params the caller doesn't own are kept.
 */
export function useQueryParam<Value extends string>(
  key: string,
  options: QueryParamOptions<Value>,
): WritableComputedRef<Value> {
  const route = useRoute();
  const router = useRouter();

  function fromUrl(): Value {
    const raw = route.query[key];
    return typeof raw === "string" && options.isValid(raw) ? raw : options.default;
  }

  /** The current text; `value` narrows it through `isValid`, so no cast is needed. */
  const text = shallowRef<string>(fromUrl());
  const value = computed<Value>({
    get: () => (options.isValid(text.value) ? text.value : options.default),
    set: (next) => {
      text.value = next;
    },
  });
  /** What this param last put in the URL, so its own writes aren't read back as outside changes. */
  let lastWritten: string = value.value;

  // An invalid value (?status=foo) or a spelled-out default (?sort=name) leaves the URL at once,
  // so the address always matches what the page shows.
  const initial = route.query[key];
  if (typeof initial === "string" && (initial !== value.value || initial === options.default)) {
    scheduleQueryPatch(router, { [key]: undefined });
  }
  let timer: ReturnType<typeof setTimeout> | undefined;

  watch(value, (next) => {
    clearTimeout(timer);
    const write = () => {
      lastWritten = next;
      scheduleQueryPatch(router, { [key]: next === options.default ? undefined : next });
    };
    if (options.debounce) timer = setTimeout(write, options.debounce);
    else write();
  });

  // Back/forward, or a link to this page with other params.
  watch(
    () => route.query[key],
    () => {
      const next = fromUrl();
      if (next === lastWritten) return;
      lastWritten = next;
      clearTimeout(timer);
      value.value = next;
    },
  );

  return value;
}

interface QueryListOptions<Value extends string> {
  /** Whether one element from the URL is one this list accepts; others are dropped. */
  isValid: (value: string) => value is Value;
  /** Canonical order of the values. Values it doesn't name go after, alphabetically. */
  order?: MaybeRefOrGetter<readonly string[]>;
}

const LIST_SEPARATOR = ",";

/**
 * A multi-value filter held in the URL as one comma-separated param
 * (`?capability=vision,tools`), with the same refresh, link and back/forward
 * behaviour as `useQueryParam`. An empty list leaves the URL. Values are
 * deduplicated and kept in canonical order, so the same filter always gives
 * the same URL.
 */
export function useQueryList<Value extends string>(
  key: string,
  options: QueryListOptions<Value>,
): WritableComputedRef<Value[]> {
  const text = useQueryParam(key, { default: "", isValid: anyText });

  function canonical(values: readonly string[]): Value[] {
    const order = toValue(options.order) ?? [];
    const rank = (value: string) => {
      const index = order.indexOf(value);
      return index === -1 ? order.length : index;
    };
    const unique = [...new Set(values)].filter(options.isValid);
    return unique.toSorted(
      (first, second) => rank(first) - rank(second) || first.localeCompare(second),
    );
  }

  const value = computed<Value[]>({
    get: () => canonical(text.value.split(LIST_SEPARATOR)),
    set: (next) => {
      text.value = canonical(next).join(LIST_SEPARATOR);
    },
  });

  // A link with invalid, repeated or reordered values is rewritten in canonical form.
  watch(
    () => value.value.join(LIST_SEPARATOR),
    (canonicalText) => {
      if (text.value !== canonicalText) text.value = canonicalText;
    },
    { immediate: true },
  );

  return value;
}

function isPageNumber(value: string): value is string {
  return /^[1-9]\d*$/.test(value);
}

/**
 * A param read straight from the route, for list state that a page's request
 * is built from. Params changed by one navigation (back/forward to `?q=a&page=3`)
 * then change together, so the request runs once with both, where separate
 * copies updated one by one would each trigger it. A write shows once the URL
 * has changed, a few milliseconds later.
 */
function useRouteQueryParam<Value extends string>(
  key: string,
  options: Pick<QueryParamOptions<Value>, "default" | "isValid">,
): WritableComputedRef<Value> {
  const route = useRoute();
  const router = useRouter();
  return computed<Value>({
    get: () => {
      const raw = route.query[key];
      return typeof raw === "string" && options.isValid(raw) ? raw : options.default;
    },
    set: (next) => {
      scheduleQueryPatch(router, { [key]: next === options.default ? undefined : next });
    },
  });
}

/**
 * A list's committed search in `?q=`: what the rows are filtered by, not the
 * text being typed. The DataTable's field writes it once typing pauses; a
 * server-mode page reads it for its request.
 */
export function useQuerySearch(): WritableComputedRef<string> {
  return useRouteQueryParam("q", { default: "", isValid: anyText });
}

/** The list page number in `?page=`; page 1 leaves the URL. */
export function useQueryPage(): WritableComputedRef<number> {
  const raw = useRouteQueryParam("page", { default: "1", isValid: isPageNumber });
  return computed({
    get: () => Number(raw.value),
    set: (page) => {
      raw.value = page > 1 ? String(Math.floor(page)) : "1";
    },
  });
}
