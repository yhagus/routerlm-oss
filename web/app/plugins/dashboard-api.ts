import { ofetch, type FetchOptions, type MappedResponseType, type ResponseType } from 'ofetch';

const UNAUTHORIZED = 401;

export type DashboardApi = <T = unknown, R extends ResponseType = 'json'>(
  path: string,
  options?: DashboardApiOptions<R>,
) => Promise<MappedResponseType<R, T>>;

type DashboardApiOptions<R extends ResponseType> = Omit<FetchOptions<R>, 'method'> & {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
};

export default defineNuxtPlugin((nuxtApp) => {
  const options: FetchOptions = {
    baseURL: '/api',
    async onResponseError({ response }) {
      if (response.status !== UNAUTHORIZED) {
        return;
      }
      const currentUser = useCurrentUser();
      if (!currentUser.value) {
        return;
      }
      currentUser.value = null;
      await nuxtApp.runWithContext(() => navigateTo('/login'));
    },
  };
  const dashboardApi: DashboardApi = ofetch.create(options);
  const dashboardFetch = $fetch.create(options);

  return { provide: { dashboardApi, dashboardFetch } };
});
