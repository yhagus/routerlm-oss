const UNAUTHORIZED = 401;

/**
 * `$dashboardApi`: `$fetch` for the backend's dashboard API, through this
 * app's /api forwarder. A 401 means the session ended (signed out elsewhere,
 * expired, User deleted), so it forgets the User and goes to login.
 */
export default defineNuxtPlugin((nuxtApp) => {
  const dashboardApi = $fetch.create({
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
  });

  return { provide: { dashboardApi } };
});
