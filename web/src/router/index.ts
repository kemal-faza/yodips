import { createRouter, createWebHistory, type RouterHistory, type Router } from 'vue-router';
import { useAuthStore } from '../stores/auth';

let booted = false;

export function buildRouter(history: RouterHistory): Router {
  const router = createRouter({
    history,
    routes: [
      { path: '/login', name: 'login', component: () => import('../views/LoginView.vue') },
      {
        path: '/',
        component: () => import('../layouts/AppLayout.vue'),
        children: [
          { path: '', name: 'dashboard', component: () => import('../views/DashboardView.vue') },
          { path: 'siap', name: 'siap', component: () => import('../views/SiapView.vue') },
          { path: 'kulon', redirect: { name: 'kulon-dashboard' } },
          { path: 'kulon/dashboard', name: 'kulon-dashboard', component: () => import('../views/KulonDashboardView.vue') },
          { path: 'kulon/matakuliah', name: 'kulon-courses', component: () => import('../views/KulonCoursesView.vue') },
          { path: 'kulon/matakuliah/:courseId', name: 'kulon-course-detail', component: () => import('../views/KulonCourseDetailView.vue') },
        ],
      },
    ],
  });

  router.beforeEach(async (to) => {
    const store = useAuthStore();
    if (to.name !== 'login' && !store.isAuthenticated) {
      return { name: 'login' };
    }
    if (to.name === 'login' && store.isAuthenticated) {
      return { name: 'dashboard' };
    }
    // Boot gate: validate the server-side session exactly once on the first
    // protected navigation. 'incomplete' => clear token + show login with a
    // reason; 'invalid' (401, interceptor already redirecting) => go to login
    // idempotently; 'error' (backend down) => let the SPA render (no loop).
    if (to.name !== 'login' && store.isAuthenticated && !booted) {
      booted = true;
      const status = await store.fetchMe();
      if (status === 'incomplete') {
        return { name: 'login', query: { reason: 'incomplete' } };
      }
      if (status === 'invalid') {
        return { name: 'login' };
      }
    }
    return true;
  });

  return router;
}

export default createRouterForWeb();

function createRouterForWeb(): Router {
  return buildRouter(createWebHistory());
}