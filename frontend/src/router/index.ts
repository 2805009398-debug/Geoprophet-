import { createRouter, createWebHistory } from 'vue-router';
import AppShell from '../components/AppShell.vue';
import { pinia } from '../stores';
import { useAuthStore } from '../stores/auth';
import DashboardView from '../views/DashboardView.vue';
import DailyMonitoringView from '../views/DailyMonitoringView.vue';
import LandslideDetectionView from '../views/LandslideDetectionView.vue';
import LoginView from '../views/LoginView.vue';
import PublicSubmitView from '../views/PublicSubmitView.vue';
import ReportsView from '../views/ReportsView.vue';
import DataCenterView from '../views/DataCenterView.vue';

const router = createRouter({
  history: createWebHistory(),
  routes: [
    {
      path: '/login',
      component: LoginView
    },
    {
      path: '/submit',
      component: PublicSubmitView
    },
    {
      path: '/',
      component: AppShell,
      meta: { requiresAuth: true },
      children: [
        { path: '', component: DailyMonitoringView },
        { path: 'dashboard', component: DashboardView },
        { path: 'data-center', component: DataCenterView },
        { path: 'landslide-samples', redirect: '/' },
        { path: 'landslide-detection', component: LandslideDetectionView },
        { path: 'reports', component: ReportsView }
      ]
    }
  ]
});

router.beforeEach(async (to) => {
  const authStore = useAuthStore(pinia);

  if (authStore.token && !authStore.user) {
    try {
      await authStore.fetchMe();
    } catch {
      authStore.logout();
    }
  }

  if (to.meta.requiresAuth && !authStore.token) {
    return '/login';
  }

  if (to.path === '/login' && authStore.token) {
    return '/';
  }

  return true;
});

export default router;
