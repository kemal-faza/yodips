import { createRouter, createWebHistory, type RouterHistory, type Router } from 'vue-router';
import { useAuthStore } from '../stores/auth';

export function buildRouter(history: RouterHistory): Router {
  const router = createRouter({
    history,
    routes: [
      { path: '/login', name: 'login', component: () => import('../views/LoginView.vue') },
      { path: '/', name: 'dashboard', component: () => import('../views/DashboardView.vue') },
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
    return true;
  });

  return router;
}

export default createRouterForWeb();

function createRouterForWeb(): Router {
  return buildRouter(createWebHistory());
}