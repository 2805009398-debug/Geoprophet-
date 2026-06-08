<script setup lang="ts">
import { Camera, ChatDotRound, FolderOpened, LocationFilled, Refresh } from '@element-plus/icons-vue';
import { ElMessage } from 'element-plus';
import { computed, onMounted, reactive, ref, watch } from 'vue';
import { API_ORIGIN, api, toAbsoluteAssetUrl } from '../lib/api';
import type { HazardPrediction, ReportImageUploadResponse, ReportItem, SiteSummary } from '../types';

const loading = ref(false);
const submitting = ref(false);
const uploading = ref(false);
const reports = ref<ReportItem[]>([]);
const sites = ref<SiteSummary[]>([]);
const uploadAnalysis = ref<HazardPrediction | null>(null);

const form = reactive({
  siteId: undefined as number | undefined,
  reporterName: '',
  phone: '',
  title: '',
  reportType: '滑坡',
  description: '',
  imageUrl: '',
  aiAnalysisRunId: undefined as number | undefined,
  lat: 41.95,
  lng: 126.95
});

const uploadAction = `${API_ORIGIN}/api/uploads`;

const pendingCount = computed(() => reports.value.filter((item) => item.status === 'pending').length);
const imageCount = computed(() => reports.value.filter((item) => item.imageUrl).length);
const highConfidenceCount = computed(() => reports.value.filter((item) => item.confidenceScore >= 0.75).length);

async function fetchReports() {
  loading.value = true;
  try {
    const [reportResponse, siteResponse] = await Promise.all([
      api.get<{ items: ReportItem[] }>('/reports'),
      api.get<{ items: SiteSummary[] }>('/sites')
    ]);
    reports.value = reportResponse.data.items;
    sites.value = siteResponse.data.items;
  } finally {
    loading.value = false;
  }
}

watch(
  () => form.siteId,
  (siteId) => {
    const site = sites.value.find((item) => item.id === siteId);
    if (site) {
      form.lat = site.lat;
      form.lng = site.lng;
    }
  }
);

function formatPercent(value: number) {
  return `${Math.round(value * 100)}%`;
}

function riskTagType(level?: HazardPrediction['riskAssessment']['riskLevel'] | null) {
  if (level === 'critical' || level === 'high') return 'danger';
  if (level === 'medium') return 'warning';
  if (level === 'low') return 'success';
  return 'info';
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

function handleUploadStart() {
  uploading.value = true;
  form.imageUrl = '';
  form.aiAnalysisRunId = undefined;
  uploadAnalysis.value = null;
  return true;
}

function handleUploadSuccess(response: ReportImageUploadResponse) {
  uploading.value = false;
  const analysisRunId = response?.aiAnalysisRunId ?? response?.analysis?.id;
  if (!response?.url || !response.analysis || !analysisRunId) {
    ElMessage.error('现场图片初审结果不完整，请重新上传。');
    console.warn('Incomplete report image review response:', response);
    return;
  }

  form.imageUrl = response.url;
  form.aiAnalysisRunId = analysisRunId;
  uploadAnalysis.value = { ...response.analysis, id: analysisRunId };
  ElMessage.success('现场图片已上传，图片初审已完成。');
}

function handleUploadError() {
  uploading.value = false;
  form.imageUrl = '';
  form.aiAnalysisRunId = undefined;
  uploadAnalysis.value = null;
  ElMessage.error('现场图片上传或图片预警初审失败，请稍后再试。');
}

function resetForm() {
  Object.assign(form, {
    siteId: undefined,
    reporterName: '',
    phone: '',
    title: '',
    reportType: '滑坡',
    description: '',
    imageUrl: '',
    aiAnalysisRunId: undefined,
    lat: 41.95,
    lng: 126.95
  });
  uploadAnalysis.value = null;
}

async function submitReport() {
  if (!form.reporterName || !form.phone || !form.title || !form.description) {
    ElMessage.warning('请补充上报人、联系方式、标题和现场描述。');
    return;
  }

  if (form.imageUrl && !form.aiAnalysisRunId) {
    ElMessage.warning('带图线索需要先完成图片预警初审。');
    return;
  }

  submitting.value = true;
  try {
    const payload = {
      ...form,
      imageUrl: form.imageUrl || undefined,
      aiAnalysisRunId: form.aiAnalysisRunId
    };
    await api.post('/reports', payload);
    ElMessage.success('线索已进入待复核队列。');
    resetForm();
    await fetchReports();
  } catch (error) {
    ElMessage.error('提交失败，请检查表单。');
    console.error(error);
  } finally {
    submitting.value = false;
  }
}

function statusTagType(status: string) {
  if (status === 'verified') return 'success';
  if (status === 'reviewing') return 'warning';
  return 'info';
}

function openPublicSubmit() {
  window.open('/submit', '_blank', 'noopener,noreferrer');
}

onMounted(fetchReports);
</script>

<template>
  <div class="page-stack">
    <section class="page-intro">
      <div>
        <div class="section-kicker">public evidence</div>
        <h3 class="section-title">群众现场举证</h3>
        <p class="section-desc">后台只做线索补充、清洗和复核流转，不重复建设政府已有的监测看板。</p>
      </div>
      <div class="info-strip">
        <el-button plain :icon="ChatDotRound" @click="openPublicSubmit">公开提交页</el-button>
        <el-button :icon="Refresh" @click="fetchReports">刷新队列</el-button>
      </div>
    </section>

    <div class="grid-three">
      <article class="channel-card">
        <strong>{{ pendingCount }}</strong>
        <div>待复核线索</div>
        <p class="table-note">群众提交后先进入人工复核。</p>
      </article>
      <article class="channel-card">
        <strong>{{ imageCount }}</strong>
        <div>带图举证</div>
        <p class="table-note">有照片的线索更适合做初筛。</p>
      </article>
      <article class="channel-card">
        <strong>{{ highConfidenceCount }}</strong>
        <div>高置信线索</div>
        <p class="table-note">优先转给政府平台或专家复核。</p>
      </article>
    </div>

    <div class="grid-two">
      <el-card class="panel-card">
        <template #header>
          <div class="card-head">
            <div>
              <h4 class="section-title section-title--card">代群众补录</h4>
              <p class="section-desc">适合热线、网格员、村干部把群众描述整理成标准线索。</p>
            </div>
          </div>
        </template>

        <el-form label-position="top">
          <div class="grid-two">
            <el-form-item label="上报人">
              <el-input v-model="form.reporterName" placeholder="例如：王师傅" />
            </el-form-item>
            <el-form-item label="联系电话">
              <el-input v-model="form.phone" placeholder="用于复核回访" />
            </el-form-item>
          </div>

          <div class="grid-two">
            <el-form-item label="灾害类型">
              <el-select v-model="form.reportType">
                <el-option label="滑坡" value="滑坡" />
                <el-option label="泥石流" value="泥石流" />
                <el-option label="崩塌" value="崩塌" />
                <el-option label="沉陷" value="沉陷" />
                <el-option label="裂缝" value="裂缝" />
              </el-select>
            </el-form-item>
            <el-form-item label="政府点位">
              <el-select v-model="form.siteId" clearable placeholder="没有对应点位可不选">
                <el-option v-for="site in sites" :key="site.id" :label="site.name" :value="site.id" />
              </el-select>
            </el-form-item>
          </div>

          <el-form-item label="线索标题">
            <el-input v-model="form.title" placeholder="例如：村后山坡出现新裂缝" />
          </el-form-item>

          <el-form-item label="现场描述">
            <el-input
              v-model="form.description"
              type="textarea"
              :rows="5"
              placeholder="写清位置、时间和变化：裂缝加宽加长、泉水/井水异常、坡脚隆起、异常声响、落石小崩塌、树木或房屋变形等。"
            />
          </el-form-item>

          <div class="grid-two">
            <el-form-item label="纬度">
              <el-input-number v-model="form.lat" :precision="6" :step="0.001" />
            </el-form-item>
            <el-form-item label="经度">
              <el-input-number v-model="form.lng" :precision="6" :step="0.001" />
            </el-form-item>
          </div>

          <el-form-item label="现场图片">
            <div class="upload-line">
              <el-upload
                :action="uploadAction"
                accept="image/*"
                :show-file-list="false"
                :before-upload="handleUploadStart"
                :on-success="handleUploadSuccess"
                :on-error="handleUploadError"
              >
                <el-button plain :icon="FolderOpened" :loading="uploading">选择图片并预警初审</el-button>
              </el-upload>
              <el-tag v-if="form.aiAnalysisRunId" type="success">已初审</el-tag>
            </div>
            <div v-if="form.imageUrl || uploadAnalysis" class="report-review-grid">
              <img v-if="form.imageUrl" :src="toAbsoluteAssetUrl(form.imageUrl)" class="uploader-preview" />
              <div
                v-if="uploadAnalysis"
                class="risk-assessment-card report-ai-card"
                :data-risk="uploadAnalysis.riskAssessment.riskLevel"
              >
                <div class="risk-assessment-head">
                  <div>
                    <span>图片预警初审</span>
                    <strong>{{ uploadAnalysis.riskAssessment.label }}</strong>
                  </div>
                  <el-tag :type="riskTagType(uploadAnalysis.riskAssessment.riskLevel)">
                    {{ uploadAnalysis.riskAssessment.reviewRequired ? '需要复核' : '常规留存' }}
                  </el-tag>
                </div>
                <el-progress
                  :percentage="Math.round(uploadAnalysis.riskAssessment.riskScore * 100)"
                  :color="riskProgressColor(uploadAnalysis.riskAssessment.riskLevel)"
                />
                <div class="analysis-meta-grid">
                  <div class="analysis-meta-item">
                    <span>风险分数</span>
                    <strong>{{ formatPercent(uploadAnalysis.riskAssessment.riskScore) }}</strong>
                  </div>
                  <div class="analysis-meta-item">
                    <span>模型置信度</span>
                    <strong>{{ formatPercent(uploadAnalysis.confidence) }}</strong>
                  </div>
                </div>
                <p class="table-note">{{ uploadAnalysis.summary }}</p>
                <el-alert
                  :type="riskAlertType(uploadAnalysis.riskAssessment.riskLevel)"
                  :closable="false"
                  show-icon
                  title="处置建议"
                  :description="uploadAnalysis.riskAssessment.recommendedAction"
                />
              </div>
            </div>
          </el-form-item>

          <div class="form-actions">
            <el-button type="primary" :icon="Camera" :loading="submitting" :disabled="uploading" @click="submitReport">
              提交到复核队列
            </el-button>
            <el-button @click="resetForm">清空</el-button>
          </div>
        </el-form>
      </el-card>

      <el-card class="panel-card">
        <template #header>
          <div class="card-head">
            <div>
              <h4 class="section-title section-title--card">复核流转</h4>
              <p class="section-desc">群众线索只作为补充证据，最终仍由政府端确认。</p>
            </div>
          </div>
        </template>

        <el-steps direction="vertical" :active="3">
          <el-step title="群众举证" description="收集照片、文字、坐标和联系方式。" />
          <el-step title="后台初筛" description="核对重复线索、图片质量和位置可信度。" />
          <el-step title="政府复核" description="高价值线索进入已有平台或专家处置流程。" />
        </el-steps>

        <div class="handoff-card">
          <el-icon><LocationFilled /></el-icon>
          <div>
            <strong>重点不是再造地图</strong>
            <p>我们补的是政府平台最难实时覆盖的群众现场细节。</p>
          </div>
        </div>
      </el-card>
    </div>

    <el-card class="panel-card" v-loading="loading">
      <template #header>
        <div class="card-head">
          <div>
            <h4 class="section-title section-title--card">线索复核队列</h4>
            <p class="section-desc">用于筛出可转办、可回访、可沉淀的群众例证。</p>
          </div>
        </div>
      </template>

      <el-table :data="reports" stripe>
        <el-table-column prop="reporterName" label="上报人" width="100" />
        <el-table-column prop="title" label="线索" min-width="190" />
        <el-table-column prop="reportType" label="类型" width="100" />
        <el-table-column prop="siteName" label="政府点位" width="160" />
        <el-table-column label="图像" width="90">
          <template #default="{ row }">
            <el-tag :type="row.imageUrl ? 'success' : 'info'">{{ row.imageUrl ? '有图' : '无图' }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="预警风险" width="120">
          <template #default="{ row }">
            <el-tag :type="riskTagType(row.aiRiskLevel)">
              {{ row.aiRiskLabel || (row.aiAnalysisRunId ? '已初审' : '未初审') }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column label="初筛分" width="100">
          <template #default="{ row }">
            {{ Math.round(row.confidenceScore * 100) }}%
          </template>
        </el-table-column>
        <el-table-column label="状态" width="110">
          <template #default="{ row }">
            <el-tag :type="statusTagType(row.status)">{{ row.status }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="createdAt" label="时间" width="170" />
      </el-table>
    </el-card>
  </div>
</template>
