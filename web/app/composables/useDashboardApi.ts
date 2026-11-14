/**
 * `useFetch` for the backend's dashboard API: `useDashboardApi<User[]>("/users")`.
 * For calls outside setup (form submits), use `useNuxtApp().$dashboardApi`.
 */
export const useDashboardApi = createUseFetch((callerOptions) => ({
  // oxlint-disable-next-line typescript/consistent-type-assertions -- Nuxt's documented createUseFetch pattern: a $fetch.create() instance lacks $fetch's route-typed signature (nuxt.com/docs/4.x/api/composables/create-use-fetch).
  $fetch: useNuxtApp().$dashboardApi as typeof $fetch,
  ...callerOptions,
}));
