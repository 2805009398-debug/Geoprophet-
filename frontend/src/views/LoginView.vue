<script setup lang="ts">
import { Lock, User } from '@element-plus/icons-vue';
import { ElMessage } from 'element-plus';
import { computed, onMounted, reactive, ref } from 'vue';
import { useRouter } from 'vue-router';
import { useAuthStore } from '../stores/auth';

const router = useRouter();
const authStore = useAuthStore();

const form = reactive({
  username: 'admin',
  password: 'admin123'
});
const loading = ref(false);

const oidcEnabled = computed(() => authStore.providers?.oidc.enabled);

async function submit() {
  loading.value = true;
  try {
    await authStore.login(form);
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
    <section class="login-hero">
      <div>
        <div class="section-kicker">GeoProphet 2026</div>
        <h1>从监测到预警，把白山市地灾态势放到一张图里。</h1>
        <p>
          这个 Web 版聚焦政府监测与联调场景，覆盖数据接收管理、智能研判、预警联动、群众上报和应急预案编制，
          对齐你提供的技术服务要求，并保留 OIDC 单点登录扩展入口。
        </p>
      </div>

      <div class="hero-grid">
        <article>
          <strong>4</strong>
          <div>数据接入通道</div>
          <p>遥感、传感器、视频流、群众上报统一纳管</p>
        </article>
        <article>
          <strong>7x24</strong>
          <div>值守流程</div>
          <p>支持实时预警跟踪、日志审计与应急预案联动</p>
        </article>
        <article>
          <strong>10</strong>
          <div>并发目标</div>
          <p>按照需求文档预留 REST API 对大屏和第三方集成</p>
        </article>
      </div>
    </section>

    <section class="login-panel">
      <div class="section-head">
        <div>
          <div class="section-kicker" style="color: var(--muted)">Access</div>
          <h2 class="section-title">平台登录</h2>
          <p class="section-desc">默认提供本地账号登录，并预留统一身份认证入口。</p>
        </div>
        <el-tag :type="oidcEnabled ? 'success' : 'info'">
          {{ oidcEnabled ? 'OIDC 已配置' : 'OIDC 待配置' }}
        </el-tag>
      </div>

      <el-form label-position="top" @submit.prevent="submit">
        <el-form-item label="用户名">
          <el-input v-model="form.username" :prefix-icon="User" placeholder="请输入用户名" />
        </el-form-item>
        <el-form-item label="密码">
          <el-input
            v-model="form.password"
            :prefix-icon="Lock"
            show-password
            placeholder="请输入密码"
          />
        </el-form-item>

        <div class="grid-two" style="margin-top: 10px">
          <el-button type="primary" :loading="loading" @click="submit">进入平台</el-button>
          <el-button plain :disabled="!oidcEnabled">统一身份认证</el-button>
        </div>
      </el-form>

      <el-divider content-position="left">演示账号</el-divider>

      <div class="info-strip">
        <el-button
          v-for="account in authStore.demoAccounts"
          :key="account.username"
          text
          bg
          @click="applyDemoAccount(account)"
        >
          {{ account.username }} / {{ account.role }}
        </el-button>
      </div>

      <p class="table-note">
        默认账号：`admin / admin123`、`operator / operator123`、`expert / expert123`
      </p>
    </section>
  </div>
</template>

