import { createRouter, createWebHistory } from 'vue-router';
import AppShell from '../components/AppShell.vue';
import { pinia } from '../stores';
import { useAuthStore } from '../stores/auth';
import AlertsView from '../views/AlertsView.vue';
import AnalysisView from '../views/AnalysisView.vue';
import DashboardView from '../views/DashboardView.vue';
import DataCenterView from '../views/DataCenterView.vue';
import LoginView from '../views/LoginView.vue';
import PlansView from '../views/PlansView.vue';
import ReportsView from '../views/ReportsView.vue';
import SitesView from '../views/SitesView.vue';

const router = createRouter({
  history: createWebHistory(),
  routes: [
    {
      path: '/login',
      component: LoginView
    },
    {
      path: '/',
      component: AppShell,
      meta: { requiresAuth: true },
      children: [
        { path: '', component: DashboardView },
        { path: 'sites', component: SitesView },
        { path: 'ingestion', component: DataCenterView },
        { path: 'alerts', component: AlertsView },
        { path: 'reports', component: ReportsView },
        { path: 'analysis', component: AnalysisView },
        { path: 'plans', component: PlansView }
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

