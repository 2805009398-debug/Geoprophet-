<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue';
import type { EChartsOption } from 'echarts';
import { ElMessage } from 'element-plus';
import TrendChart from '../components/TrendChart.vue';
import { api } from '../lib/api';
import type { SiteDetail, SiteObservation, SiteSummary } from '../types';

const loading = ref(false);
const detailLoading = ref(false);
const items = ref<SiteSummary[]>([]);
const detailVisible = ref(false);
const detail = ref<SiteDetail | null>(null);
const activeSensorName = ref('');

const filters = reactive({
  riskLevel: '',
  status: '',
  keyword: ''
});

async function fetchSites() {
  loading.value = true;
  try {
    const params = Object.fromEntries(Object.entries(filters).filter(([, value]) => value));
    const { data } = await api.get<{ items: SiteSummary[] }>('/sites', { params });
    items.value = data.items;
  } finally {
    loading.value = false;
  }
}

async function openDetail(row: SiteSummary) {
  detailLoading.value = true;
  detailVisible.value = true;
  try {
    const { data } = await api.get<SiteDetail>(`/sites/${row.id}`);
    detail.value = data;
  } catch (error) {
    ElMessage.error('监测点详情加载失败。');
    console.error(error);
  } finally {
    detailLoading.value = false;
  }
}

const groupedObservations = computed(() => {
  const groups = new Map<string, SiteObservation[]>();
  for (const item of detail.value?.observations ?? []) {
    const list = groups.get(item.sensorName) ?? [];
    list.push(item);
    groups.set(item.sensorName, list);
  }
  return Array.from(groups.entries()).map(([name, points]) => ({
    name,
    points: [...points].reverse(),
    unit: points[0]?.unit ?? ''
  }));
});

watch(
  groupedObservations,
  (groups) => {
    activeSensorName.value = groups[0]?.name ?? '';
  },
  { immediate: true }
);

const activeSeries = computed(() => {
  return groupedObservations.value.find((group) => group.name === activeSensorName.value);
});

const chartOption = computed<EChartsOption>(() => ({
  tooltip: { trigger: 'axis' },
  xAxis: {
    type: 'category',
    data: activeSeries.value?.points.map((item) => item.observedAt.slice(11, 16)) ?? []
  },
  yAxis: {
    type: 'value',
    name: activeSeries.value?.unit ?? ''
  },
  series: [
    {
      type: 'line',
      smooth: true,
      data: activeSeries.value?.points.map((item) => item.value) ?? [],
      lineStyle: { color: '#0f766e' },
      areaStyle: { color: 'rgba(15, 118, 110, 0.12)' }
    }
  ]
}));

function riskTagType(level: string) {
  if (level === 'critical') return 'danger';
  if (level === 'high') return 'warning';
  if (level === 'medium') return 'success';
  return 'info';
}

function statusTagType(status: string) {
  if (status === 'warning' || status === 'alert' || status === 'active') return 'danger';
  if (status === 'watch') return 'warning';
  return 'success';
}

onMounted(fetchSites);
</script>

<template>
  <div class="page-stack">
    <el-card class="panel-card">
      <div class="toolbar">
        <div>
          <div class="section-kicker" style="color: var(--muted)">sites</div>
          <h3 class="section-title">监测点位管理</h3>
          <p class="section-desc">按区县、风险等级和运行状态查看白山市重点隐患点。</p>
        </div>
        <el-form inline>
          <el-form-item>
            <el-select v-model="filters.riskLevel" placeholder="风险等级" clearable style="width: 130px">
              <el-option label="极高" value="critical" />
              <el-option label="高" value="high" />
              <el-option label="中" value="medium" />
              <el-option label="低" value="low" />
            </el-select>
          </el-form-item>
          <el-form-item>
            <el-select v-model="filters.status" placeholder="运行状态" clearable style="width: 130px">
              <el-option label="warning" value="warning" />
              <el-option label="alert" value="alert" />
              <el-option label="watch" value="watch" />
              <el-option label="normal" value="normal" />
            </el-select>
          </el-form-item>
          <el-form-item>
            <el-input v-model="filters.keyword" placeholder="搜索点位或区县" clearable />
          </el-form-item>
          <el-form-item>
            <el-button type="primary" @click="fetchSites">查询</el-button>
          </el-form-item>
        </el-form>
      </div>
    </el-card>

    <el-card class="panel-card" v-loading="loading">
      <el-table :data="items" stripe @row-click="openDetail">
        <el-table-column prop="code" label="编号" width="120" />
        <el-table-column prop="name" label="监测点" min-width="180" />
        <el-table-column prop="district" label="区县" width="110" />
        <el-table-column prop="hazardType" label="类型" width="100" />
        <el-table-column label="风险等级" width="110">
          <template #default="{ row }">
            <el-tag :type="riskTagType(row.riskLevel)">{{ row.riskLevel }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="状态" width="110">
          <template #default="{ row }">
            <el-tag :type="statusTagType(row.status)">{{ row.status }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="sensorCount" label="传感器" width="90" />
        <el-table-column prop="activeAlerts" label="活动预警" width="100" />
        <el-table-column prop="lastInspectionAt" label="最近巡检" width="170" />
      </el-table>
    </el-card>

    <el-drawer v-model="detailVisible" size="58%" :with-header="false">
      <div v-if="detail" class="page-stack" v-loading="detailLoading">
        <div>
          <div class="section-kicker" style="color: var(--muted)">site detail</div>
          <h3 class="section-title">{{ detail.site.name }}</h3>
          <p class="section-desc">{{ detail.site.description }}</p>
          <div class="info-strip" style="margin-top: 12px">
            <span class="info-chip">区县：{{ detail.site.district }}</span>
            <span class="info-chip">类型：{{ detail.site.hazardType }}</span>
            <span class="info-chip">坐标：{{ detail.site.lat }}, {{ detail.site.lng }}</span>
          </div>
        </div>

        <div class="sensor-grid">
          <div class="sensor-tile" v-for="sensor in detail.sensors" :key="sensor.id">
            <strong>{{ sensor.name }}</strong>
            <div>{{ sensor.sensorType }} · {{ sensor.unit }}</div>
            <div class="table-note">最新值：{{ sensor.lastValue }}，采集于 {{ sensor.lastCollectedAt }}</div>
          </div>
        </div>

        <el-card class="panel-card">
          <template #header>
            <div class="section-head" style="margin-bottom: 0">
              <div>
                <h4 class="section-title" style="font-size: 20px">传感器趋势</h4>
                <p class="section-desc">按单传感器查看最近观测变化。</p>
              </div>
              <el-radio-group v-model="activeSensorName" size="small">
                <el-radio-button
                  v-for="group in groupedObservations"
                  :key="group.name"
                  :value="group.name"
                >
                  {{ group.name }}
                </el-radio-button>
              </el-radio-group>
            </div>
          </template>
          <TrendChart :option="chartOption" />
        </el-card>

        <el-card class="panel-card" v-if="detail.assessment">
          <template #header>
            <div class="section-head" style="margin-bottom: 0">
              <div>
                <h4 class="section-title" style="font-size: 20px">最新影响评估</h4>
                <p class="section-desc">用于形成标准化评估产品和处置建议。</p>
              </div>
            </div>
          </template>
          <div class="grid-three">
            <div class="sensor-tile">
              <strong>{{ detail.assessment.level }}</strong>
              <div>综合等级</div>
            </div>
            <div class="sensor-tile">
              <strong>{{ detail.assessment.populationAffected }}</strong>
              <div>受影响人口</div>
            </div>
            <div class="sensor-tile">
              <strong>{{ detail.assessment.economicLoss }} 万元</strong>
              <div>预估经济损失</div>
            </div>
          </div>
          <p class="table-note" style="margin-top: 14px">{{ detail.assessment.summary }}</p>
        </el-card>
      </div>
    </el-drawer>
  </div>
</template>

