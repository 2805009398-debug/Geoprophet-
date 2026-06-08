<script setup lang="ts">
import {
  Connection,
  DataLine,
  Finished,
  MapLocation,
  Refresh,
  Warning
} from '@element-plus/icons-vue';
import { computed, onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { api } from '../lib/api';
import StatCard from '../components/StatCard.vue';
import type {
  MonitoringDailyOverview,
  MonitoringDataSource,
  MonitoringHazardPatch,
  MonitoringReviewItem,
  MonitoringWorkflowStep
} from '../types';

const router = useRouter();
const loading = ref(false);
const overview = ref<MonitoringDailyOverview | null>(null);

async function fetchOverview() {
  loading.value = true;
  try {
    const response = await api.get<MonitoringDailyOverview>('/monitoring/daily');
    overview.value = response.data;
  } finally {
    loading.value = false;
  }
}

const workflowActiveIndex = computed(() => {
  const steps = overview.value?.workflow ?? [];
  const runningIndex = steps.findIndex((step) => step.status === 'running');
  if (runningIndex >= 0) return runningIndex;
  return Math.max(steps.filter((step) => step.status === 'done').length - 1, 0);
});

const highRiskPatches = computed(() =>
  (overview.value?.hazardPatches ?? []).filter((patch) => ['high', 'critical'].includes(patch.riskLevel))
);

function stepStatus(step: MonitoringWorkflowStep) {
  if (step.status === 'done') return 'success';
  if (step.status === 'running') return 'process';
  return 'wait';
}

function sourceTagType(source: MonitoringDataSource) {
  if (source.status === 'ready') return 'success';
  if (source.status === 'running') return 'warning';
  if (source.status === 'standby') return 'info';
  return undefined;
}

function riskTagType(level: MonitoringHazardPatch['riskLevel'] | MonitoringReviewItem['riskLevel']) {
  if (level === 'critical') return 'danger';
  if (level === 'high') return 'warning';
  if (level === 'medium') return 'info';
  return 'success';
}

function formatPercent(value: number) {
  return `${Math.round(value * 100)}%`;
}

function syncRemoteSensing() {
  router.push('/data-center');
}

function openDetection() {
  router.push('/landslide-detection');
}

onMounted(fetchOverview);
</script>

<template>
  <div class="page-stack" v-loading="loading">
    <section class="page-intro monitoring-intro">
      <div>
        <div class="section-kicker">tog daily monitoring</div>
        <h3 class="section-title">政府端每日自动化遥感监测</h3>
        <p class="section-desc">按 AOI 定时调度公开遥感与降雨数据，叠加 DEM、历史灾害点、群众图像和 YOLO 初筛结果。</p>
      </div>
      <div class="info-strip">
        <span class="info-chip">
          <el-icon><MapLocation /></el-icon>
          {{ overview?.service.targetDate ?? '待同步' }}
        </span>
        <span class="info-chip">
          <el-icon><Connection /></el-icon>
          {{ overview?.service.intervalHours ?? 24 }} 小时调度
        </span>
        <el-button plain :icon="Refresh" @click="fetchOverview">刷新</el-button>
      </div>
    </section>

    <div class="stats-grid">
      <StatCard v-for="stat in overview?.stats ?? []" :key="stat.label" :stat="stat" />
    </div>

    <el-card class="panel-card">
      <template #header>
        <div class="card-head">
          <div>
            <h4 class="section-title section-title--card">监测闭环</h4>
            <p class="section-desc">{{ overview?.service.subtitle ?? '每日调度，有新数据即更新。' }}</p>
          </div>
          <div class="info-strip">
            <el-tag :type="overview?.service.enabled ? 'success' : 'info'">
              {{ overview?.service.enabled ? '调度开启' : '调度未开启' }}
            </el-tag>
            <el-tag v-if="overview?.service.inProgress" type="warning">同步中</el-tag>
          </div>
        </div>
      </template>

      <el-steps :active="workflowActiveIndex" finish-status="success" process-status="process" align-center>
        <el-step
          v-for="step in overview?.workflow ?? []"
          :key="step.key"
          :title="step.title"
          :description="step.detail"
          :status="stepStatus(step)"
        />
      </el-steps>
    </el-card>

    <div class="grid-two monitoring-main-grid">
      <el-card class="panel-card">
        <template #header>
          <div class="card-head">
            <div>
              <h4 class="section-title section-title--card">多源数据补位</h4>
              <p class="section-desc">公开免费数据打底，降雨、DEM 和近地面上报补充验证。</p>
            </div>
            <el-button text type="primary" :icon="DataLine" @click="syncRemoteSensing">数据中心</el-button>
          </div>
        </template>

        <div class="monitoring-source-list">
          <article v-for="source in overview?.dataSources ?? []" :key="source.id" class="monitoring-source-item">
            <div class="monitoring-source-head">
              <div>
                <strong>{{ source.title }}</strong>
                <span>{{ source.source }}</span>
              </div>
              <el-tag :type="sourceTagType(source)">{{ source.status }}</el-tag>
            </div>
            <p>{{ source.usage }}</p>
            <div class="monitoring-source-meter">
              <span>{{ source.availableAssets }} 个资产</span>
              <el-progress :percentage="source.quality" :show-text="false" />
              <span>{{ source.quality }}%</span>
            </div>
          </article>
        </div>
      </el-card>

      <el-card class="panel-card">
        <template #header>
          <div class="card-head">
            <div>
              <h4 class="section-title section-title--card">AOI覆盖</h4>
              <p class="section-desc">政府端配置重点区域，影像按区域形成资产与风险上下文。</p>
            </div>
          </div>
        </template>

        <el-table :data="overview?.regions ?? []" stripe>
          <el-table-column prop="name" label="区域" min-width="160" />
          <el-table-column label="范围" min-width="190">
            <template #default="{ row }">{{ row.bbox.join(', ') }}</template>
          </el-table-column>
          <el-table-column prop="assetCount" label="影像" width="86" />
          <el-table-column prop="activeAlertCount" label="活动预警" width="100" />
        </el-table>
      </el-card>
    </div>

    <div class="grid-two monitoring-main-grid">
      <el-card class="panel-card">
        <template #header>
          <div class="card-head">
            <div>
              <h4 class="section-title section-title--card">疑似风险图斑</h4>
              <p class="section-desc">YOLO/图像线索负责定位，多源融合负责解释和分级。</p>
            </div>
            <el-button text type="primary" :icon="Warning" @click="openDetection">照片初筛</el-button>
          </div>
        </template>

        <div class="patch-list">
          <article v-for="patch in overview?.hazardPatches ?? []" :key="patch.id" class="patch-item">
            <div class="patch-head">
              <div>
                <strong>{{ patch.name }}</strong>
                <span>{{ patch.district }} · {{ patch.hazardType }}</span>
              </div>
              <el-tag :type="riskTagType(patch.riskLevel)">{{ patch.riskLabel }}</el-tag>
            </div>
            <p>{{ patch.reason }}</p>
            <div class="patch-meta">
              <span>{{ patch.source }}</span>
              <span>{{ formatPercent(patch.confidence) }}</span>
              <span>{{ patch.evidenceCount }} 组证据</span>
            </div>
            <div class="patch-action">{{ patch.recommendedAction }}</div>
          </article>
          <el-empty v-if="!overview?.hazardPatches.length" description="暂无疑似风险图斑" />
        </div>
      </el-card>

      <el-card class="panel-card">
        <template #header>
          <div class="card-head">
            <div>
              <h4 class="section-title section-title--card">专家复核队列</h4>
              <p class="section-desc">高风险点、遥感图斑和群众图片初筛结果统一进入复核。</p>
            </div>
          </div>
        </template>

        <el-table :data="overview?.reviewQueue ?? []" stripe>
          <el-table-column prop="type" label="类型" width="118" />
          <el-table-column prop="title" label="事项" min-width="190" />
          <el-table-column label="风险" width="92">
            <template #default="{ row }">
              <el-tag :type="riskTagType(row.riskLevel)">{{ row.riskLevel }}</el-tag>
            </template>
          </el-table-column>
          <el-table-column prop="source" label="来源" min-width="150" />
        </el-table>
      </el-card>
    </div>

    <div class="grid-two monitoring-main-grid">
      <el-card class="panel-card">
        <template #header>
          <div class="card-head">
            <div>
              <h4 class="section-title section-title--card">预警日报草稿</h4>
              <p class="section-desc">把可审核结果转成政府端日报、周报和预警报告口径。</p>
            </div>
            <el-icon class="card-head-icon"><Finished /></el-icon>
          </div>
        </template>

        <div class="report-draft">
          <strong>{{ overview?.reportDraft.title }}</strong>
          <p>{{ overview?.reportDraft.riskSummary }}</p>
          <div class="report-draft-metrics">
            <span>{{ overview?.reportDraft.patchCount ?? 0 }} 个图斑</span>
            <span>{{ overview?.reportDraft.highRiskCount ?? 0 }} 个高风险</span>
            <span>{{ overview?.reportDraft.reviewCount ?? 0 }} 项复核</span>
          </div>
          <ul>
            <li v-for="action in overview?.reportDraft.recommendedActions ?? []" :key="action">{{ action }}</li>
          </ul>
        </div>
      </el-card>

      <el-card class="panel-card">
        <template #header>
          <div class="card-head">
            <div>
              <h4 class="section-title section-title--card">最近同步批次</h4>
              <p class="section-desc">展示每日调度是否稳定、有无失败和新资产数量。</p>
            </div>
          </div>
        </template>

        <el-table :data="overview?.recentRuns ?? []" stripe>
          <el-table-column prop="targetDate" label="日期" width="112" />
          <el-table-column prop="status" label="状态" width="100" />
          <el-table-column prop="assetCount" label="资产" width="84" />
          <el-table-column prop="errorCount" label="失败" width="84" />
          <el-table-column prop="message" label="说明" min-width="220" />
        </el-table>
      </el-card>
    </div>

    <el-alert
      v-if="highRiskPatches.length"
      type="warning"
      show-icon
      :closable="false"
      title="当前存在高风险疑似图斑，建议优先安排专家复核和现场核查。"
    />
  </div>
</template>
