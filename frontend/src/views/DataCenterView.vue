<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { ElMessage } from 'element-plus';
import { api, toAbsoluteAssetUrl } from '../lib/api';
import GeoHazardLayerMap from '../components/GeoHazardLayerMap.vue';
import type {
  DashboardOverview,
  GeoJsonFeatureCollection,
  GeohazardOverview,
  RegionBoundary,
  RemoteSensingAsset,
  SystemLog,
  WeatherSnapshot
} from '../types';

type LayerRequestParams = {
  bbox?: string;
  property?: string;
  value?: string;
  keyword?: string;
  limit?: number;
  offset?: number;
};

const yunnanFocus = {
  layerId: 'coolr-reports-southwest-core',
  params: {
    property: 'admin_division_name',
    value: 'Yunnan',
    bbox: '97,21,106.5,29.5',
    limit: 500
  } satisfies LayerRequestParams
};

const overview = ref<DashboardOverview | null>(null);
const logs = ref<SystemLog[]>([]);
const geohazard = ref<GeohazardOverview | null>(null);
const selectedLayerId = ref('');
const selectedLayerParams = ref<LayerRequestParams>({});
const selectedLayer = ref<GeoJsonFeatureCollection | null>(null);
const regionBoundaries = ref<RegionBoundary[]>([]);
const activeFocus = ref<'yunnan' | 'all'>('yunnan');
const loading = ref(false);
const layerLoading = ref(false);
const remoteSyncLoading = ref(false);
const weatherLoading = ref(false);
const remotePreviewVisible = ref(false);
const remotePreviewAsset = ref<RemoteSensingAsset | null>(null);
const weather = ref<WeatherSnapshot | null>(null);

async function fetchData() {
  loading.value = true;
  try {
    const [overviewResponse, logsResponse, geohazardResponse] = await Promise.all([
      api.get<DashboardOverview>('/dashboard/overview'),
      api.get<{ items: SystemLog[] }>('/system/logs', { params: { category: 'ingestion' } }),
      api.get<GeohazardOverview>('/geohazards/overview')
    ]);
    overview.value = overviewResponse.data;
    logs.value = logsResponse.data.items;
    geohazard.value = geohazardResponse.data;

    const yunnanLayer = geohazardResponse.data.layers.find((layer) => layer.available && layer.id === yunnanFocus.layerId);
    const defaultLayer =
      yunnanLayer ??
      geohazardResponse.data.layers.find((layer) => layer.available && layer.id === 'coolr-reports-northeast') ??
      geohazardResponse.data.layers.find((layer) => layer.available);
    if (defaultLayer) {
      selectedLayerId.value = defaultLayer.id;
      selectedLayerParams.value = defaultLayer.id === yunnanFocus.layerId ? { ...yunnanFocus.params } : {};
      activeFocus.value = defaultLayer.id === yunnanFocus.layerId ? 'yunnan' : 'all';
      await fetchRegionBoundaries();
      await fetchLayer(defaultLayer.id);
      await fetchWeather();
    }
  } finally {
    loading.value = false;
  }
}

const channels = computed(() => [
  {
    title: '传感器通道',
    status: `${overview.value?.stats[1]?.value ?? 0} 台在线`,
    desc: '负责地表位移、雨量、裂缝等监测数据实时接收'
  },
  {
    title: '遥感通道',
    status: `${remoteSensing.value?.summary.assetCount ?? 0} 幅每日影像`,
    desc: '自动接入 NASA GIBS 真彩色与降雨专题图'
  },
  {
    title: '视频通道',
    status: '事件联动',
    desc: '辅助现场巡检和图像变化核验'
  },
  {
    title: '群众上报',
    status: `${overview.value?.stats[3]?.value ?? 0} 条待审`,
    desc: '支持公众图片和位置信息协同采集'
  }
]);

const geohazardCards = computed(() => [
  {
    title: '公开空间要素',
    value: geohazard.value?.summary.vectorRecordCount ?? geohazard.value?.summary.recordCount ?? 0,
    desc: `${geohazard.value?.summary.fileCount ?? 0} 个文件 / ${geohazard.value?.summary.totalSizeMb ?? 0} MB`
  },
  {
    title: '可预览图层',
    value: geohazard.value?.summary.vectorLayerCount ?? 0,
    desc: `${geohazard.value?.summary.recordCount ?? 0} 条记录已编目`
  },
  {
    title: '危险性栅格',
    value: geohazard.value?.summary.rasterFileCount ?? 0,
    desc: 'Yesterday / Today / Tomorrow + 易发性'
  },
  {
    title: 'Landsat 示例',
    value: geohazard.value?.landsatScenes.length ?? 0,
    desc: '东北白山与西南红河低云量场景'
  },
  {
    title: '每日遥感影像',
    value: remoteSensing.value?.summary.assetCount ?? 0,
    desc: `${remoteSensing.value?.summary.totalSizeMb ?? 0} MB 自动同步`
  },
  {
    title: '云南专题点位',
    value: activeFocus.value === 'yunnan' ? totalFeatureCount.value : 0,
    desc: '按云南省行政字段和空间范围过滤'
  }
]);

const selectedLayerMeta = computed(
  () => geohazard.value?.layers.find((layer) => layer.id === selectedLayerId.value) ?? null
);

const remoteSensing = computed(() => geohazard.value?.remoteSensing ?? null);
const visibleCatalog = computed(() => geohazard.value?.catalog.slice(0, 6) ?? []);
const geohazardStorageLabel = computed(() =>
  geohazard.value?.storage?.vector === 'postgis' ? '空间主库：PostGIS' : '空间主库：文件读取'
);
const yunnanFocusAvailable = computed(() =>
  Boolean(geohazard.value?.layers.some((layer) => layer.available && layer.id === yunnanFocus.layerId))
);
const returnedFeatureCount = computed(() => selectedLayer.value?.returnedFeatures ?? selectedLayer.value?.features.length ?? 0);
const totalFeatureCount = computed(() => selectedLayer.value?.totalFeatures ?? returnedFeatureCount.value);
const hasLayerFilters = computed(() => Object.keys(selectedLayerParams.value).length > 0);
const remoteSensingStatusLabel = computed(() => {
  if (remoteSensing.value?.inProgress) {
    return '同步中';
  }
  if (!remoteSensing.value?.enabled) {
    return '未启用';
  }
  if (!remoteSensing.value.lastRun) {
    return '等待同步';
  }
  return formatRunStatus(remoteSensing.value.lastRun?.status ?? 'running');
});
const remoteSensingStatusType = computed(() => {
  if (remoteSensing.value?.inProgress) {
    return 'warning';
  }
  if (!remoteSensing.value?.enabled) {
    return 'info';
  }
  if (!remoteSensing.value.lastRun) {
    return 'info';
  }
  if (remoteSensing.value.lastRun?.status === 'failed') {
    return 'danger';
  }
  if (remoteSensing.value.lastRun?.status === 'partial') {
    return 'warning';
  }
  return 'success';
});
const remoteSensingSummaryNote = computed(() => {
  const latestDate = remoteSensing.value?.summary.latestAssetDate;
  if (!latestDate) {
    return '尚未生成自动同步资产。';
  }
  return `最近资产日期 ${latestDate}，共 ${remoteSensing.value?.summary.assetCount ?? 0} 幅影像。`;
});
const remotePreviewBaseAsset = computed(() => {
  const asset = remotePreviewAsset.value;
  if (!asset || !isPrecipitationAsset(asset)) {
    return null;
  }

  const assets = remoteSensing.value?.recentAssets ?? [];
  return (
    assets.find((item) =>
      item.assetDate === asset.assetDate &&
      item.regionId === asset.regionId &&
      item.productId === 'viirs-snpp-true-color'
    ) ??
    assets.find((item) =>
      item.assetDate === asset.assetDate &&
      item.regionId === asset.regionId &&
      item.productId === 'modis-terra-true-color'
    ) ??
    null
  );
});
const remotePreviewTitle = computed(() => {
  const asset = remotePreviewAsset.value;
  if (!asset) {
    return '遥感影像预览';
  }
  return `${asset.productTitle} · ${asset.regionName} · ${asset.assetDate}`;
});
const remotePreviewNote = computed(() => {
  const asset = remotePreviewAsset.value;
  if (!asset) {
    return '';
  }
  if (isPrecipitationAsset(asset)) {
    return remotePreviewBaseAsset.value
      ? '降雨率是透明专题层，已叠加在同一区域同一天的真彩色影像上；若没有彩色斑块，通常表示当前时段无明显降雨可视化信号。'
      : '降雨率是透明专题层，单独打开可能显示为空白；建议与真彩色底图、历史降雨和地灾点位叠加判断。';
  }
  return '真彩色影像用于快速核验云量、地表状态和区域背景，后续可与降雨、地灾点位和风险图层叠加分析。';
});
const layerResultNote = computed(() => {
  if (!selectedLayer.value) {
    return '请选择图层查看空间要素。';
  }

  const scope = activeFocus.value === 'yunnan' ? '云南专题' : selectedLayerMeta.value?.region ?? '当前图层';
  const limited = selectedLayer.value.previewLimited ? '，已按查询窗口截取展示' : '';
  return `${scope}：当前返回 ${returnedFeatureCount.value} / ${totalFeatureCount.value} 个要素${limited}`;
});
const mapBoundaries = computed<RegionBoundary[]>(() => {
  const bboxBoundary = selectedLayerParams.value.bbox
    ? [createBboxBoundary(selectedLayerParams.value.bbox, activeFocus.value === 'yunnan' ? '云南专题AOI' : '当前查询范围')]
    : [];
  return [...bboxBoundary.filter(Boolean) as RegionBoundary[], ...regionBoundaries.value];
});
const weatherTarget = computed(() => {
  const bbox = parseBbox(selectedLayerParams.value.bbox) ?? bboxFromFeatures(selectedLayer.value?.features ?? []);
  if (bbox) {
    const [west, south, east, north] = bbox;
    return {
      lat: Number(((south + north) / 2).toFixed(4)),
      lng: Number(((west + east) / 2).toFixed(4)),
      label: activeFocus.value === 'yunnan' ? '云南专题AOI' : selectedLayerMeta.value?.region ?? '当前AOI'
    };
  }

  return {
    lat: 25.2,
    lng: 102.7,
    label: '云南专题AOI'
  };
});
const weatherRiskType = computed(() => {
  if (weather.value?.risk.level === 'high') return 'danger';
  if (weather.value?.risk.level === 'medium') return 'warning';
  return 'success';
});

async function fetchLayer(layerId = selectedLayerId.value) {
  if (!layerId) {
    selectedLayer.value = null;
    return;
  }

  layerLoading.value = true;
  try {
    const response = await api.get<GeoJsonFeatureCollection>(`/geohazards/layers/${layerId}`, {
      params: selectedLayerParams.value
    });
    selectedLayer.value = response.data;
    await fetchWeather();
  } finally {
    layerLoading.value = false;
  }
}

async function fetchWeather() {
  weatherLoading.value = true;
  try {
    const target = weatherTarget.value;
    const response = await api.get<WeatherSnapshot>('/geohazards/weather', {
      params: {
        lat: target.lat,
        lng: target.lng,
        label: target.label
      }
    });
    weather.value = response.data;
  } catch {
    weather.value = null;
    ElMessage.warning('实时天气暂时不可用，地图仍可查看公开地灾图层。');
  } finally {
    weatherLoading.value = false;
  }
}

async function fetchRegionBoundaries() {
  try {
    const response = await api.get<GeoJsonFeatureCollection>('/geohazards/layers/lhasa-exposure-southwest-core', {
      params: {
        limit: 500
      }
    });
    regionBoundaries.value = response.data.features
      .filter((feature) => feature.geometry?.type === 'Polygon' || feature.geometry?.type === 'MultiPolygon')
      .map((feature, index) => ({
        id: `lhasa-region-${feature.properties.objectid ?? index}`,
        name: String(feature.properties.name_2 ?? feature.properties.admin_name ?? `地区边界 ${index + 1}`),
        geometry: feature.geometry
      }));
  } catch {
    regionBoundaries.value = [];
  }
}

async function applyYunnanFocus() {
  if (!yunnanFocusAvailable.value) {
    return;
  }

  selectedLayerId.value = yunnanFocus.layerId;
  selectedLayerParams.value = { ...yunnanFocus.params };
  activeFocus.value = 'yunnan';
  await fetchLayer(yunnanFocus.layerId);
}

async function clearLayerFilters() {
  selectedLayerParams.value = {};
  activeFocus.value = 'all';
  await fetchLayer();
}

async function handleLayerChange() {
  selectedLayerParams.value = {};
  activeFocus.value = 'all';
  await fetchLayer();
}

async function runRemoteSensingSync() {
  remoteSyncLoading.value = true;
  try {
    const response = await api.post<{ message: string }>('/geohazards/remote-sensing/sync', {});
    ElMessage.success(response.data.message || 'NASA GIBS 遥感数据同步完成。');
    await fetchData();
  } finally {
    remoteSyncLoading.value = false;
  }
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

function parseBbox(value?: string | null) {
  if (!value) {
    return null;
  }

  const parts = value.split(',').map((part) => Number(part.trim()));
  if (parts.length !== 4 || parts.some((part) => !Number.isFinite(part))) {
    return null;
  }

  return parts as [number, number, number, number];
}

function createBboxBoundary(value: string, name: string): RegionBoundary | null {
  const bbox = parseBbox(value);
  if (!bbox) {
    return null;
  }

  const [west, south, east, north] = bbox;
  return {
    id: `bbox-${value}`,
    name,
    geometry: {
      type: 'Polygon',
      coordinates: [[
        [west, south],
        [east, south],
        [east, north],
        [west, north],
        [west, south]
      ]]
    }
  };
}

function bboxFromFeatures(features: GeoJsonFeatureCollection['features']) {
  let west = Infinity;
  let south = Infinity;
  let east = -Infinity;
  let north = -Infinity;

  function visit(value: unknown) {
    if (!Array.isArray(value)) {
      return;
    }

    if (typeof value[0] === 'number' && typeof value[1] === 'number') {
      west = Math.min(west, value[0]);
      south = Math.min(south, value[1]);
      east = Math.max(east, value[0]);
      north = Math.max(north, value[1]);
      return;
    }

    for (const item of value) {
      visit(item);
    }
  }

  for (const feature of features) {
    visit(feature.geometry?.coordinates);
  }

  if (![west, south, east, north].every(Number.isFinite)) {
    return null;
  }

  return [west, south, east, north] as [number, number, number, number];
}

function formatWeatherNumber(value: number | null | undefined, suffix: string) {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return '-';
  }

  return `${value}${suffix}`;
}

function geometryLabel(type: string) {
  return type === 'polygon' ? '面' : '点';
}

function formatDateTime(value?: string | null) {
  if (!value) {
    return '-';
  }

  return value.replace('T', ' ').slice(0, 19);
}

function formatRunStatus(status: string) {
  const labels: Record<string, string> = {
    running: '同步中',
    success: '成功',
    partial: '部分成功',
    failed: '失败'
  };
  return labels[status] ?? status;
}

function formatTrigger(value: string) {
  const labels: Record<string, string> = {
    startup: '启动补拉',
    scheduler: '定时任务',
    manual: '手动触发'
  };
  return labels[value] ?? value;
}

function getRemoteSensingAssetUrl(asset: RemoteSensingAsset) {
  const relativePath = asset.filePath.replace(/\\/g, '/').replace(/^remote_sensing\//, '');
  return toAbsoluteAssetUrl(`/remote-sensing-assets/${relativePath}`);
}

function isPrecipitationAsset(asset: RemoteSensingAsset) {
  return asset.productId === 'imerg-precipitation-rate';
}

function openRemoteSensingAsset(asset: RemoteSensingAsset) {
  remotePreviewAsset.value = asset;
  remotePreviewVisible.value = true;
}

function openRemoteSensingSource(asset: RemoteSensingAsset) {
  window.open(asset.wmsUrl, '_blank', 'noopener,noreferrer');
}

function openRemoteSensingAssetInNewTab(asset: RemoteSensingAsset) {
  window.open(getRemoteSensingAssetUrl(asset), '_blank', 'noopener,noreferrer');
}

onMounted(fetchData);
</script>

<template>
  <div class="page-stack">
    <section class="section-head">
      <div>
        <div class="section-kicker" style="color: var(--muted)">ingestion</div>
        <h3 class="section-title">数据接收与管理中心</h3>
        <p class="section-desc">对应服务要求中的“数据接收、解码、入库、异常处理、日志管理”能力。</p>
      </div>
    </section>

    <div class="grid-four">
      <article class="channel-card">
        <strong>{{ overview?.ingestionStatus.channelCount ?? 0 }}</strong>
        <div>接入通道</div>
        <p class="table-note">传感器、遥感、视频、群众上报</p>
      </article>
      <article class="channel-card">
        <strong>{{ overview?.ingestionStatus.avgLatencyMs ?? 0 }} ms</strong>
        <div>平均响应时间</div>
        <p class="table-note">满足接口目标 &lt; 500ms</p>
      </article>
      <article class="channel-card">
        <strong>{{ overview?.ingestionStatus.successRate ?? 0 }}%</strong>
        <div>接收成功率</div>
        <p class="table-note">以最近批次入库日志估算</p>
      </article>
      <article class="channel-card">
        <strong>{{ overview?.ingestionStatus.transmissionErrors ?? 0 }}</strong>
        <div>异常次数</div>
        <p class="table-note">离线、网关超时、重试失败</p>
      </article>
    </div>

    <div class="grid-four">
      <article class="channel-card" v-for="card in geohazardCards" :key="card.title">
        <strong>{{ card.value }}</strong>
        <div>{{ card.title }}</div>
        <p class="table-note">{{ card.desc }}</p>
      </article>
    </div>

    <div class="grid-two">
      <el-card class="panel-card" v-loading="loading">
        <template #header>
          <div class="section-head" style="margin-bottom: 0">
            <div>
              <h4 class="section-title" style="font-size: 20px">接入通道状态</h4>
              <p class="section-desc">用于展示传输设置、通道健康和优先级接入策略。</p>
            </div>
          </div>
        </template>
        <div class="grid-two">
          <article class="channel-card" v-for="channel in channels" :key="channel.title">
            <strong>{{ channel.title }}</strong>
            <div>{{ channel.status }}</div>
            <p class="table-note">{{ channel.desc }}</p>
          </article>
        </div>
      </el-card>

      <el-card class="panel-card">
        <template #header>
          <div class="section-head" style="margin-bottom: 0">
            <div>
              <h4 class="section-title" style="font-size: 20px">处理流程</h4>
              <p class="section-desc">从原始数据接收，到 AI 初审，再到预警联动。</p>
            </div>
          </div>
        </template>
        <el-steps direction="vertical" :active="4">
          <el-step title="接收解码" description="传感器、图像、群众上报进入统一接入层" />
          <el-step title="质量检查" description="校验格式、时效和异常值，触发错误反馈" />
          <el-step title="标准化入库" description="编目入库并生成统一时空主键" />
          <el-step title="联动分析" description="调用算法模型与预警规则，输出态势产品" />
        </el-steps>
      </el-card>
    </div>

    <el-card class="panel-card" v-loading="loading || remoteSyncLoading">
      <template #header>
        <div class="section-head" style="margin-bottom: 0">
          <div>
            <h4 class="section-title" style="font-size: 20px">NASA GIBS 每日遥感同步</h4>
            <p class="section-desc">政府端启动后自动补拉，并按 24 小时周期同步项目研究区遥感专题图。</p>
          </div>
          <div class="info-strip">
            <el-tag :type="remoteSensingStatusType">{{ remoteSensingStatusLabel }}</el-tag>
            <el-button
              type="primary"
              :loading="remoteSyncLoading"
              :disabled="remoteSensing?.inProgress"
              @click="runRemoteSensingSync"
            >
              手动同步
            </el-button>
          </div>
        </div>
      </template>

      <div class="grid-three remote-sensing-summary">
        <article class="channel-card">
          <strong>{{ remoteSensing?.summary.assetCount ?? 0 }}</strong>
          <div>已同步影像</div>
          <p class="table-note">{{ remoteSensingSummaryNote }}</p>
        </article>
        <article class="channel-card">
          <strong>{{ remoteSensing?.products.length ?? 0 }} × {{ remoteSensing?.regions.length ?? 0 }}</strong>
          <div>产品与区域</div>
          <p class="table-note">MODIS / VIIRS 真彩色与 IMERG 降雨率</p>
        </article>
        <article class="channel-card">
          <strong>{{ remoteSensing?.intervalHours ?? 24 }} h</strong>
          <div>同步周期</div>
          <p class="table-note">默认拉取延迟 {{ remoteSensing?.lagDays ?? 1 }} 天的数据</p>
        </article>
      </div>

      <div class="info-strip remote-sensing-strip">
        <div class="info-chip">最近运行：{{ formatDateTime(remoteSensing?.lastRun?.finishedAt ?? remoteSensing?.lastRun?.startedAt) }}</div>
        <div class="info-chip">下一次：{{ formatDateTime(remoteSensing?.nextScheduledAt) }}</div>
        <div class="info-chip">Manifest：{{ remoteSensing?.manifestPath ?? '-' }}</div>
      </div>
      <p class="table-note">
        IMERG 降雨率是透明专题层，单独打开可能为空白；请使用“叠加预览”叠加真彩色底图查看。
      </p>

      <div class="grid-two remote-sensing-tables">
        <el-table :data="remoteSensing?.recentAssets ?? []" stripe height="280">
          <el-table-column prop="assetDate" label="日期" width="110" />
          <el-table-column prop="productTitle" label="产品" min-width="170" />
          <el-table-column prop="regionName" label="区域" min-width="150" />
          <el-table-column label="大小" width="100">
            <template #default="{ row }">{{ formatBytes(row.bytes) }}</template>
          </el-table-column>
          <el-table-column label="查看" width="150">
            <template #default="{ row }">
              <el-button type="primary" link @click="openRemoteSensingAsset(row)">
                {{ isPrecipitationAsset(row) ? '叠加预览' : '预览' }}
              </el-button>
              <el-button link @click="openRemoteSensingSource(row)">源地址</el-button>
            </template>
          </el-table-column>
        </el-table>

        <el-table :data="remoteSensing?.recentRuns ?? []" stripe height="280">
          <el-table-column label="触发" width="100">
            <template #default="{ row }">{{ formatTrigger(row.triggeredBy) }}</template>
          </el-table-column>
          <el-table-column prop="targetDate" label="日期" width="110" />
          <el-table-column label="状态" width="100">
            <template #default="{ row }">{{ formatRunStatus(row.status) }}</template>
          </el-table-column>
          <el-table-column prop="message" label="说明" min-width="230" />
        </el-table>
      </div>
    </el-card>

    <el-card class="panel-card" v-loading="loading">
      <template #header>
        <div class="section-head" style="margin-bottom: 0">
          <div>
            <h4 class="section-title" style="font-size: 20px">NASA / USGS 公开地灾数据</h4>
            <p class="section-desc">已接入滑坡样本、LHASA 风险面、危险性栅格、易发性栅格和 Landsat 示例场景。</p>
          </div>
          <div class="info-strip">
            <el-tag type="success">{{ geohazard?.summary.totalSizeMb ?? 0 }} MB</el-tag>
            <el-tag>{{ geohazardStorageLabel }}</el-tag>
          </div>
        </div>
      </template>

      <div class="grid-two">
        <div>
          <div class="layer-toolbar">
            <el-select
              v-model="selectedLayerId"
              placeholder="选择公开图层"
              style="width: 360px"
              @change="handleLayerChange"
            >
              <el-option
                v-for="layer in geohazard?.layers ?? []"
                :key="layer.id"
                :label="`${layer.title}（${layer.recordCount}）`"
                :value="layer.id"
                :disabled="!layer.available"
              />
            </el-select>
            <el-button-group>
              <el-button type="primary" plain :disabled="!yunnanFocusAvailable" @click="applyYunnanFocus">
                云南滑坡专题
              </el-button>
              <el-button :disabled="!hasLayerFilters" @click="clearLayerFilters">全量预览</el-button>
            </el-button-group>
            <div class="info-strip">
              <div class="info-chip">{{ selectedLayerMeta?.source ?? 'NASA/USGS' }}</div>
              <div class="info-chip">{{ geometryLabel(selectedLayerMeta?.geometryType ?? 'point') }}图层</div>
              <div class="info-chip">{{ returnedFeatureCount }} / {{ totalFeatureCount }} 个要素</div>
              <div v-if="activeFocus === 'yunnan'" class="info-chip">云南省</div>
            </div>
          </div>
          <GeoHazardLayerMap
            v-loading="layerLoading"
            :collection="selectedLayer"
            :layer="selectedLayerMeta"
            :weather="weather"
            :boundaries="mapBoundaries"
          />
          <div class="info-strip map-result-strip">
            <div class="info-chip">{{ layerResultNote }}</div>
            <div v-if="weather" class="info-chip">{{ weather.label }} · 近24h {{ weather.rainfall.last24h }} mm</div>
            <el-tag v-if="selectedLayer?.previewLimited" type="warning">预览截取</el-tag>
          </div>
          <p class="table-note">{{ selectedLayerMeta?.description }}</p>
        </div>

        <div>
          <div class="weather-panel" v-loading="weatherLoading">
            <div class="weather-panel-head">
              <div>
                <span class="section-kicker">live weather</span>
                <strong>{{ weather?.label ?? '实时天气' }}</strong>
              </div>
              <el-tag :type="weatherRiskType">{{ weather?.risk.label ?? '等待数据' }}</el-tag>
            </div>
            <div class="weather-metrics">
              <article>
                <strong>{{ formatWeatherNumber(weather?.current.temperature, '°C') }}</strong>
                <span>气温</span>
              </article>
              <article>
                <strong>{{ formatWeatherNumber(weather?.current.relativeHumidity, '%') }}</strong>
                <span>湿度</span>
              </article>
              <article>
                <strong>{{ formatWeatherNumber(weather?.current.precipitation, ' mm') }}</strong>
                <span>当前降雨</span>
              </article>
              <article>
                <strong>{{ formatWeatherNumber(weather?.rainfall.last24h, ' mm') }}</strong>
                <span>近24小时</span>
              </article>
            </div>
            <div class="weather-risk">
              <span>未来24小时</span>
              <strong>{{ formatWeatherNumber(weather?.rainfall.next24h, ' mm') }}</strong>
              <span>最高降雨概率 {{ formatWeatherNumber(weather?.rainfall.next24hProbability, '%') }}</span>
            </div>
            <p>{{ weather?.risk.basis ?? '按当前AOI中心点获取实时天气和降雨预报。' }}</p>
            <el-button plain size="small" :loading="weatherLoading" @click="fetchWeather">刷新天气</el-button>
          </div>

          <el-table :data="geohazard?.layers ?? []" stripe height="360">
            <el-table-column prop="title" label="图层" min-width="210" />
            <el-table-column prop="region" label="区域" width="140" />
            <el-table-column label="要素" width="90">
              <template #default="{ row }">{{ row.recordCount }}</template>
            </el-table-column>
            <el-table-column label="大小" width="100">
              <template #default="{ row }">{{ formatBytes(row.bytes) }}</template>
            </el-table-column>
          </el-table>
        </div>
      </div>
    </el-card>

    <el-card class="panel-card" v-loading="loading">
      <template #header>
        <div class="section-head" style="margin-bottom: 0">
          <div>
            <h4 class="section-title" style="font-size: 20px">数据源目录</h4>
            <p class="section-desc">用于 HiCool 项目材料和后续模型训练的数据来源清单。</p>
          </div>
        </div>
      </template>

      <el-table :data="visibleCatalog" stripe>
        <el-table-column prop="dataset_id" label="数据集" width="190" />
        <el-table-column prop="theme" label="主题" width="170" />
        <el-table-column prop="product_short_name" label="产品" min-width="210" />
        <el-table-column prop="source" label="来源" width="170" />
        <el-table-column prop="resolution" label="分辨率" width="130" />
        <el-table-column prop="project_use" label="项目用途" min-width="260" />
      </el-table>
    </el-card>

    <el-card class="panel-card" v-loading="loading">
      <template #header>
        <div class="section-head" style="margin-bottom: 0">
          <div>
            <h4 class="section-title" style="font-size: 20px">接收日志</h4>
            <p class="section-desc">支持问题回溯和联调联试期间的异常排查。</p>
          </div>
        </div>
      </template>
      <el-table :data="logs" stripe>
        <el-table-column prop="createdAt" label="时间" width="180" />
        <el-table-column prop="level" label="级别" width="100" />
        <el-table-column prop="message" label="内容" min-width="360" />
      </el-table>
    </el-card>

    <el-dialog v-model="remotePreviewVisible" :title="remotePreviewTitle" width="82%">
      <div v-if="remotePreviewAsset" class="remote-sensing-preview">
        <div class="remote-sensing-preview-frame">
          <template v-if="isPrecipitationAsset(remotePreviewAsset) && remotePreviewBaseAsset">
            <img
              class="remote-sensing-preview-image"
              :src="getRemoteSensingAssetUrl(remotePreviewBaseAsset)"
              :alt="remotePreviewBaseAsset.productTitle"
            />
            <img
              class="remote-sensing-preview-overlay"
              :src="getRemoteSensingAssetUrl(remotePreviewAsset)"
              :alt="remotePreviewAsset.productTitle"
            />
          </template>
          <img
            v-else
            class="remote-sensing-preview-image"
            :src="getRemoteSensingAssetUrl(remotePreviewAsset)"
            :alt="remotePreviewAsset.productTitle"
          />
        </div>
        <div class="info-strip">
          <div class="info-chip">{{ remotePreviewAsset.source }}</div>
          <div class="info-chip">{{ remotePreviewAsset.width }} × {{ remotePreviewAsset.height }}</div>
          <div class="info-chip">{{ formatBytes(remotePreviewAsset.bytes) }}</div>
          <div class="info-chip">{{ remotePreviewAsset.regionName }}</div>
        </div>
        <el-alert
          v-if="isPrecipitationAsset(remotePreviewAsset)"
          type="warning"
          :closable="false"
          show-icon
          title="降雨率是透明专题层，空白通常表示该区域该日期没有明显降雨可视化信号。"
        />
        <p class="table-note">{{ remotePreviewNote }}</p>
      </div>
      <template #footer>
        <el-button v-if="remotePreviewAsset" @click="openRemoteSensingAssetInNewTab(remotePreviewAsset)">新标签打开影像</el-button>
        <el-button v-if="remotePreviewAsset" @click="openRemoteSensingSource(remotePreviewAsset)">打开 NASA 源地址</el-button>
        <el-button type="primary" @click="remotePreviewVisible = false">关闭</el-button>
      </template>
    </el-dialog>
  </div>
</template>
