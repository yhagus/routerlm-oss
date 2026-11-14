import { ofetch, type FetchOptions, type MappedResponseType, type ResponseType } from "ofetch";

const UNAUTHORIZED = 401;

/**
 * A `$fetch` for backend paths. `T` is the response body's type and stays
 * `unknown` unless the caller names it.
 */
export type DashboardApi = <T = unknown, R extends ResponseType = "json">(
  path: string,
  options?: DashboardApiOptions<R>,
) => Promise<MappedResponseType<R, T>>;

type DashboardApiOptions<R extends ResponseType> = Omit<FetchOptions<R>, "method"> & {
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
};

/**
 * `$dashboardApi`: `$fetch` for the backend's dashboard API, through this
 * app's /api forwarder. A 401 means the session ended (signed out elsewhere,
 * expired, User deleted), so it forgets the User and goes to login.
 *
 * `$dashboardFetch` is the same client typed as Nuxt's `$fetch`, for
 * `createUseFetch`. Direct calls use `$dashboardApi` instead: `$fetch`'s types
 * match every request against this app's own Nitro routes, these paths only
 * reach the backend through the /api catch-all, and matching them against it
 * exceeds the type checker's depth limit.
 */
export default defineNuxtPlugin((nuxtApp) => {
  const options: FetchOptions = {
    baseURL: "/api",
    async onResponseError({ response }) {
      if (response.status !== UNAUTHORIZED) {
        return;
      }
      const currentUser = useCurrentUser();
      // A failed login is a 401 too; the login page shows that itself.
      if (!currentUser.value) {
        return;
      }
      currentUser.value = null;
      await nuxtApp.runWithContext(() => navigateTo("/login"));
    },
  };
  const dashboardApi: DashboardApi = ofetch.create(options);
  const dashboardFetch = $fetch.create(options);

  return { provide: { dashboardApi, dashboardFetch } };
});
