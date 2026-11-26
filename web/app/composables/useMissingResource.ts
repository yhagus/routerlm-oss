import { type MissingResource, missingResourceError } from '~/lib/errors';

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
