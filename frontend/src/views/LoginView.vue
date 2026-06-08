<script setup lang="ts">
import { ChatDotRound, Lock, User } from '@element-plus/icons-vue';
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

const oidcEnabled = computed(() => authStore.providers?.oidc.enabled);
const hasDemoAccounts = computed(() => authStore.demoAccounts.length > 0);

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
    <section class="login-hero">
      <div>
        <div class="section-kicker">GeoProphet 2026</div>
        <h1>群众线索补充后台</h1>
        <p>
          面向值班员、网格员和基层干部，统一处理群众照片、位置和现场描述，完成补录、初筛和复核流转。
        </p>
      </div>

      <div class="hero-grid">
        <article>
          <strong>1</strong>
          <div>公开入口</div>
          <p>群众无需登录即可提交现场照片和位置</p>
        </article>
        <article>
          <strong>3</strong>
          <div>核心动作</div>
          <p>补录、初筛、转交复核</p>
        </article>
        <article>
          <strong>轻量</strong>
          <div>业务边界</div>
          <p>补充线索，不替代政府监测平台</p>
        </article>
      </div>
    </section>

    <section class="login-panel">
      <div class="section-head">
        <div>
          <div class="section-kicker">Access</div>
          <h2 class="section-title">后台登录</h2>
          <p class="section-desc">值班人员在这里处理群众线索；群众端请直接使用公开提交页。</p>
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

        <div class="action-grid">
          <el-button type="primary" :loading="loading" @click="submit">进入平台</el-button>
          <el-button plain :icon="ChatDotRound" @click="openPublicSubmit">公开提交页</el-button>
        </div>
      </el-form>

      <template v-if="hasDemoAccounts">
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

        <p class="table-note">演示账号仅在 demo 模式展示。</p>
      </template>
    </section>
  </div>
</template>
