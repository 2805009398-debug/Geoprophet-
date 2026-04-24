<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { API_BASE_URL, api } from '../lib/api';
import type { PlanItem, RequirementItem } from '../types';

const loading = ref(false);
const plans = ref<PlanItem[]>([]);
const requirements = ref<RequirementItem[]>([]);

async function fetchData() {
  loading.value = true;
  try {
    const [planResponse, requirementResponse] = await Promise.all([
      api.get<{ items: PlanItem[] }>('/plans'),
      api.get<{ items: RequirementItem[] }>('/requirements')
    ]);
    plans.value = planResponse.data.items;
    requirements.value = requirementResponse.data.items;
  } finally {
    loading.value = false;
  }
}

function openApiDocs() {
  window.open(`${API_BASE_URL}/docs`, '_blank');
}

function openHealth() {
  window.open(`${API_BASE_URL}/health`, '_blank');
}

onMounted(fetchData);
</script>

<template>
  <div class="page-stack">
    <el-card class="panel-card">
      <div class="toolbar">
        <div>
          <div class="section-kicker" style="color: var(--muted)">plans</div>
          <h3 class="section-title">应急预案与交付映射</h3>
          <p class="section-desc">把应急方案、系统能力和接口文档放到同一视图里，方便联调与汇报。</p>
        </div>
        <div class="info-strip">
          <el-button type="primary" plain @click="openApiDocs">打开 API 文档</el-button>
          <el-button plain @click="openHealth">健康检查</el-button>
        </div>
      </div>
    </el-card>

    <div class="grid-three" v-loading="loading">
      <article class="plan-card" v-for="plan in plans" :key="plan.id">
        <div class="section-head" style="margin-bottom: 12px">
          <div>
            <strong>{{ plan.title }}</strong>
            <div>{{ plan.level }} · {{ plan.status }}</div>
          </div>
        </div>
        <p>{{ plan.summary }}</p>
        <p class="table-note">责任单位：{{ plan.leader }}</p>
        <p class="table-note">资源：{{ plan.resourceSummary }}</p>
        <p class="table-note">更新时间：{{ plan.updatedAt }}</p>
      </article>
    </div>

    <el-card class="panel-card" v-loading="loading">
      <template #header>
        <div class="section-head" style="margin-bottom: 0">
          <div>
            <h4 class="section-title" style="font-size: 20px">需求覆盖说明</h4>
            <p class="section-desc">基于你提供的服务要求文档，对 MVP 中已实现模块做映射。</p>
          </div>
        </div>
      </template>

      <div class="grid-three">
        <article class="requirement-card" v-for="item in requirements" :key="item.area">
          <strong>{{ item.area }}</strong>
          <p class="table-note" v-for="feature in item.implemented" :key="feature">{{ feature }}</p>
        </article>
      </div>
    </el-card>
  </div>
</template>

