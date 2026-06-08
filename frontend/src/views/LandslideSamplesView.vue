<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue';
import type { EChartsOption } from 'echarts';
import { Refresh, Search } from '@element-plus/icons-vue';
import { api } from '../lib/api';
import GeoHazardLayerMap from '../components/GeoHazardLayerMap.vue';
import TrendChart from '../components/TrendChart.vue';
import type {
  GeohazardLayerMeta,
  LandslideSampleItem,
  LandslideSampleResponse,
  LandslideSampleSummary
} from '../types';

type DateRange = [string, string] | '';

const loading = ref(false);
const summaryLoading = ref(false);
const summary = ref<LandslideSampleSummary | null>(null);
const sampleResponse = ref<LandslideSampleResponse | null>(null);
const selectedSample = ref<LandslideSampleItem | null>(null);

const filters = reactive({
  keyword: '',
  country: '',
  category: '',
  trigger: '',
  size: '',
  dateRange: '' as DateRange,
  page: 1,
  pageSize: 25
});

const sampleLayer = computed<GeohazardLayerMeta>(() => ({
  id: 'coolr-reports-china-recent-points',
  title: 'COOLR 中国近期滑坡上报点',
  source: 'NASA COOLR',
  theme: '中国公开滑坡样本',
  region: '中国',
  geometryType: 'point',
  path: summary.value?.source.path ?? 'coolr_global/nasa_coolr_reports_points_global.geojson',
  color: '#0f766e',
  description: 'NASA COOLR 中国公开上报点，默认过滤外国样本和 2000 年以前的早期样本。',
  available: true,
  recordCount: summary.value?.summary.total ?? 0,
  bytes: summary.value?.source.bytes ?? 0
}));

const statCards = computed(() => [
  {
    title: '中国近期样本',
    value: summary.value?.summary.total ?? 0,
    desc: '默认仅展示 CN / 2000 年以后'
  },
  {
    title: '已减少样本',
    value: summary.value?.filtering.excludedTotal ?? 0,
    desc: `外国 ${summary.value?.filtering.excludedByCountry ?? 0} / 过早 ${summary.value?.filtering.excludedByDate ?? 0}`
  },
  {
    title: '有日期样本',
    value: summary.value?.summary.dated ?? 0,
    desc: dateRangeLabel.value
  },
  {
    title: '地图预览',
    value: sampleResponse.value?.mapReturned ?? 0,
    desc: sampleResponse.value?.previewLimited ? '已截取前 1000 个点位' : '当前筛选全部点位'
  }
]);

const dateRangeLabel = computed(() => {
  const range = summary.value?.summary.dateRange;
  if (!range?.start || !range.end) {
    return '暂无日期范围';
  }
  return `${range.start} 至 ${range.end}`;
});

const queryParams = computed(() => {
  const params: Record<string, string | number> = {
    limit: filters.pageSize,
    offset: (filters.page - 1) * filters.pageSize,
    mapLimit: 1000
  };

  if (filters.keyword.trim()) {
    params.keyword = filters.keyword.trim();
  }
  if (filters.country) {
    params.country = filters.country;
  }
  if (filters.category) {
    params.category = filters.category;
  }
  if (filters.trigger) {
    params.trigger = filters.trigger;
  }
  if (filters.size) {
    params.size = filters.size;
  }
  if (Array.isArray(filters.dateRange)) {
    params.startDate = filters.dateRange[0];
    params.endDate = filters.dateRange[1];
  }

  return params;
});

const trendOption = computed<EChartsOption>(() => ({
  tooltip: { trigger: 'axis' },
  grid: { left: 42, right: 18, top: 24, bottom: 32 },
  xAxis: {
    type: 'category',
    data: summary.value?.yearlyTrend.map((item) => item.year) ?? []
  },
  yAxis: { type: 'value' },
  series: [
    {
      name: '样本数',
      data: summary.value?.yearlyTrend.map((item) => item.count) ?? [],
      type: 'line',
      smooth: true,
      symbolSize: 4,
      lineStyle: { color: '#0f766e', width: 2 },
      itemStyle: { color: '#0f766e' },
      areaStyle: { color: 'rgba(15, 118, 110, 0.12)' }
    }
  ]
}));

const selectedSampleRows = computed<Array<{ label: string; value: string }>>(() => {
  const sample = selectedSample.value;
  if (!sample) {
    return [];
  }

  return [
    { label: '类别', value: sample.category },
    { label: '触发因素', value: sample.trigger },
    { label: '规模', value: sample.size },
    { label: '国家', value: sample.countryName || sample.countryCode },
    { label: '行政区', value: sample.adminDivision },
    { label: '最近地名', value: sample.closestPlace },
    { label: '位置精度', value: sample.locationAccuracy },
    { label: '事件日期', value: sample.eventDate ?? '' },
    { label: '死亡/受伤', value: `${sample.fatalities} / ${sample.injuries}` },
    { label: '坐标', value: `${sample.lat.toFixed(5)}, ${sample.lng.toFixed(5)}` },
    { label: '来源', value: sample.sourceName }
  ].filter((item) => item.value.trim());
});

async function fetchSummary() {
  summaryLoading.value = true;
  try {
    const response = await api.get<LandslideSampleSummary>('/landslide-samples/summary');
    summary.value = response.data;
  } finally {
    summaryLoading.value = false;
  }
}

async function fetchSamples() {
  loading.value = true;
  try {
    const response = await api.get<LandslideSampleResponse>('/landslide-samples', {
      params: queryParams.value
    });
    sampleResponse.value = response.data;
    selectedSample.value = response.data.items[0] ?? null;
  } finally {
    loading.value = false;
  }
}

async function applyFilters() {
  filters.page = 1;
  await fetchSamples();
}

async function handlePageChange(page: number) {
  filters.page = page;
  await fetchSamples();
}

async function resetFilters() {
  Object.assign(filters, {
    keyword: '',
    country: '',
    category: '',
    trigger: '',
    size: '',
    dateRange: '',
    page: 1,
    pageSize: 25
  });
  await fetchSamples();
}

async function refreshSamples() {
  await Promise.all([fetchSummary(), fetchSamples()]);
}

function handleCurrentChange(row: LandslideSampleItem | null) {
  selectedSample.value = row;
}

function formatBytes(bytes: number) {
  if (bytes >= 1024 * 1024) {
    return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  }
  if (bytes >= 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }
  return `${bytes} B`;
}

function openExternal(url: string) {
  if (url) {
    window.open(url, '_blank', 'noopener,noreferrer');
  }
}

onMounted(async () => {
  await refreshSamples();
});
</script>

<template>
  <div class="page-stack">
    <section class="section-head">
      <div>
        <div class="section-kicker" style="color: var(--muted)">sample library</div>
        <h3 class="section-title">中国近期滑坡样本库</h3>
        <p class="section-desc">
          接入 NASA COOLR 公开上报点，默认仅展示中国样本，并过滤 2000 年以前的早期样本。
        </p>
      </div>
      <div class="info-strip">
        <el-tag type="success">{{ summary?.source.provider ?? 'NASA COOLR' }}</el-tag>
        <el-tag v-if="summary">CN / {{ summary.filtering.minEventDate }} 后</el-tag>
        <el-tag>{{ summary ? formatBytes(summary.source.bytes) : '-' }}</el-tag>
        <el-button :icon="Refresh" :loading="loading || summaryLoading" @click="refreshSamples">
          刷新
        </el-button>
      </div>
    </section>

    <div class="grid-four" v-loading="summaryLoading">
      <article class="channel-card" v-for="card in statCards" :key="card.title">
        <strong>{{ card.value }}</strong>
        <div>{{ card.title }}</div>
        <p class="table-note">{{ card.desc }}</p>
      </article>
    </div>

    <el-card class="panel-card" v-loading="loading">
      <template #header>
        <div class="section-head" style="margin-bottom: 0">
          <div>
            <h4 class="section-title" style="font-size: 20px">样本筛选</h4>
            <p class="section-desc">按地区、灾害类别、触发因素、规模和日期范围继续缩小样本范围。</p>
          </div>
        </div>
      </template>

      <div class="sample-filter-grid">
        <el-input
          v-model="filters.keyword"
          clearable
          placeholder="搜索标题、地点、来源"
          :prefix-icon="Search"
          @keyup.enter="applyFilters"
        />
        <el-select v-model="filters.country" clearable filterable placeholder="国家 / 地区">
          <el-option
            v-for="item in summary?.countries ?? []"
            :key="item.value"
            :label="`${item.label}（${item.count}）`"
            :value="item.value"
          />
        </el-select>
        <el-select v-model="filters.category" clearable filterable placeholder="灾害类别">
          <el-option
            v-for="item in summary?.categories ?? []"
            :key="item.value"
            :label="`${item.label}（${item.count}）`"
            :value="item.value"
          />
        </el-select>
        <el-select v-model="filters.trigger" clearable filterable placeholder="触发因素">
          <el-option
            v-for="item in summary?.triggers ?? []"
            :key="item.value"
            :label="`${item.label}（${item.count}）`"
            :value="item.value"
          />
        </el-select>
        <el-select v-model="filters.size" clearable filterable placeholder="规模">
          <el-option
            v-for="item in summary?.sizes ?? []"
            :key="item.value"
            :label="`${item.label}（${item.count}）`"
            :value="item.value"
          />
        </el-select>
        <el-date-picker
          v-model="filters.dateRange"
          type="daterange"
          value-format="YYYY-MM-DD"
          start-placeholder="开始日期"
          end-placeholder="结束日期"
          style="width: 100%"
        />
        <div class="sample-filter-actions">
          <el-button type="primary" :icon="Search" @click="applyFilters">查询</el-button>
          <el-button @click="resetFilters">重置</el-button>
        </div>
      </div>
    </el-card>

    <div class="sample-workspace-grid">
      <el-card class="panel-card" v-loading="loading">
        <template #header>
          <div class="section-head" style="margin-bottom: 0">
            <div>
              <h4 class="section-title" style="font-size: 20px">地图预览</h4>
              <p class="section-desc">
                当前筛选 {{ sampleResponse?.mapReturned ?? 0 }} / {{ sampleResponse?.total ?? 0 }} 个点位。
              </p>
            </div>
            <el-tag v-if="sampleResponse?.previewLimited" type="warning">预览截取</el-tag>
          </div>
        </template>
        <GeoHazardLayerMap
          :collection="sampleResponse?.featureCollection ?? null"
          :layer="sampleLayer"
        />
      </el-card>

      <el-card class="panel-card">
        <template #header>
          <div class="section-head" style="margin-bottom: 0">
            <div>
              <h4 class="section-title" style="font-size: 20px">样本详情</h4>
              <p class="section-desc">点击表格行查看完整摘要和外部来源。</p>
            </div>
          </div>
        </template>

        <template v-if="selectedSample">
          <div class="sample-detail-head">
            <strong>{{ selectedSample.title }}</strong>
            <span>{{ selectedSample.eventDate ?? '日期未知' }}</span>
          </div>
          <p class="table-note">{{ selectedSample.locationDescription || selectedSample.description || '暂无描述。' }}</p>
          <div class="sample-detail-list">
            <div v-for="row in selectedSampleRows" :key="row.label">
              <span>{{ row.label }}</span>
              <strong>{{ row.value }}</strong>
            </div>
          </div>
          <div class="form-actions sample-detail-actions">
            <el-button v-if="selectedSample.sourceLink" type="primary" plain @click="openExternal(selectedSample.sourceLink)">
              来源链接
            </el-button>
            <el-button v-if="selectedSample.photoLink" plain @click="openExternal(selectedSample.photoLink)">
              现场照片
            </el-button>
          </div>
        </template>
        <el-empty v-else description="暂无样本" />
      </el-card>
    </div>

    <div class="grid-two">
      <el-card class="panel-card" v-loading="summaryLoading">
        <template #header>
          <div class="section-head" style="margin-bottom: 0">
            <div>
              <h4 class="section-title" style="font-size: 20px">年度样本趋势</h4>
              <p class="section-desc">按 COOLR 事件日期聚合，已过滤外国样本和 2000 年以前样本。</p>
            </div>
          </div>
        </template>
        <TrendChart :option="trendOption" />
      </el-card>

      <el-card class="panel-card" v-loading="summaryLoading">
        <template #header>
          <div class="section-head" style="margin-bottom: 0">
            <div>
              <h4 class="section-title" style="font-size: 20px">主要地区分布</h4>
              <p class="section-desc">按省级行政区或最近地名统计，用于判断样本覆盖偏差。</p>
            </div>
          </div>
        </template>

        <div class="sample-rank-list">
          <article v-for="item in summary?.topRegions ?? []" :key="item.value">
            <div>
              <strong>{{ item.label }}</strong>
              <span>{{ item.count }} 条</span>
            </div>
            <el-progress
              :percentage="summary?.summary.total ? Math.round((item.count / summary.summary.total) * 100) : 0"
              color="#0f766e"
            />
          </article>
        </div>
      </el-card>
    </div>

    <el-card class="panel-card" v-loading="loading">
      <template #header>
        <div class="section-head" style="margin-bottom: 0">
          <div>
            <h4 class="section-title" style="font-size: 20px">样本列表</h4>
            <p class="section-desc">当前筛选共 {{ sampleResponse?.total ?? 0 }} 条，表格分页展示。</p>
          </div>
        </div>
      </template>

      <el-table
        :data="sampleResponse?.items ?? []"
        stripe
        highlight-current-row
        @current-change="handleCurrentChange"
      >
        <el-table-column prop="eventDate" label="日期" width="110" />
        <el-table-column prop="title" label="标题" min-width="220" show-overflow-tooltip />
        <el-table-column prop="category" label="类别" width="130" />
        <el-table-column prop="trigger" label="触发" width="130" />
        <el-table-column prop="size" label="规模" width="110" />
        <el-table-column label="位置" min-width="190" show-overflow-tooltip>
          <template #default="{ row }">
            {{ row.countryName || row.countryCode }} {{ row.adminDivision }}
          </template>
        </el-table-column>
        <el-table-column label="伤亡" width="90">
          <template #default="{ row }">{{ row.fatalities }} / {{ row.injuries }}</template>
        </el-table-column>
      </el-table>

      <div class="sample-pagination">
        <el-pagination
          background
          layout="prev, pager, next"
          :total="sampleResponse?.total ?? 0"
          :page-size="filters.pageSize"
          :current-page="filters.page"
          @current-change="handlePageChange"
        />
      </div>
    </el-card>
  </div>
</template>
