<script setup lang="ts">
import {
  Bell,
  ChatDotRound,
  Connection,
  DataAnalysis,
  Files,
  LocationFilled,
  MagicStick,
  SwitchButton
} from '@element-plus/icons-vue';
import { computed } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { API_BASE_URL } from '../lib/api';
import { useAuthStore } from '../stores/auth';

const route = useRoute();
const router = useRouter();
const authStore = useAuthStore();

const menus = [
  { path: '/', label: '综合总览', icon: DataAnalysis },
  { path: '/sites', label: '监测点位', icon: LocationFilled },
  { path: '/ingestion', label: '数据接收', icon: Connection },
  { path: '/alerts', label: '预警中心', icon: Bell },
  { path: '/reports', label: '群众上报', icon: ChatDotRound },
  { path: '/analysis', label: '智能研判', icon: MagicStick },
  { path: '/plans', label: '应急预案', icon: Files }
];

const activePath = computed(() => route.path);

function logout() {
  authStore.logout();
  router.push('/login');
}

function openApiDocs() {
  window.open(`${API_BASE_URL}/docs`, '_blank');
}
</script>

<template>
  <div class="shell">
    <aside class="shell-aside">
      <div class="brand">
        <span class="brand-kicker">GeoProphet</span>
        <h1>地质灾害智能预警平台</h1>
        <p>天地空一体化监测 · AI研判 · 公众协同</p>
      </div>
      <el-menu :default-active="activePath" router class="shell-menu">
        <el-menu-item v-for="item in menus" :key="item.path" :index="item.path">
          <el-icon><component :is="item.icon" /></el-icon>
          <span>{{ item.label }}</span>
        </el-menu-item>
      </el-menu>
      <div class="shell-footer">
        <p>白山市全域风险态势</p>
        <strong>接口响应目标 &lt; 500ms</strong>
      </div>
    </aside>

    <main class="shell-main">
      <header class="topbar">
        <div>
          <div class="topbar-kicker">运行中</div>
          <h2>{{ menus.find((item) => item.path === activePath)?.label ?? 'GeoProphet' }}</h2>
        </div>
        <div class="topbar-actions">
          <el-button type="primary" plain @click="openApiDocs">API 文档</el-button>
          <el-dropdown>
            <span class="user-chip">
              {{ authStore.user?.name ?? '值班员' }}
              <small>{{ authStore.user?.role ?? 'operator' }}</small>
            </span>
            <template #dropdown>
              <el-dropdown-menu>
                <el-dropdown-item @click="logout">
                  <el-icon><SwitchButton /></el-icon>
                  退出登录
                </el-dropdown-item>
              </el-dropdown-menu>
            </template>
          </el-dropdown>
        </div>
      </header>

      <section class="page-shell">
        <router-view />
      </section>
    </main>
  </div>
</template>

