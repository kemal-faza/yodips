import { createRouter, createWebHistory, type RouterHistory, type Router } from 'vue-router';
import { useAuthStore } from '../stores/auth';
import { isMobileDevice } from '../config/extension';

// Layar mobile-only (spec §9): versi desktop YAGNI → redirect '/'.
const MOBILE_ONLY_PATHS = new Set(['/scan', '/jadwal', '/khs', '/irs', '/presensi']);

export function buildRouter(history: RouterHistory): Router {
  const router = createRouter({
    history,
    routes: [
      { path: '/login', name: 'login', component: () => import('../views/LoginView.vue') },
      // Halaman kebijakan privasi bersifat publik (URL dipakai di listing store).
      { path: '/privacy', name: 'privacy', component: () => import('../views/PrivacyView.vue') },
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
          // Mobile-only (transisi F5): file masih ada sampai F6, tapi hanya
          // dijangkau desktop-redirect di guard; UA-mobile sudah dilempar /app/.
          { path: 'scan', name: 'scan', component: () => import('../mobile/screens/ScanMobile.vue') },
          { path: 'jadwal', name: 'jadwal', component: () => import('../mobile/screens/ScheduleMobile.vue') },
          { path: 'khs', name: 'khs', component: () => import('../mobile/screens/KhsMobile.vue') },
          { path: 'irs', name: 'irs', component: () => import('../mobile/screens/IrsMobile.vue') },
          { path: 'presensi', name: 'presensi', component: () => import('../mobile/screens/PresensiMobile.vue') },
        ],
      },
    ],
  });

  router.beforeEach(async (to) => {
    // Transisi F5: perangkat mobile → PWA CMP. /privacy publik untuk semua;
    // /login dikecualikan SAMPAI F6 (branch pairing LoginView masih dipakai
    // fallback & test-nya mock UA mobile).
    if (isMobileDevice() && to.path !== '/privacy' && to.path !== '/login') {
      window.location.replace('/app/');
      return false;
    }
    if (!isMobileDevice() && MOBILE_ONLY_PATHS.has(to.path)) return '/';
    const store = useAuthStore();
    if (to.name !== 'login' && to.name !== 'privacy' && !store.isAuthenticated) {
      return { name: 'login' };
    }
    if (to.name === 'login' && store.isAuthenticated) {
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
    if (to.name === 'login' || to.name === 'privacy' || to.name === undefined) return;
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