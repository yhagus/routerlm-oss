/**
 * `useFetch` for the backend's dashboard API: `useDashboardApi<User[]>("/users")`.
 * For calls outside setup (form submits), use `useNuxtApp().$dashboardApi`.
 *
 * Lazy by default: a page renders at once and fills in as data arrives, so
 * navigation never waits on the backend. Don't `await` it in a page; show
 * `status === "pending"` with `LoadingRow` or `AppSpinner` instead. Pass `lazy: false` only
 * where the page truly can't render without the data.
 */
export const useDashboardApi = createUseFetch((callerOptions) => ({
  $fetch: useNuxtApp().$dashboardFetch,
  ...callerOptions,
  lazy: callerOptions?.lazy ?? true,
}));
