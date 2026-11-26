import { computed, ref, type WritableComputedRef } from 'vue';
import type { ModelGroupRef } from '~/lib/modelGroups';
import { slugFromName } from '~/lib/providerForm';

export interface GroupDraft {
  name: WritableComputedRef<string>;
  slug: WritableComputedRef<string>;
  reset: (group?: ModelGroupRef) => void;
}

export function useGroupDraft(): GroupDraft {
  const nameText = ref('');
  const slugText = ref('');
  const isSlugTyped = ref(false);

  const name = computed({
    get: () => nameText.value,
    set: (next: string) => {
      nameText.value = next;
      if (!isSlugTyped.value) slugText.value = slugFromName(next);
    },
  });
  const slug = computed({
    get: () => slugText.value,
    set: (next: string) => {
      slugText.value = next;
      isSlugTyped.value = next !== '';
    },
  });

  function reset(group?: ModelGroupRef): void {
    nameText.value = group?.name ?? '';
    slugText.value = group?.slug ?? '';
    isSlugTyped.value = group !== undefined;
  }

  return { name, slug, reset };
}
