import type { WritableComputedRef } from "vue";

/** One removable token in the active-filters row, such as "Capability: Vision". */
export interface ActiveFilter {
  /** Unique within the row; used as the list key. */
  key: string;
  group: string;
  label: string;
  remove: () => void;
}

interface FilterOption<Value extends string> {
  label: string;
  value: Value;
}

/** One token per value picked in a multi-value filter. */
export function listFilterTokens<Value extends string>(
  group: string,
  list: WritableComputedRef<Value[]>,
  options: readonly FilterOption<Value>[],
): ActiveFilter[] {
  return list.value.map((value) => ({
    key: `${group}:${value}`,
    group,
    label: options.find((option) => option.value === value)?.label ?? value,
    remove: () => {
      list.value = list.value.filter((each) => each !== value);
    },
  }));
}

/** The search text as one token, or none while the search is empty. */
export function searchFilterTokens(search: WritableComputedRef<string>): ActiveFilter[] {
  const text = search.value.trim();
  if (!text) return [];
  return [
    {
      key: "search",
      group: "Search",
      label: text,
      remove: () => {
        search.value = "";
      },
    },
  ];
}

/** One token for a filter typed as text, such as a Customer id, or none while it is empty. */
export function textFilterTokens(group: string, text: WritableComputedRef<string>): ActiveFilter[] {
  if (text.value === "") return [];
  return [
    {
      key: group,
      group,
      label: text.value,
      remove: () => {
        text.value = "";
      },
    },
  ];
}
