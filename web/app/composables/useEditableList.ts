import { computed, ref, shallowRef } from 'vue';
import { apiErrorMessage } from '~/lib/api';

interface ToggleableRow {
  id: string;
  isEnabled: boolean;
}

export function useEditableList<Dialog extends object>(
  resourcePath: string,
  refresh: () => Promise<unknown>,
) {
  const { $dashboardApi } = useNuxtApp();
  const { showToast } = useToast();

  const dialog = shallowRef<Dialog | null>(null);
  const isDialogOpen = computed({
    get: () => dialog.value !== null,
    set: (isOpen) => {
      if (!isOpen) dialog.value = null;
    },
  });
  const isSaving = ref(false);
  const dialogError = ref('');

  function showDialog(next: Dialog): void {
    dialog.value = next;
    dialogError.value = '';
  }

  function closeDialog(): void {
    dialog.value = null;
  }

  async function submitDialog(
    write: () => Promise<unknown>,
    doneMessage: string | (() => string),
    failureMessage: string,
  ): Promise<void> {
    isSaving.value = true;
    dialogError.value = '';
    try {
      await write();
      showToast(typeof doneMessage === 'function' ? doneMessage() : doneMessage);
      dialog.value = null;
      await refresh();
    } catch (error) {
      dialogError.value = apiErrorMessage(error, failureMessage);
    } finally {
      isSaving.value = false;
    }
  }

  function deleteRow(row: { id: string }, name: string, failureMessage: string): Promise<void> {
    return submitDialog(
      () => $dashboardApi(`${resourcePath}/${row.id}`, { method: 'DELETE' }),
      `Deleted ${name}`,
      failureMessage,
    );
  }

  async function toggleRow(row: ToggleableRow, name: string): Promise<void> {
    try {
      await $dashboardApi(`${resourcePath}/${row.id}`, {
        method: 'PATCH',
        body: { isEnabled: !row.isEnabled },
      });
      showToast(`${row.isEnabled ? 'Disabled' : 'Enabled'} ${name}`);
      await refresh();
    } catch (error) {
      showToast(apiErrorMessage(error, `Couldn't update ${name}.`));
    }
  }

  return {
    dialog,
    isDialogOpen,
    isSaving,
    dialogError,
    showDialog,
    closeDialog,
    submitDialog,
    deleteRow,
    toggleRow,
  };
}
