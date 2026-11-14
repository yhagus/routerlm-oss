/**
 * `useFetch` for the backend's dashboard API: `useDashboardApi<User[]>("/users")`.
 * For calls outside setup (form submits), use `useNuxtApp().$dashboardApi`.
 */
export const useDashboardApi = createUseFetch((callerOptions) => ({
  $fetch: useNuxtApp().$dashboardFetch,
  ...callerOptions,
}));
