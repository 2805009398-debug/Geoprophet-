<script setup lang="ts">
import {
  Calendar,
  ChatDotRound,
  DataAnalysis,
  DataLine,
  FolderOpened,
  Link,
  Search,
  SwitchButton,
  UserFilled
} from '@element-plus/icons-vue';
import { computed } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useAuthStore } from '../stores/auth';

const route = useRoute();
const router = useRouter();
const authStore = useAuthStore();

const menus = [
  { path: '/', label: '每日监测', desc: '遥感调度与风险图斑', icon: DataLine },
  { path: '/dashboard', label: '线索总览', desc: '待复核与趋势', icon: DataAnalysis },
  { path: '/data-center', label: '数据中心', desc: '遥感资产与图层', icon: FolderOpened },
  { path: '/reports', label: '群众举证', desc: '补录与流转', icon: ChatDotRound },
  { path: '/landslide-detection', label: '照片初筛', desc: 'YOLO/豆包识别', icon: Search }
];

const activePath = computed(() => route.path);
const activeMenu = computed(() => menus.find((item) => item.path === activePath.value) ?? menus[0]);
const todayLabel = computed(() =>
  new Intl.DateTimeFormat('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    weekday: 'short'
  }).format(new Date())
);

function logout() {
  authStore.logout();
  router.push('/login');
}

function goToReports() {
  router.push('/reports');
}

function openPublicSubmit() {
  window.open('/submit', '_blank', 'noopener,noreferrer');
}
</script>

<template>
  <div class="shell">
    <aside class="shell-aside">
      <div class="brand">
        <div class="brand-mark">G</div>
        <div>
          <span class="brand-kicker">GeoProphet</span>
          <h1>地灾智能预警平台</h1>
          <p>遥感监测 · AI初筛 · 专家复核</p>
        </div>
      </div>

      <div class="menu-label">值班工作台</div>
      <el-menu :default-active="activePath" router class="shell-menu">
        <el-menu-item v-for="item in menus" :key="item.path" :index="item.path">
          <el-icon><component :is="item.icon" /></el-icon>
          <span class="menu-copy">
            <strong>{{ item.label }}</strong>
            <small>{{ item.desc }}</small>
          </span>
        </el-menu-item>
      </el-menu>

      <div class="shell-footer">
        <div class="shell-footer-head">
          <span>平台定位</span>
          <el-icon><Link /></el-icon>
        </div>
        <strong>发现、定位、解释、预警的持续服务闭环</strong>
        <div class="shell-footer-tags">
          <span>每日调度</span>
          <span>AI初筛</span>
          <span>群众补充</span>
        </div>
      </div>
    </aside>

    <main class="shell-main">
      <header class="topbar">
        <div class="topbar-title-group">
          <div class="topbar-kicker">协同补充</div>
          <h2>{{ activeMenu.label }}</h2>
          <p>{{ activeMenu.desc }}</p>
        </div>
        <div class="topbar-actions">
          <span class="topbar-chip">
            <el-icon><Calendar /></el-icon>
            {{ todayLabel }}
          </span>
          <el-button plain :icon="Link" @click="openPublicSubmit">公开提交页</el-button>
          <el-button type="primary" :icon="ChatDotRound" @click="goToReports">提交线索</el-button>
          <el-dropdown>
            <span class="user-chip">
              <el-icon><UserFilled /></el-icon>
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
