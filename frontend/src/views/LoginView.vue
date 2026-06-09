<script setup lang="ts">
import {
  ChatDotRound,
  CircleCheck,
  Connection,
  Finished,
  Location,
  Lock,
  Picture,
  RefreshRight,
  Right,
  User
} from '@element-plus/icons-vue';
import { ElMessage } from 'element-plus';
import { computed, onMounted, reactive, ref } from 'vue';
import { useRouter } from 'vue-router';
import { useAuthStore } from '../stores/auth';

const router = useRouter();
const authStore = useAuthStore();

const form = reactive({
  username: '',
  password: ''
});
const loading = ref(false);

const oidcEnabled = computed(() => Boolean(authStore.providers?.oidc.enabled));
const hasDemoAccounts = computed(() => authStore.demoAccounts.length > 0);
const canSubmit = computed(() => form.username.trim().length > 0 && form.password.length > 0);
const providerStatusText = computed(() => (oidcEnabled.value ? '统一身份已接入' : '本地账号登录'));
const providerStatusType = computed(() => (oidcEnabled.value ? 'success' : 'info'));

const workflowSteps = [
  {
    icon: Picture,
    title: '照片线索',
    desc: '汇集群众照片、位置和现场描述'
  },
  {
    icon: Location,
    title: '空间定位',
    desc: '补齐坐标、行政区和风险点关联'
  },
  {
    icon: RefreshRight,
    title: '复核流转',
    desc: '完成初筛后交给专业人员确认'
  }
];

const heroStats = [
  {
    value: '1',
    label: '公开入口',
    desc: '群众端独立提交现场线索'
  },
  {
    value: '3',
    label: '核心动作',
    desc: '补录、初筛、转交复核'
  },
  {
    value: '轻量',
    label: '业务边界',
    desc: '补充线索，不替代监测平台'
  }
];

async function submit() {
  if (loading.value || !canSubmit.value) {
    return;
  }

  loading.value = true;
  try {
    await authStore.login({ username: form.username.trim(), password: form.password });
    ElMessage.success('登录成功，正在进入平台。');
    router.push('/');
  } catch (error) {
    ElMessage.error('登录失败，请检查账号密码。');
    console.error(error);
  } finally {
    loading.value = false;
  }
}

function applyDemoAccount(account: { username: string; password: string }) {
  form.username = account.username;
  form.password = account.password;
}

function openPublicSubmit() {
  router.push('/submit');
}

onMounted(async () => {
  try {
    await authStore.fetchProviders();
  } catch (error) {
    console.error(error);
  }
});
</script>

<template>
  <div class="login-page">
    <section class="login-hero" aria-label="平台说明">
      <div class="login-hero-main">
        <div class="login-brand-row">
          <span class="brand-mark login-brand-mark">G</span>
          <div>
            <div class="section-kicker">GeoProphet 2026</div>
            <strong>群众线索补充后台</strong>
          </div>
        </div>

        <h1>把群众线索转成可复核处置任务</h1>
        <p>
          面向值班员、网格员和基层干部，统一接收群众照片、位置和现场描述，支撑快速补录、初筛和复核流转。
        </p>

        <div class="login-flow">
          <article v-for="step in workflowSteps" :key="step.title">
            <span>
              <el-icon><component :is="step.icon" /></el-icon>
            </span>
            <div>
              <strong>{{ step.title }}</strong>
              <p>{{ step.desc }}</p>
            </div>
          </article>
        </div>
      </div>

      <div class="login-map-preview" aria-hidden="true">
        <div class="map-grid-lines"></div>
        <div class="map-card map-card--photo">
          <span>PHOTO</span>
          <strong>现场照片</strong>
          <small>3 张待初筛</small>
        </div>
        <div class="map-card map-card--task">
          <span>TASK</span>
          <strong>复核任务</strong>
          <small>已关联位置</small>
        </div>
        <span class="map-pin map-pin--primary"></span>
        <span class="map-pin map-pin--warning"></span>
        <span class="map-route"></span>
      </div>

      <div class="hero-grid">
        <article v-for="item in heroStats" :key="item.label">
          <strong>{{ item.value }}</strong>
          <div>{{ item.label }}</div>
          <p>{{ item.desc }}</p>
        </article>
      </div>
    </section>

    <section class="login-panel" aria-label="后台登录">
      <div class="login-panel-head">
        <div>
          <div class="section-kicker">Access</div>
          <h2>后台登录</h2>
          <p>进入线索补录、审核和流转工作台。</p>
        </div>
        <el-tag class="login-mode-tag" :type="providerStatusType">
          {{ providerStatusText }}
        </el-tag>
      </div>

      <div class="login-status-strip">
        <span>
          <el-icon><Connection /></el-icon>
          账号密码
        </span>
        <span>
          <el-icon><Finished /></el-icon>
          审计追踪
        </span>
      </div>

      <el-form class="login-form" label-position="top" @submit.prevent="submit">
        <el-form-item label="用户名">
          <el-input
            v-model="form.username"
            :prefix-icon="User"
            autocomplete="username"
            clearable
            placeholder="请输入用户名"
            size="large"
          />
        </el-form-item>
        <el-form-item label="密码">
          <el-input
            v-model="form.password"
            :prefix-icon="Lock"
            autocomplete="current-password"
            show-password
            placeholder="请输入密码"
            size="large"
          />
        </el-form-item>

        <div class="action-grid login-actions">
          <el-button
            type="primary"
            :loading="loading"
            native-type="submit"
            :disabled="!canSubmit"
          >
            进入平台
            <el-icon class="el-icon--right"><Right /></el-icon>
          </el-button>
          <el-button plain :icon="ChatDotRound" @click="openPublicSubmit">公开提交页</el-button>
        </div>
      </el-form>

      <template v-if="hasDemoAccounts">
        <el-divider content-position="left">快速填充</el-divider>

        <div class="demo-account-grid">
          <button
            v-for="account in authStore.demoAccounts"
            :key="account.username"
            type="button"
            class="demo-account-button"
            @click="applyDemoAccount(account)"
          >
            <strong>{{ account.username }}</strong>
            <span>{{ account.role }}</span>
          </button>
        </div>

        <p class="table-note">演示账号仅在 demo 模式展示。</p>
      </template>

      <div class="login-footnote">
        <el-icon><CircleCheck /></el-icon>
        <span>登录行为会记录到审计日志，便于追溯。</span>
      </div>
    </section>
  </div>
</template>
