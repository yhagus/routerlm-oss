import type { WritableComputedRef } from 'vue';

export interface ActiveFilter {
  key: string;
  group: string;
  label: string;
  remove: () => void;
}

interface FilterOption<Value extends string> {
  label: string;
  value: Value;
}

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

export function searchFilterTokens(search: WritableComputedRef<string>): ActiveFilter[] {
  const text = search.value.trim();
  if (!text) return [];
  return [
    {
      key: 'search',
      group: 'Search',
      label: text,
      remove: () => {
        search.value = '';
      },
    },
  ];
}

export function textFilterTokens(group: string, text: WritableComputedRef<string>): ActiveFilter[] {
  if (text.value === '') return [];
  return [
    {
      key: group,
      group,
      label: text.value,
      remove: () => {
        text.value = '';
      },
    },
  ];
}
