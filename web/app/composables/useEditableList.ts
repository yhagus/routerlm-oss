import { computed, ref, shallowRef } from "vue";
import { apiErrorMessage } from "~/lib/api";

/** A listed row the dashboard can switch on and off. */
interface ToggleableRow {
  id: string;
  isEnabled: boolean;
}

/**
 * The editing state a dashboard list page shares (Providers, Provider
 * Accounts, Upstream Models): which dialog is open, whether a write is
 * running, the dialog's error, and the writes made from a dialog or a row.
 * Every successful write toasts and reloads the list with `refresh`.
 */
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
  const dialogError = ref("");

  function showDialog(next: Dialog): void {
    dialog.value = next;
    dialogError.value = "";
  }

  function closeDialog(): void {
    dialog.value = null;
  }

  /**
   * Runs a write started from the open dialog. On success the dialog closes
   * with a `doneMessage` toast; on failure it stays open and shows the error.
   */
  async function submitDialog(
    write: () => Promise<unknown>,
    /** The toast on success; a function when it depends on the response (a generated name). */
    doneMessage: string | (() => string),
    failureMessage: string,
  ): Promise<void> {
    isSaving.value = true;
    dialogError.value = "";
    try {
      await write();
      showToast(typeof doneMessage === "function" ? doneMessage() : doneMessage);
      dialog.value = null;
      await refresh();
    } catch (error) {
      dialogError.value = apiErrorMessage(error, failureMessage);
    } finally {
      isSaving.value = false;
    }
  }

  /** Deletes a row from its confirmation dialog. */
  function deleteRow(row: { id: string }, name: string, failureMessage: string): Promise<void> {
    return submitDialog(
      () => $dashboardApi(`${resourcePath}/${row.id}`, { method: "DELETE" }),
      `Deleted ${name}`,
      failureMessage,
    );
  }

  /** Enables a disabled row or disables an enabled one; errors go to a toast. */
  async function toggleRow(row: ToggleableRow, name: string): Promise<void> {
    try {
      await $dashboardApi(`${resourcePath}/${row.id}`, {
        method: "PATCH",
        body: { isEnabled: !row.isEnabled },
      });
      showToast(`${row.isEnabled ? "Disabled" : "Enabled"} ${name}`);
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
