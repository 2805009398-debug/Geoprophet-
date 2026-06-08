<script setup lang="ts">
import { Camera, Delete, FolderOpened, VideoPlay } from '@element-plus/icons-vue';
import { ElMessage } from 'element-plus';
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { analysisApi, api } from '../lib/api';
import type { HazardPrediction, PredictionRegion, VisionConfig } from '../types';

const props = withDefaults(
  defineProps<{
    title?: string;
    description?: string;
  }>(),
  {
    title: '滑坡识别工作台',
    description: '上传航拍图、无人机照片或现场巡查图片，返回是否疑似滑坡及区域标注。'
  }
);

const emit = defineEmits<{
  completed: [result: HazardPrediction];
}>();

const landslideFile = ref<File | null>(null);
const landslidePreviewUrl = ref('');
const landslideResult = ref<HazardPrediction | null>(null);
const landslideSubmitting = ref(false);
const analysisMode = ref<'model-service' | 'vision-llm'>('model-service');
const visionConfig = ref<VisionConfig | null>(null);
const visionConfigLoading = ref(false);
const cameraInput = ref<HTMLInputElement | null>(null);
const galleryInput = ref<HTMLInputElement | null>(null);

const analysisModeOptions = computed(() => [
  { label: '本地 YOLO', value: 'model-service' },
  { label: '豆包视觉', value: 'vision-llm', disabled: !visionConfig.value?.configured }
]);

const modeTag = computed(() => {
  if (analysisMode.value === 'vision-llm') {
    return { label: '豆包视觉', type: 'warning' as const };
  }

  return { label: 'YOLO 初筛', type: 'success' as const };
});

const visionStatusText = computed(() => {
  if (visionConfigLoading.value) {
    return '正在检查豆包配置';
  }

  if (!visionConfig.value) {
    return '豆包配置状态未知';
  }

  if (visionConfig.value.configured) {
    return `豆包已配置：${visionConfig.value.model}`;
  }

  if (visionConfig.value.provider === 'deepseek') {
    return '当前供应商不支持图片输入';
  }

  return '豆包未配置：请设置 VISION_PROVIDER、VISION_MODEL 和 ARK_API_KEY';
});

function chooseFile(event: Event) {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0] ?? null;

  updatePreview(file);
  landslideResult.value = null;
  input.value = '';
}

function updatePreview(file: File | null) {
  if (landslidePreviewUrl.value) {
    URL.revokeObjectURL(landslidePreviewUrl.value);
  }

  landslideFile.value = file;
  landslidePreviewUrl.value = file ? URL.createObjectURL(file) : '';
}

function clearSelection() {
  updatePreview(null);
  landslideResult.value = null;
}

function openCamera() {
  cameraInput.value?.click();
}

function openGallery() {
  galleryInput.value?.click();
}

function isBrowserPreviewable(file: File | null) {
  if (!file) return false;
  return !isTiffFile(file);
}

function isTiffFile(file: File) {
  const fileName = file.name.toLowerCase();
  const mimeType = file.type.toLowerCase();
  return (
    fileName.endsWith('.tif') ||
    fileName.endsWith('.tiff') ||
    mimeType === 'image/tif' ||
    mimeType === 'image/tiff'
  );
}

function polygonPoints(region: PredictionRegion) {
  return region.polygon.map((point) => `${point.x * 100},${point.y * 100}`).join(' ');
}

function riskTagType(level: HazardPrediction['riskAssessment']['riskLevel']) {
  if (level === 'critical' || level === 'high') return 'danger';
  if (level === 'medium') return 'warning';
  return 'success';
}

function riskProgressColor(level: HazardPrediction['riskAssessment']['riskLevel']) {
  const colors = {
    low: '#247651',
    medium: '#b87514',
    high: '#c43c32',
    critical: '#8f2d27'
  };
  return colors[level];
}

function riskAlertType(level: HazardPrediction['riskAssessment']['riskLevel']) {
  if (level === 'critical' || level === 'high') return 'error';
  if (level === 'medium') return 'warning';
  return 'success';
}

function formatPercent(value: number) {
  return `${Math.round(value * 100)}%`;
}

async function fetchVisionConfig() {
  visionConfigLoading.value = true;
  try {
    const response = await api.get<VisionConfig>('/system/vision-config');
    visionConfig.value = response.data;
  } catch (error) {
    console.error(error);
    visionConfig.value = null;
  } finally {
    visionConfigLoading.value = false;
  }
}

async function runAnalysis() {
  const file = landslideFile.value;
  if (!file) {
    ElMessage.warning('请先选择航拍图或巡查照片。');
    return;
  }

  if (analysisMode.value === 'vision-llm') {
    if (!visionConfig.value?.configured) {
      ElMessage.warning('豆包视觉还没有配置完整，请先设置后端环境变量。');
      return;
    }

    if (isTiffFile(file)) {
      ElMessage.warning('豆包视觉仅支持 jpg、png、webp 图片，TIFF 请使用本地 YOLO。');
      return;
    }
  }

  const formData = new FormData();
  formData.append('file', file);

  landslideSubmitting.value = true;

  try {
    const endpoint = analysisMode.value === 'vision-llm' ? '/analysis/mobile-image' : '/analysis/landslide';
    const response = await analysisApi.post<HazardPrediction>(endpoint, formData, {
      headers: { 'Content-Type': 'multipart/form-data' }
    });

    landslideResult.value = response.data;
    emit('completed', response.data);
    ElMessage.success(analysisMode.value === 'vision-llm' ? '豆包视觉识别已完成。' : 'YOLO 航拍图像初筛已完成。');
  } catch (error) {
    console.error(error);
    ElMessage.error(
      analysisMode.value === 'vision-llm'
        ? '豆包视觉识别失败，请检查 API Key、模型 ID 或文件格式。'
        : 'YOLO 初筛失败，请检查文件格式或后端模型服务配置。'
    );
  } finally {
    landslideSubmitting.value = false;
  }
}

watch(analysisMode, () => {
  landslideResult.value = null;
});

onMounted(fetchVisionConfig);

onBeforeUnmount(() => {
  if (landslidePreviewUrl.value) {
    URL.revokeObjectURL(landslidePreviewUrl.value);
  }
});
</script>

<template>
  <el-card class="panel-card analysis-workbench">
    <template #header>
      <div class="card-head">
        <div>
          <h4 class="section-title section-title--card">{{ props.title }}</h4>
          <p class="section-desc">{{ props.description }}</p>
        </div>
        <el-tag :type="modeTag.type">{{ modeTag.label }}</el-tag>
      </div>
    </template>

    <div class="analysis-controls">
      <div class="analysis-mode-row">
        <el-segmented v-model="analysisMode" :options="analysisModeOptions" />
        <span class="table-note">{{ visionStatusText }}</span>
      </div>
      <input
        ref="cameraInput"
        class="analysis-file-input"
        type="file"
        accept="image/*"
        capture="environment"
        @change="chooseFile"
      />
      <input
        ref="galleryInput"
        class="analysis-file-input"
        type="file"
        accept="image/*"
        @change="chooseFile"
      />
      <div class="analysis-action-row">
        <el-button :icon="Camera" @click="openCamera">拍照</el-button>
        <el-button :icon="FolderOpened" @click="openGallery">选择图片</el-button>
        <el-button type="primary" :icon="VideoPlay" :loading="landslideSubmitting" @click="runAnalysis">
          开始识别
        </el-button>
        <el-button :icon="Delete" @click="clearSelection">清空</el-button>
      </div>
    </div>

    <div v-if="landslideFile" class="analysis-preview-block">
      <div class="analysis-preview-head">
        <strong>{{ landslideFile.name }}</strong>
        <span class="table-note">{{ Math.round(landslideFile.size / 1024) }} KB</span>
      </div>

      <div v-if="isBrowserPreviewable(landslideFile)" class="analysis-visual">
        <img :src="landslidePreviewUrl" alt="滑坡检测预览" class="analysis-preview" />
        <svg
          v-if="landslideResult?.segmentation.regions.length"
          class="analysis-overlay"
          viewBox="0 0 100 100"
          preserveAspectRatio="none"
        >
          <polygon
            v-for="(region, index) in landslideResult.segmentation.regions"
            :key="`${region.label}-${index}`"
            :points="polygonPoints(region)"
          />
        </svg>
      </div>

      <div v-else class="analysis-placeholder">
        当前文件可上传识别，但浏览器可能无法直接预览，请以识别结果和历史记录为准。
      </div>
    </div>

    <div v-if="landslideResult" class="analysis-result">
      <div class="risk-assessment-card" :data-risk="landslideResult.riskAssessment.riskLevel">
        <div class="risk-assessment-head">
          <div>
            <span>图像风险判定</span>
            <strong>{{ landslideResult.riskAssessment.label }}</strong>
          </div>
          <el-tag :type="riskTagType(landslideResult.riskAssessment.riskLevel)" size="large">
            {{ landslideResult.riskAssessment.reviewRequired ? '需要复核' : '常规留存' }}
          </el-tag>
        </div>
        <el-progress
          :percentage="Math.round(landslideResult.riskAssessment.riskScore * 100)"
          :color="riskProgressColor(landslideResult.riskAssessment.riskLevel)"
        />
        <div class="analysis-meta-grid">
          <div class="analysis-meta-item">
            <span>风险分数</span>
            <strong>{{ formatPercent(landslideResult.riskAssessment.riskScore) }}</strong>
          </div>
          <div class="analysis-meta-item">
            <span>模型置信度</span>
            <strong>{{ formatPercent(landslideResult.confidence) }}</strong>
          </div>
          <div class="analysis-meta-item">
            <span>判定类型</span>
            <strong>{{ landslideResult.classification?.hasHazard ? landslideResult.classification.label : 'no-hazard' }}</strong>
          </div>
          <div class="analysis-meta-item">
            <span>定位区域</span>
            <strong>{{ landslideResult.segmentation.regions.length }} 个</strong>
          </div>
        </div>
        <p class="table-note">{{ landslideResult.riskAssessment.basis }}</p>
        <div class="risk-evidence-list">
          <strong>判定依据</strong>
          <ul>
            <li v-for="item in landslideResult.riskAssessment.evidence" :key="item">{{ item }}</li>
          </ul>
        </div>
        <el-alert
          :type="riskAlertType(landslideResult.riskAssessment.riskLevel)"
          :closable="false"
          show-icon
          title="处置建议"
          :description="landslideResult.riskAssessment.recommendedAction"
        />
      </div>
      <div class="info-strip">
        <div class="info-chip">模型：{{ landslideResult.modelName }}</div>
        <div class="info-chip">来源：{{ landslideResult.provider }}</div>
        <div class="info-chip">置信度：{{ formatPercent(landslideResult.confidence) }}</div>
        <div class="info-chip">
          判定：{{ landslideResult.classification?.hasHazard ? '疑似滑坡' : '未见明显滑坡' }}
        </div>
        <div v-if="landslideResult.metadata.visionProvider" class="info-chip">
          供应商：{{ landslideResult.metadata.visionProvider }}
        </div>
      </div>
      <p class="table-note">{{ landslideResult.summary }}</p>
      <p v-if="landslideResult.metadata.recommendedAction" class="table-note">
        处置建议：{{ landslideResult.metadata.recommendedAction }}
      </p>
      <p v-if="landslideResult.metadata.observations" class="table-note">
        可见线索：{{ landslideResult.metadata.observations }}
      </p>
    </div>
  </el-card>
</template>
