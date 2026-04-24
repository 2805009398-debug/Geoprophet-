<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { api } from '../lib/api';
import type { AssessmentItem, ModelItem } from '../types';

const loading = ref(false);
const models = ref<ModelItem[]>([]);
const assessments = ref<AssessmentItem[]>([]);

async function fetchData() {
  loading.value = true;
  try {
    const [modelResponse, assessmentResponse] = await Promise.all([
      api.get<{ items: ModelItem[] }>('/analysis/models'),
      api.get<{ items: AssessmentItem[] }>('/analysis/assessments')
    ]);
    models.value = modelResponse.data.items;
    assessments.value = assessmentResponse.data.items;
  } finally {
    loading.value = false;
  }
}

function modelTagType(status: string) {
  if (status === 'stable') return 'success';
  if (status === 'training') return 'warning';
  return 'info';
}

onMounted(fetchData);
</script>

<template>
  <div class="page-stack">
    <section class="section-head">
      <div>
        <div class="section-kicker" style="color: var(--muted)">analysis</div>
        <h3 class="section-title">智能研判与影响评估</h3>
        <p class="section-desc">覆盖算法库、趋势模型和灾害影响评估服务产品。</p>
      </div>
    </section>

    <div class="grid-two">
      <article class="model-card" v-for="model in models" :key="model.id">
        <div class="section-head" style="margin-bottom: 12px">
          <div>
            <strong>{{ model.name }}</strong>
            <div>{{ model.category }} · {{ model.version }}</div>
          </div>
          <el-tag :type="modelTagType(model.status)">{{ model.status }}</el-tag>
        </div>
        <el-progress :percentage="Math.round(model.accuracy * 100)" color="#0f766e" />
        <p class="table-note">{{ model.summary }}</p>
        <p class="table-note">最近执行：{{ model.lastRunAt }}</p>
      </article>
    </div>

    <el-card class="panel-card" v-loading="loading">
      <template #header>
        <div class="section-head" style="margin-bottom: 0">
          <div>
            <h4 class="section-title" style="font-size: 20px">灾情影响评估结果</h4>
            <p class="section-desc">辅助生成受灾人口、经济损失和道路影响分析产品。</p>
          </div>
        </div>
      </template>

      <el-table :data="assessments" stripe>
        <el-table-column prop="siteName" label="监测点" min-width="160" />
        <el-table-column prop="district" label="区县" width="110" />
        <el-table-column prop="level" label="等级" width="110" />
        <el-table-column prop="populationAffected" label="影响人口" width="110" />
        <el-table-column label="经济损失" width="120">
          <template #default="{ row }">{{ row.economicLoss }} 万元</template>
        </el-table-column>
        <el-table-column prop="roadImpact" label="道路影响" min-width="200" />
        <el-table-column prop="summary" label="评估摘要" min-width="300" />
      </el-table>
    </el-card>
  </div>
</template>

