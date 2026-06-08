<script setup lang="ts">
import { Camera, Delete, FolderOpened, VideoPlay } from '@element-plus/icons-vue';
import { ElMessage } from 'element-plus';
import { onBeforeUnmount, onMounted, ref } from 'vue';
import { analysisApi, api, toAbsoluteAssetUrl } from '../lib/api';
import type {
  AnalysisRunItem,
  AssessmentItem,
  HazardPrediction,
  ModelItem,
  PredictionRegion
} from '../types';

const loading = ref(false);
const models = ref<ModelItem[]>([]);
const assessments = ref<AssessmentItem[]>([]);
const runs = ref<AnalysisRunItem[]>([]);

const landslideFile = ref<File | null>(null);
const landslidePreviewUrl = ref('');
const landslideResult = ref<HazardPrediction | null>(null);
const landslideSubmitting = ref(false);
const analysisMode = ref<'vision-llm' | 'model-service'>('model-service');
const cameraInput = ref<HTMLInputElement | null>(null);
const galleryInput = ref<HTMLInputElement | null>(null);

const analysisModeOptions = [
  { label: '本地初筛', value: 'model-service' },
  { label: '豆包视觉', value: 'vision-llm' }
];
const primaryColor = '#0f766e';

async function fetchData() {
  loading.value = true;
  try {
    const [modelResponse, assessmentResponse, runResponse] = await Promise.all([
      api.get<{ items: ModelItem[] }>('/analysis/models'),
      api.get<{ items: AssessmentItem[] }>('/analysis/assessments'),
      api.get<{ items: AnalysisRunItem[] }>('/analysis/runs?limit=8')
    ]);
    models.value = modelResponse.data.items;
    assessments.value = assessmentResponse.data.items;
    runs.value = runResponse.data.items;
  } finally {
    loading.value = false;
  }
}

function modelTagType(status: string) {
  if (status === 'stable') return 'success';
  if (status === 'training') return 'warning';
  return 'info';
}

function taskLabel() {
  return '滑坡识别';
}

function chooseFile(event: Event) {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0] ?? null;

  updatePreview(file, landslideFile, landslidePreviewUrl);
  landslideResult.value = null;
  input.value = '';
}

function updatePreview(file: File | null, fileRef: typeof landslideFile, previewRef: typeof landslidePreviewUrl) {
  if (previewRef.value) {
    URL.revokeObjectURL(previewRef.value);
  }

  fileRef.value = file;
  previewRef.value = file ? URL.createObjectURL(file) : '';
}

function clearSelection() {
  updatePreview(null, landslideFile, landslidePreviewUrl);
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
  const fileName = file.name.toLowerCase();
  const mimeType = file.type.toLowerCase();
  const isTiff =
    fileName.endsWith('.tif') ||
    fileName.endsWith('.tiff') ||
    mimeType === 'image/tif' ||
    mimeType === 'image/tiff';
  return !isTiff;
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

async function runAnalysis() {
  const file = landslideFile.value;
  if (!file) {
    ElMessage.warning('请先选择滑坡照片。');
    return;
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
    await fetchRuns();
    ElMessage.success(analysisMode.value === 'vision-llm' ? '移动端图片识别已完成。' : '滑坡识别已完成。');
  } catch (error) {
    console.error(error);
    ElMessage.error(
      analysisMode.value === 'vision-llm'
        ? '视觉大模型识别失败，请检查豆包/DeepSeek 配置或文件格式。'
        : '滑坡识别失败，请检查文件格式或后端模型服务配置。'
    );
  } finally {
    landslideSubmitting.value = false;
  }
}

async function fetchRuns() {
  const response = await api.get<{ items: AnalysisRunItem[] }>('/analysis/runs?limit=8');
  runs.value = response.data.items;
}

onMounted(fetchData);

onBeforeUnmount(() => {
  if (landslidePreviewUrl.value) {
    URL.revokeObjectURL(landslidePreviewUrl.value);
  }
});
</script>

<template>
  <div class="page-stack">
    <section class="page-intro">
      <div>
        <div class="section-kicker">analysis</div>
        <h3 class="section-title">智能研判与影响评估</h3>
        <p class="section-desc">直接接入滑坡照片识别接口，辅助生成疑似滑坡判定与区域标注。</p>
      </div>
    </section>

    <el-card class="panel-card analysis-workbench">
      <template #header>
        <div class="card-head">
          <div>
            <h4 class="section-title section-title--card">滑坡识别工作台</h4>
            <p class="section-desc">上传地面照片、航拍图或移动端巡查图片，返回是否疑似地灾及区域标注。</p>
          </div>
          <el-tag :type="analysisMode === 'vision-llm' ? 'warning' : 'success'">
            {{ analysisMode === 'vision-llm' ? '豆包视觉' : '本地初筛' }}
          </el-tag>
        </div>
      </template>

      <div class="analysis-controls">
        <el-segmented v-model="analysisMode" :options="analysisModeOptions" />
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
          <img :src="landslidePreviewUrl" alt="landslide preview" class="analysis-preview" />
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

    <el-card class="panel-card" v-loading="loading">
      <template #header>
        <div class="card-head">
          <div>
            <h4 class="section-title section-title--card">最近识别记录</h4>
            <p class="section-desc">留存滑坡识别任务，便于后端模型管理与复核。</p>
          </div>
        </div>
      </template>

      <el-table :data="runs" stripe>
        <el-table-column prop="createdAt" label="时间" width="180" />
        <el-table-column label="任务类型" width="120">
          <template #default>{{ taskLabel() }}</template>
        </el-table-column>
        <el-table-column prop="modelName" label="模型" min-width="160" />
        <el-table-column label="源文件" min-width="220">
          <template #default="{ row }">
            <a :href="toAbsoluteAssetUrl(row.sourceUrl)" target="_blank" rel="noreferrer">{{ row.sourceName }}</a>
          </template>
        </el-table-column>
        <el-table-column label="置信度" width="110">
          <template #default="{ row }">{{ Math.round(row.confidence * 100) }}%</template>
        </el-table-column>
        <el-table-column prop="summary" label="结果摘要" min-width="300" />
      </el-table>
    </el-card>

    <div class="grid-two">
      <article class="model-card" v-for="model in models" :key="model.id">
        <div class="card-head">
          <div>
            <strong>{{ model.name }}</strong>
            <div>{{ model.category }} · {{ model.version }}</div>
          </div>
          <el-tag :type="modelTagType(model.status)">{{ model.status }}</el-tag>
        </div>
        <el-progress :percentage="Math.round(model.accuracy * 100)" :color="primaryColor" />
        <p class="table-note">{{ model.summary }}</p>
        <p class="table-note">最近执行：{{ model.lastRunAt }}</p>
      </article>
    </div>

    <el-card class="panel-card" v-loading="loading">
      <template #header>
        <div class="card-head">
          <div>
            <h4 class="section-title section-title--card">灾情影响评估结果</h4>
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
