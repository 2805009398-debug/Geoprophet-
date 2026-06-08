<script setup lang="ts">
import { onMounted, ref } from 'vue';
import LandslideDetectionWorkbench from '../components/LandslideDetectionWorkbench.vue';
import { api, toAbsoluteAssetUrl } from '../lib/api';
import type { AnalysisRunItem } from '../types';

const loading = ref(false);
const runs = ref<AnalysisRunItem[]>([]);

const channelCards = [
  {
    title: '输入通道',
    value: '航拍 / 巡查图',
    desc: '面向无人机航拍图、巡查照片和现场可见光图片。'
  },
  {
    title: '初筛模型',
    value: 'YOLO / 豆包',
    desc: '本地模型负责航拍初筛，豆包视觉用于移动端现场图片初审。'
  },
  {
    title: '输出结果',
    value: '复核建议',
    desc: '输出风险分数、疑似区域和后续人工复核建议。'
  }
];

async function fetchRuns() {
  loading.value = true;
  try {
    const response = await api.get<{ items: AnalysisRunItem[] }>('/analysis/runs?limit=10');
    runs.value = response.data.items;
  } finally {
    loading.value = false;
  }
}

function formatPercent(value: number) {
  return `${Math.round(value * 100)}%`;
}

onMounted(fetchRuns);
</script>

<template>
  <div class="page-stack">
    <section class="page-intro">
      <div>
        <div class="section-kicker">image screening</div>
        <h3 class="section-title">航拍图像滑坡初筛</h3>
        <p class="section-desc">支持本地 YOLO 初筛和豆包视觉识别，结果进入值班人员复核。</p>
      </div>
    </section>

    <div class="grid-three">
      <article class="channel-card" v-for="card in channelCards" :key="card.title">
        <strong>{{ card.value }}</strong>
        <div>{{ card.title }}</div>
        <p class="table-note">{{ card.desc }}</p>
      </article>
    </div>

    <LandslideDetectionWorkbench
      title="照片地灾初筛"
      description="上传航拍图、无人机照片或现场巡查图片后，选择本地 YOLO 或豆包视觉输出疑似区域、风险分数和复核建议。"
      @completed="fetchRuns"
    />

    <el-card class="panel-card" v-loading="loading">
      <template #header>
        <div class="card-head">
          <div>
            <h4 class="section-title section-title--card">初筛记录</h4>
            <p class="section-desc">用于值班复核、模型回溯和线索处置留痕。</p>
          </div>
        </div>
      </template>

      <el-table :data="runs" stripe>
        <el-table-column prop="createdAt" label="时间" width="180" />
        <el-table-column prop="modelName" label="模型" min-width="160" />
        <el-table-column label="源文件" min-width="220">
          <template #default="{ row }">
            <a :href="toAbsoluteAssetUrl(row.sourceUrl)" target="_blank" rel="noreferrer">{{ row.sourceName }}</a>
          </template>
        </el-table-column>
        <el-table-column label="置信度" width="110">
          <template #default="{ row }">{{ formatPercent(row.confidence) }}</template>
        </el-table-column>
        <el-table-column prop="summary" label="结果摘要" min-width="320" />
      </el-table>
    </el-card>
  </div>
</template>
