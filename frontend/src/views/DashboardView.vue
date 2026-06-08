<script setup lang="ts">
import { ChatDotRound, Position, Search } from '@element-plus/icons-vue';
import { computed, onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import type { EChartsOption } from 'echarts';
import { api } from '../lib/api';
import StatCard from '../components/StatCard.vue';
import TrendChart from '../components/TrendChart.vue';
import type { DashboardOverview, DashboardStat, ReportItem } from '../types';

const router = useRouter();

const loading = ref(false);
const overview = ref<DashboardOverview | null>(null);
const reports = ref<ReportItem[]>([]);

async function fetchData() {
  loading.value = true;
  try {
    const [overviewResponse, reportsResponse] = await Promise.all([
      api.get<DashboardOverview>('/dashboard/overview'),
      api.get<{ items: ReportItem[] }>('/reports')
    ]);
    overview.value = overviewResponse.data;
    reports.value = reportsResponse.data.items;
  } finally {
    loading.value = false;
  }
}

const pendingReports = computed(() => reports.value.filter((item) => item.status === 'pending'));
const reportsWithImage = computed(() => reports.value.filter((item) => Boolean(item.imageUrl)));
const latestReports = computed(() => reports.value.slice(0, 6));
const primaryColor = '#0f766e';

const evidenceStats = computed<DashboardStat[]>(() => [
  {
    label: '待复核线索',
    value: pendingReports.value.length,
    suffix: '条',
    tone: 'warning',
    hint: '群众补充的现场情况，等待值班人员核验'
  },
  {
    label: '带图举证',
    value: reportsWithImage.value.length,
    suffix: '条',
    tone: 'primary',
    hint: '有照片、位置和描述，更容易进入复核流程'
  },
  {
    label: '政府参考预警',
    value: overview.value?.recentAlerts.length ?? 0,
    suffix: '条',
    tone: 'danger',
    hint: '仅作背景参照，不替代政府已有平台'
  },
  {
    label: '近 7 日提交',
    value: overview.value?.reportTrend.series.reduce((total, item) => total + item, 0) ?? 0,
    suffix: '条',
    tone: 'success',
    hint: '观察群众参与热度和集中区域'
  }
]);

const reportTrendOption = computed<EChartsOption>(() => ({
  tooltip: { trigger: 'axis' },
  grid: { left: 36, right: 18, top: 24, bottom: 32 },
  xAxis: {
    type: 'category',
    data: overview.value?.reportTrend.labels ?? []
  },
  yAxis: { type: 'value' },
  series: [
    {
      name: '线索',
      data: overview.value?.reportTrend.series ?? [],
      type: 'bar',
      itemStyle: { color: primaryColor, borderRadius: [6, 6, 0, 0] }
    }
  ]
}));

const typeCounts = computed(() => {
  const counts = new Map<string, number>();
  for (const report of reports.value) {
    counts.set(report.reportType, (counts.get(report.reportType) ?? 0) + 1);
  }

  return Array.from(counts.entries())
    .map(([type, count]) => ({ type, count }))
    .sort((a, b) => b.count - a.count);
});

function statusTagType(status: string) {
  if (status === 'verified') return 'success';
  if (status === 'reviewing') return 'warning';
  return 'info';
}

function openReports() {
  router.push('/reports');
}

function openDetection() {
  router.push('/landslide-detection');
}

function openPublicSubmit() {
  window.open('/submit', '_blank', 'noopener,noreferrer');
}

onMounted(fetchData);
</script>

<template>
  <div class="page-stack">
    <section class="page-intro">
      <div>
        <div class="section-kicker">public evidence</div>
        <h3 class="section-title">群众线索总览</h3>
        <p class="section-desc">这里优先处理待复核、带图和高价值线索；政府预警只作为上下文参考。</p>
      </div>
      <div class="info-strip">
        <el-button type="primary" :icon="ChatDotRound" @click="openReports">录入线索</el-button>
        <el-button plain :icon="Position" @click="openPublicSubmit">打开公开页</el-button>
        <el-button plain :icon="Search" @click="openDetection">照片初筛</el-button>
      </div>
    </section>

    <div class="stats-grid">
      <StatCard v-for="stat in evidenceStats" :key="stat.label" :stat="stat" />
    </div>

    <div class="grid-two">
      <el-card class="panel-card" v-loading="loading">
        <template #header>
          <div class="card-head">
            <div>
              <h4 class="section-title section-title--card">群众线索趋势</h4>
              <p class="section-desc">只看群众补充，不再重复展示完整监管态势。</p>
            </div>
          </div>
        </template>
        <TrendChart :option="reportTrendOption" />
      </el-card>

      <el-card class="panel-card" v-loading="loading">
        <template #header>
          <div class="card-head">
            <div>
              <h4 class="section-title section-title--card">线索类型</h4>
              <p class="section-desc">帮助值班人员快速判断群众主要在反馈什么。</p>
            </div>
          </div>
        </template>
        <div class="evidence-type-list">
          <article v-for="item in typeCounts" :key="item.type" class="evidence-type-item">
            <div>
              <strong>{{ item.type }}</strong>
              <span>{{ item.count }} 条</span>
            </div>
            <el-progress
              :percentage="reports.length ? Math.round((item.count / reports.length) * 100) : 0"
              :color="primaryColor"
            />
          </article>
          <el-empty v-if="typeCounts.length === 0" description="暂无群众线索" />
        </div>
      </el-card>
    </div>

    <div class="grid-two">
      <el-card class="panel-card" v-loading="loading">
        <template #header>
          <div class="card-head">
            <div>
              <h4 class="section-title section-title--card">最新群众举证</h4>
              <p class="section-desc">后台只做线索清洗、补充和转给政府端复核。</p>
            </div>
            <el-button type="primary" text @click="openReports">去处理</el-button>
          </div>
        </template>

        <el-table :data="latestReports" stripe>
          <el-table-column prop="title" label="线索" min-width="180" />
          <el-table-column prop="reportType" label="类型" width="90" />
          <el-table-column label="状态" width="110">
            <template #default="{ row }">
              <el-tag :type="statusTagType(row.status)">{{ row.status }}</el-tag>
            </template>
          </el-table-column>
          <el-table-column label="举证完整度" width="120">
            <template #default="{ row }">
              {{ row.imageUrl ? '图文+位置' : '文字+位置' }}
            </template>
          </el-table-column>
          <el-table-column prop="createdAt" label="时间" width="170" />
        </el-table>
      </el-card>

      <el-card class="panel-card" v-loading="loading">
        <template #header>
          <div class="card-head">
            <div>
              <h4 class="section-title section-title--card">政府平台参考</h4>
              <p class="section-desc">已有预警不重复建设，只用于给群众线索找上下文。</p>
            </div>
          </div>
        </template>

        <div class="support-feed">
          <article v-for="alert in overview?.recentAlerts.slice(0, 4) ?? []" :key="alert.id">
            <strong>{{ alert.siteName }}</strong>
            <span>{{ alert.title }}</span>
            <p>{{ alert.source }} · {{ alert.createdAt }}</p>
          </article>
          <el-empty v-if="!overview?.recentAlerts.length" description="暂无政府参考预警" />
        </div>
      </el-card>
    </div>
  </div>
</template>
