<script setup lang="ts">
import { ElMessage } from 'element-plus';
import { onBeforeUnmount, onMounted, ref } from 'vue';
import { api, toAbsoluteAssetUrl } from '../lib/api';
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
const glacierFile = ref<File | null>(null);
const landslidePreviewUrl = ref('');
const glacierPreviewUrl = ref('');
const landslideResult = ref<HazardPrediction | null>(null);
const glacierResult = ref<HazardPrediction | null>(null);
const landslideSubmitting = ref(false);
const glacierSubmitting = ref(false);

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

function taskLabel(taskType: 'landslide' | 'glacier') {
  return taskType === 'landslide' ? '滑坡识别' : '冰川识别';
}

function chooseFile(event: Event, taskType: 'landslide' | 'glacier') {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0] ?? null;

  if (taskType === 'landslide') {
    updatePreview(file, landslideFile, landslidePreviewUrl);
    landslideResult.value = null;
  } else {
    updatePreview(file, glacierFile, glacierPreviewUrl);
    glacierResult.value = null;
  }
}

function updatePreview(file: File | null, fileRef: typeof landslideFile, previewRef: typeof landslidePreviewUrl) {
  if (previewRef.value) {
    URL.revokeObjectURL(previewRef.value);
  }

  fileRef.value = file;
  previewRef.value = file ? URL.createObjectURL(file) : '';
}

function clearSelection(taskType: 'landslide' | 'glacier') {
  if (taskType === 'landslide') {
    updatePreview(null, landslideFile, landslidePreviewUrl);
    landslideResult.value = null;
    return;
  }

  updatePreview(null, glacierFile, glacierPreviewUrl);
  glacierResult.value = null;
}

function isBrowserPreviewable(file: File | null) {
  if (!file) return false;
  return !file.name.toLowerCase().endsWith('.tif') && !file.name.toLowerCase().endsWith('.tiff');
}

function polygonPoints(region: PredictionRegion) {
  return region.polygon.map((point) => `${point.x * 100},${point.y * 100}`).join(' ');
}

function formatMetadataValue(value: string | number | boolean | null) {
  if (value === null) return '无';
  if (typeof value === 'boolean') return value ? '是' : '否';
  return String(value);
}

async function runAnalysis(taskType: 'landslide' | 'glacier') {
  const file = taskType === 'landslide' ? landslideFile.value : glacierFile.value;
  if (!file) {
    ElMessage.warning(`请先选择${taskType === 'landslide' ? '滑坡照片' : 'InSAR 影像'}。`);
    return;
  }

  const formData = new FormData();
  formData.append('file', file);

  const submittingRef = taskType === 'landslide' ? landslideSubmitting : glacierSubmitting;
  submittingRef.value = true;

  try {
    const response = await api.post<HazardPrediction>(`/analysis/${taskType}`, formData, {
      headers: { 'Content-Type': 'multipart/form-data' }
    });

    if (taskType === 'landslide') {
      landslideResult.value = response.data;
    } else {
      glacierResult.value = response.data;
    }

    await fetchRuns();
    ElMessage.success(`${taskLabel(taskType)}已完成。`);
  } catch (error) {
    console.error(error);
    ElMessage.error(`${taskLabel(taskType)}失败，请检查文件格式或后端模型服务配置。`);
  } finally {
    submittingRef.value = false;
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

  if (glacierPreviewUrl.value) {
    URL.revokeObjectURL(glacierPreviewUrl.value);
  }
});
</script>

<template>
  <div class="page-stack">
    <section class="section-head">
      <div>
        <div class="section-kicker" style="color: var(--muted)">analysis</div>
        <h3 class="section-title">智能研判与影响评估</h3>
        <p class="section-desc">在现有模型库之外，直接接入滑坡照片与 InSAR 冰川影像的统一识别接口。</p>
      </div>
    </section>

    <div class="grid-two">
      <el-card class="panel-card analysis-workbench">
        <template #header>
          <div class="section-head" style="margin-bottom: 0">
            <div>
              <h4 class="section-title" style="font-size: 20px">滑坡识别工作台</h4>
              <p class="section-desc">上传地面照片或航拍图，返回是否疑似滑坡及区域标注。</p>
            </div>
            <el-tag type="success">分类 + 分割</el-tag>
          </div>
        </template>

        <div class="analysis-controls">
          <input class="analysis-file-input" type="file" accept="image/*" @change="chooseFile($event, 'landslide')" />
          <div class="analysis-action-row">
            <el-button type="primary" :loading="landslideSubmitting" @click="runAnalysis('landslide')">开始识别</el-button>
            <el-button @click="clearSelection('landslide')">清空</el-button>
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
          <div class="info-strip">
            <div class="info-chip">模型：{{ landslideResult.modelName }}</div>
            <div class="info-chip">来源：{{ landslideResult.provider }}</div>
            <div class="info-chip">置信度：{{ Math.round(landslideResult.confidence * 100) }}%</div>
            <div class="info-chip">
              判定：{{ landslideResult.classification?.hasHazard ? '疑似滑坡' : '未见明显滑坡' }}
            </div>
          </div>
          <p class="table-note">{{ landslideResult.summary }}</p>
        </div>
      </el-card>

      <el-card class="panel-card analysis-workbench">
        <template #header>
          <div class="section-head" style="margin-bottom: 0">
            <div>
              <h4 class="section-title" style="font-size: 20px">冰川识别工作台</h4>
              <p class="section-desc">上传 InSAR 幅值/相位图像，返回冰川边界与变化敏感区。</p>
            </div>
            <el-tag type="warning">InSAR 分割</el-tag>
          </div>
        </template>

        <div class="analysis-controls">
          <input
            class="analysis-file-input"
            type="file"
            accept="image/*,.tif,.tiff"
            @change="chooseFile($event, 'glacier')"
          />
          <div class="analysis-action-row">
            <el-button type="primary" :loading="glacierSubmitting" @click="runAnalysis('glacier')">开始识别</el-button>
            <el-button @click="clearSelection('glacier')">清空</el-button>
          </div>
        </div>

        <div v-if="glacierFile" class="analysis-preview-block">
          <div class="analysis-preview-head">
            <strong>{{ glacierFile.name }}</strong>
            <span class="table-note">{{ Math.round(glacierFile.size / 1024) }} KB</span>
          </div>

          <div v-if="isBrowserPreviewable(glacierFile)" class="analysis-visual">
            <img :src="glacierPreviewUrl" alt="glacier preview" class="analysis-preview" />
            <svg
              v-if="glacierResult?.segmentation.regions.length"
              class="analysis-overlay"
              viewBox="0 0 100 100"
              preserveAspectRatio="none"
            >
              <polygon
                v-for="(region, index) in glacierResult.segmentation.regions"
                :key="`${region.label}-${index}`"
                :points="polygonPoints(region)"
              />
            </svg>
          </div>

          <div v-else class="analysis-placeholder">
            TIFF 等 InSAR 文件可能无法直接预览，但仍可正常上传识别。
          </div>
        </div>

        <div v-if="glacierResult" class="analysis-result">
          <div class="info-strip">
            <div class="info-chip">模型：{{ glacierResult.modelName }}</div>
            <div class="info-chip">来源：{{ glacierResult.provider }}</div>
            <div class="info-chip">置信度：{{ Math.round(glacierResult.confidence * 100) }}%</div>
            <div class="info-chip">区域数：{{ glacierResult.segmentation.regions.length }}</div>
          </div>
          <p class="table-note">{{ glacierResult.summary }}</p>
          <div class="analysis-meta-grid">
            <div v-for="(value, key) in glacierResult.metadata" :key="key" class="analysis-meta-item">
              <span>{{ key }}</span>
              <strong>{{ formatMetadataValue(value) }}</strong>
            </div>
          </div>
        </div>
      </el-card>
    </div>

    <el-card class="panel-card" v-loading="loading">
      <template #header>
        <div class="section-head" style="margin-bottom: 0">
          <div>
            <h4 class="section-title" style="font-size: 20px">最近识别记录</h4>
            <p class="section-desc">统一留存滑坡与冰川识别任务，便于后端模型管理与复核。</p>
          </div>
        </div>
      </template>

      <el-table :data="runs" stripe>
        <el-table-column prop="createdAt" label="时间" width="180" />
        <el-table-column label="任务类型" width="120">
          <template #default="{ row }">{{ taskLabel(row.taskType) }}</template>
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
