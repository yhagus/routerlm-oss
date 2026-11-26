import type { User } from '~/lib/users';

const LOGIN_PATH = '/login';
const SETUP_PATH = '/setup';
const DOCS_PATHS = ['/docs', '/id/docs'];

export default defineNuxtRouteMiddleware(async (to) => {
  if (isDocsPath(to.path)) {
    return undefined;
  }

  const currentUser = useCurrentUser();
  if (currentUser.value === undefined) {
    currentUser.value = await fetchCurrentUser();
  }

  const isSignInPage = to.path === LOGIN_PATH || to.path === SETUP_PATH;
  if (currentUser.value) {
    return isSignInPage ? navigateTo('/') : undefined;
  }

  const { $dashboardApi } = useNuxtApp();
  const { isSetupRequired } = await $dashboardApi<{ isSetupRequired: boolean }>('/auth/setup');
  if (isSetupRequired) {
    return to.path === SETUP_PATH ? undefined : navigateTo(SETUP_PATH);
  }
  if (to.path === SETUP_PATH) {
    return navigateTo(LOGIN_PATH);
  }
  if (to.path === LOGIN_PATH) {
    return undefined;
  }
  return navigateTo({ path: LOGIN_PATH, query: { redirect: to.fullPath } });
});

async function fetchCurrentUser(): Promise<User | null> {
  const { $dashboardApi } = useNuxtApp();
  try {
    return await $dashboardApi<User>('/auth/me');
  } catch {
    return null;
  }
}

function isDocsPath(path: string): boolean {
  return DOCS_PATHS.some((docsPath) => path === docsPath || path.startsWith(`${docsPath}/`));
}
