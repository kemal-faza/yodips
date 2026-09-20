import { createRouter, createWebHistory, type RouterHistory, type Router } from 'vue-router';
import { useAuthStore } from '../stores/auth';
import { isMobileDevice } from '../config/extension';
import { isHandoffAccessTokenHash } from '../lib/handoff-token';

/** Halaman legal publik: tanpa login, dan tetap dilayani di HP (URL listing store). */
const PUBLIC_LEGAL_PATHS = new Set(['/privacy', '/terms']);
const PUBLIC_LEGAL_NAMES = new Set(['privacy', 'terms']);

export function buildRouter(history: RouterHistory): Router {
  const router = createRouter({
    history,
    routes: [
      { path: '/login', name: 'login', component: () => import('../views/LoginView.vue') },
      // Halaman kebijakan privasi + syarat layanan bersifat publik (URL dipakai
      // di listing store, dan harus terbaca sebelum pengguna menyetujuinya).
      { path: '/privacy', name: 'privacy', component: () => import('../views/PrivacyView.vue') },
      { path: '/terms', name: 'terms', component: () => import('../views/TermsView.vue') },
      {
        path: '/',
        component: () => import('../layouts/AppLayout.vue'),
        children: [
          { path: '', name: 'dashboard', component: () => import('../views/DashboardView.vue') },
          { path: 'profile', name: 'profile', component: () => import('../views/ProfileView.vue') },
          { path: 'kulon', redirect: { name: 'kulon-dashboard' } },
          { path: 'kulon/dashboard', name: 'kulon-dashboard', component: () => import('../views/KulonDashboardView.vue') },
          { path: 'kulon/matakuliah', name: 'kulon-courses', component: () => import('../views/KulonCoursesView.vue') },
          { path: 'kulon/matakuliah/:courseId', name: 'kulon-course-detail', component: () => import('../views/KulonCourseDetailView.vue') },
        ],
      },
    ],
  });

  router.beforeEach(async (to) => {
    // Pasca-F6: satu-satunya jalur mobile adalah PWA /app/. Halaman legal tetap
    // publik (URL listing store, harus terbaca dari HP).
    if (isMobileDevice() && !PUBLIC_LEGAL_PATHS.has(to.path)) {
      window.location.replace('/app/');
      return false;
    }
    const store = useAuthStore();
    if (to.name !== 'login' && !PUBLIC_LEGAL_NAMES.has(to.name as string) && !store.isAuthenticated) {
      return { name: 'login' };
    }
    if (to.name === 'login' && store.isAuthenticated) {
      // YD-AUTH-002: a valid #access_token=<strict JWT> handoff fragment on
      // /login carries a NEWER token that LoginView must consume — do not bounce
      // it to the dashboard just because an older local JWT exists. A malformed
      // hash (or no hash) does NOT bypass the redirect. The hash is not
      // sent in HTTP requests, so letting it reach the SPA is safe.
      if (isHandoffAccessTokenHash(to.hash)) {
        return true;
      }
      return { name: 'dashboard' };
    }
    return true;
  });

  // Non-blocking session verification. Runs in afterEach (NOT the guard) so the
  // dashboard's first paint isn't blocked on GET /me. `verified` is per-buildRouter
  // so each app/router instance has its own flag (no cross-test leakage).
  let verified = false;
  router.afterEach(async (to) => {
    if (verified) return;
    if (to.name === 'login' || PUBLIC_LEGAL_NAMES.has(to.name as string) || to.name === undefined) return;
    const store = useAuthStore();
    if (!store.isAuthenticated) return;
    verified = true;
    const status = await store.fetchMe();
    if (status === 'incomplete') {
      const result = await store.attemptReauth();
      if (result !== 'recovered') {
        await router.replace({ name: 'login', query: { reason: 'incomplete' } });
      }
    } else if (status === 'invalid') {
      await router.replace({ name: 'login' });
    }
    // 'error' → backend down; do nothing (no bounce).
  });

  return router;
}

export default createRouterForWeb();

function createRouterForWeb(): Router {
  return buildRouter(createWebHistory());
}