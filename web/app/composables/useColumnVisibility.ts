import type { ColumnVisibilityState } from '@tanstack/vue-table';
import { onMounted, shallowRef, watch, type ShallowRef } from 'vue';

const STORAGE_PREFIX = 'routerlm:columns:';

function isVisibilityState(value: unknown): value is ColumnVisibilityState {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    Object.values(value).every((isVisible) => typeof isVisible === 'boolean')
  );
}

function readStored(key: string): ColumnVisibilityState {
  try {
    const stored = localStorage.getItem(key);
    if (!stored) return {};
    const parsed: unknown = JSON.parse(stored);
    return isVisibilityState(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function writeStored(key: string, visibility: ColumnVisibilityState): void {
  try {
    if (Object.keys(visibility).length === 0) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify(visibility));
  } catch {}
}

export function useColumnVisibility(tableId: string): ShallowRef<ColumnVisibilityState> {
  const key = `${STORAGE_PREFIX}${tableId}`;
  const visibility = shallowRef<ColumnVisibilityState>({});

  onMounted(() => {
    visibility.value = readStored(key);
    watch(visibility, (next) => writeStored(key, next));
  });

  return visibility;
}
