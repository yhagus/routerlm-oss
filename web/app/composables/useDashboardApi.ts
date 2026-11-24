export const useDashboardApi = createUseFetch((callerOptions) => ({
  $fetch: useNuxtApp().$dashboardFetch,
  ...callerOptions,
  lazy: callerOptions?.lazy ?? true,
}));
