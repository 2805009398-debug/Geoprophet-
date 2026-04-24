<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import type { EChartsOption } from 'echarts';
import { api } from '../lib/api';
import SiteMap from '../components/SiteMap.vue';
import StatCard from '../components/StatCard.vue';
import TrendChart from '../components/TrendChart.vue';
import type { DashboardOverview } from '../types';

const loading = ref(false);
const overview = ref<DashboardOverview | null>(null);

const riskLabels: Record<string, string> = {
  critical: '极高风险',
  high: '高风险',
  medium: '中风险',
  low: '低风险'
};

async function fetchOverview() {
  loading.value = true;
  try {
    const { data } = await api.get<DashboardOverview>('/dashboard/overview');
    overview.value = data;
  } finally {
    loading.value = false;
  }
}

const alertTrendOption = computed<EChartsOption>(() => ({
  tooltip: { trigger: 'axis' },
  xAxis: {
    type: 'category',
    data: overview.value?.alertTrend.labels ?? []
  },
  yAxis: { type: 'value' },
  series: [
    {
      data: overview.value?.alertTrend.series ?? [],
      type: 'line',
      smooth: true,
      areaStyle: { color: 'rgba(220, 38, 38, 0.12)' },
      lineStyle: { color: '#dc2626' }
    }
  ]
}));

const reportTrendOption = computed<EChartsOption>(() => ({
  tooltip: { trigger: 'axis' },
  xAxis: {
    type: 'category',
    data: overview.value?.reportTrend.labels ?? []
  },
  yAxis: { type: 'value' },
  series: [
    {
      data: overview.value?.reportTrend.series ?? [],
      type: 'bar',
      itemStyle: { color: '#0f766e', borderRadius: [8, 8, 0, 0] }
    }
  ]
}));

const riskOption = computed<EChartsOption>(() => ({
  tooltip: { trigger: 'item' },
  legend: {
    orient: 'vertical',
    right: 0,
    top: 'middle'
  },
  series: [
    {
      type: 'pie',
      radius: ['40%', '68%'],
      center: ['36%', '50%'],
      itemStyle: {
        borderRadius: 10
      },
      data:
        overview.value?.riskDistribution.map((item) => ({
          name: riskLabels[item.riskLevel ?? 'low'] ?? item.riskLevel,
          value: item.total
        })) ?? []
    }
  ]
}));

const severityType: Record<string, 'success' | 'warning' | 'danger' | 'info'> = {
  low: 'success',
  medium: 'warning',
  high: 'danger',
  critical: 'danger'
};

onMounted(fetchOverview);
</script>

<template>
  <div class="page-stack">
    <section class="section-head">
      <div>
        <div class="section-kicker" style="color: var(--muted)">overview</div>
        <h3 class="section-title">白山市地灾综合态势</h3>
        <p class="section-desc">聚合监测点、预警、群众上报和处置任务，形成一个值守首页。</p>
      </div>
    </section>

    <div class="stats-grid" v-if="overview">
      <StatCard v-for="stat in overview.stats" :key="stat.label" :stat="stat" />
    </div>

    <div class="split-card">
      <el-card class="panel-card" v-loading="loading">
        <template #header>
          <div class="section-head" style="margin-bottom: 0">
            <div>
              <h4 class="section-title" style="font-size: 20px">监测点位地图</h4>
              <p class="section-desc">根据当前风险等级和活动预警数量动态着色。</p>
            </div>
          </div>
        </template>
        <SiteMap :points="overview?.siteMap ?? []" />
      </el-card>

      <el-card class="panel-card" v-loading="loading">
        <template #header>
          <div class="section-head" style="margin-bottom: 0">
            <div>
              <h4 class="section-title" style="font-size: 20px">风险结构</h4>
              <p class="section-desc">按监测点风险等级拆分当前资源关注重心。</p>
            </div>
          </div>
        </template>
        <TrendChart :option="riskOption" />
      </el-card>
    </div>

    <div class="grid-two">
      <el-card class="panel-card" v-loading="loading">
        <template #header>
          <div class="section-head" style="margin-bottom: 0">
            <div>
              <h4 class="section-title" style="font-size: 20px">预警趋势</h4>
              <p class="section-desc">最近 7 天活动预警数量变化。</p>
            </div>
          </div>
        </template>
        <TrendChart :option="alertTrendOption" />
      </el-card>

      <el-card class="panel-card" v-loading="loading">
        <template #header>
          <div class="section-head" style="margin-bottom: 0">
            <div>
              <h4 class="section-title" style="font-size: 20px">群众上报趋势</h4>
              <p class="section-desc">辅助查看公众参与数据是否异常集中。</p>
            </div>
          </div>
        </template>
        <TrendChart :option="reportTrendOption" />
      </el-card>
    </div>

    <div class="grid-two">
      <el-card class="panel-card" v-loading="loading">
        <template #header>
          <div class="section-head" style="margin-bottom: 0">
            <div>
              <h4 class="section-title" style="font-size: 20px">最新预警</h4>
              <p class="section-desc">值班期间需要优先处置的风险列表。</p>
            </div>
          </div>
        </template>

        <el-table :data="overview?.recentAlerts ?? []" stripe>
          <el-table-column prop="siteName" label="点位" min-width="140" />
          <el-table-column prop="title" label="预警" min-width="200" />
          <el-table-column label="等级" width="110">
            <template #default="{ row }">
              <el-tag :type="severityType[row.severity]">{{ row.severity }}</el-tag>
            </template>
          </el-table-column>
          <el-table-column prop="source" label="来源" width="120" />
          <el-table-column prop="createdAt" label="时间" width="170" />
        </el-table>
      </el-card>

      <el-card class="panel-card" v-loading="loading">
        <template #header>
          <div class="section-head" style="margin-bottom: 0">
            <div>
              <h4 class="section-title" style="font-size: 20px">系统事件流</h4>
              <p class="section-desc">串联数据接收、分析、预警与调度过程。</p>
            </div>
          </div>
        </template>

        <div class="feed-list">
          <div class="feed-item" v-for="item in overview?.recentFeed ?? []" :key="item.id">
            <time>{{ item.createdAt.slice(11, 16) }}</time>
            <el-tag size="small">{{ item.category }}</el-tag>
            <div>{{ item.message }}</div>
          </div>
        </div>
      </el-card>
    </div>
  </div>
</template>

