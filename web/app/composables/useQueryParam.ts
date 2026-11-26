import {
  computed,
  shallowRef,
  toValue,
  watch,
  type MaybeRefOrGetter,
  type WritableComputedRef,
} from 'vue';
import type { LocationQuery, Router } from 'vue-router';

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

export function anyText(value: string): value is string {
  return value !== '';
}

export function oneOf<Value extends string>(values: readonly Value[]) {
  return (value: string): value is Value => values.some((allowed) => allowed === value);
}

interface QueryParamOptions<Value extends string> {
  default: Value;
  isValid: (value: string) => value is Value;
  debounce?: number;
}

export function useQueryParam<Value extends string>(
  key: string,
  options: QueryParamOptions<Value>,
): WritableComputedRef<Value> {
  const route = useRoute();
  const router = useRouter();

  function fromUrl(): Value {
    const raw = route.query[key];
    return typeof raw === 'string' && options.isValid(raw) ? raw : options.default;
  }

  const text = shallowRef<string>(fromUrl());
  const value = computed<Value>({
    get: () => (options.isValid(text.value) ? text.value : options.default),
    set: (next) => {
      text.value = next;
    },
  });
  let lastWritten: string = value.value;

  const initial = route.query[key];
  if (typeof initial === 'string' && (initial !== value.value || initial === options.default)) {
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
  isValid: (value: string) => value is Value;
  order?: MaybeRefOrGetter<readonly string[]>;
}

const LIST_SEPARATOR = ',';

export function useQueryList<Value extends string>(
  key: string,
  options: QueryListOptions<Value>,
): WritableComputedRef<Value[]> {
  const text = useQueryParam(key, { default: '', isValid: anyText });

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

function useRouteQueryParam<Value extends string>(
  key: string,
  options: Pick<QueryParamOptions<Value>, 'default' | 'isValid'>,
): WritableComputedRef<Value> {
  const route = useRoute();
  const router = useRouter();
  return computed<Value>({
    get: () => {
      const raw = route.query[key];
      return typeof raw === 'string' && options.isValid(raw) ? raw : options.default;
    },
    set: (next) => {
      scheduleQueryPatch(router, { [key]: next === options.default ? undefined : next });
    },
  });
}

export function useQuerySearch(): WritableComputedRef<string> {
  return useRouteQueryParam('q', { default: '', isValid: anyText });
}

export function useQueryPage(): WritableComputedRef<number> {
  const raw = useRouteQueryParam('page', { default: '1', isValid: isPageNumber });
  return computed({
    get: () => Number(raw.value),
    set: (page) => {
      raw.value = page > 1 ? String(Math.floor(page)) : '1';
    },
  });
}
