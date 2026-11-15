import { type MissingResource, missingResourceError } from "~/lib/errors";

/**
 * Shows the error page's 404 for `resource` once `isMissing` turns true, so a
 * detail page for a deleted record leaves the page instead of rendering empty.
 */
export function useMissingResource(isMissing: () => boolean, resource: MissingResource): void {
  watch(
    isMissing,
    (missing) => {
      if (missing) {
        showError(missingResourceError(resource));
      }
    },
    { immediate: true },
  );
}
