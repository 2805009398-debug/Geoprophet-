<script setup lang="ts">
import { Camera, Check, FolderOpened, LocationFilled } from '@element-plus/icons-vue';
import { ElMessage } from 'element-plus';
import { reactive, ref } from 'vue';
import { API_ORIGIN, api, toAbsoluteAssetUrl } from '../lib/api';
import type { HazardPrediction, ReportImageUploadResponse } from '../types';

const submitting = ref(false);
const locating = ref(false);
const uploading = ref(false);
const uploadAnalysis = ref<HazardPrediction | null>(null);

const form = reactive({
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

function formatPercent(value: number) {
  return `${Math.round(value * 100)}%`;
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
    ElMessage.error('照片初审结果不完整，请重新上传。');
    console.warn('Incomplete report image review response:', response);
    return;
  }

  form.imageUrl = response.url;
  form.aiAnalysisRunId = analysisRunId;
  uploadAnalysis.value = { ...response.analysis, id: analysisRunId };
  ElMessage.success('照片已上传，图片初审已完成。');
}

function handleUploadError() {
  uploading.value = false;
  form.imageUrl = '';
  form.aiAnalysisRunId = undefined;
  uploadAnalysis.value = null;
  ElMessage.error('照片上传或图片预警初审失败，请稍后再试。');
}

function resetForm() {
  Object.assign(form, {
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

function useCurrentLocation() {
  if (!navigator.geolocation) {
    ElMessage.warning('当前浏览器不支持定位，请手动填写坐标。');
    return;
  }

  locating.value = true;
  navigator.geolocation.getCurrentPosition(
    (position) => {
      form.lat = Number(position.coords.latitude.toFixed(6));
      form.lng = Number(position.coords.longitude.toFixed(6));
      locating.value = false;
      ElMessage.success('已获取当前位置。');
    },
    () => {
      locating.value = false;
      ElMessage.warning('定位失败，请手动填写坐标或检查权限。');
    },
    {
      enableHighAccuracy: true,
      timeout: 10000,
      maximumAge: 30000
    }
  );
}

async function submitReport() {
  if (!form.reporterName || !form.phone || !form.title || !form.description) {
    ElMessage.warning('请填写姓名、电话、标题和现场描述。');
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
    ElMessage.success('已提交，感谢补充现场线索。');
    resetForm();
  } catch (error) {
    ElMessage.error('提交失败，请检查填写内容。');
    console.error(error);
  } finally {
    submitting.value = false;
  }
}
</script>

<template>
  <main class="submit-page">
    <section class="submit-hero">
      <div>
        <div class="section-kicker">GeoProphet</div>
        <h1>发现山体裂缝、滑坡痕迹或落石，请把现场例证传上来。</h1>
        <p>这里不是政府监测平台的替代品，只用于补充群众看到的现场照片、位置和描述，方便后续复核。</p>
      </div>
      <div class="submit-hero-note">
        <strong>建议提交</strong>
        <span>照片清楚、位置准确、描述具体的线索。</span>
      </div>
    </section>

    <section class="submit-form-panel">
      <div class="section-head">
        <div>
          <div class="section-kicker">submit</div>
          <h2 class="section-title">提交现场线索</h2>
          <p class="section-desc">请尽量写清“在哪里、看到了什么、什么时候发现”。</p>
        </div>
      </div>

      <el-form label-position="top">
        <div class="grid-two">
          <el-form-item label="姓名">
            <el-input v-model="form.reporterName" placeholder="用于复核回访" />
          </el-form-item>
          <el-form-item label="联系电话">
            <el-input v-model="form.phone" placeholder="请填写可联系号码" />
          </el-form-item>
        </div>

        <div class="grid-two">
          <el-form-item label="线索类型">
            <el-select v-model="form.reportType">
              <el-option label="滑坡" value="滑坡" />
              <el-option label="泥石流" value="泥石流" />
              <el-option label="崩塌" value="崩塌" />
              <el-option label="沉陷" value="沉陷" />
              <el-option label="裂缝" value="裂缝" />
            </el-select>
          </el-form-item>
          <el-form-item label="简短标题">
            <el-input v-model="form.title" placeholder="例如：村口公路旁新裂缝" />
          </el-form-item>
        </div>

        <el-form-item label="现场描述">
          <el-input
            v-model="form.description"
            type="textarea"
            :rows="5"
            placeholder="例如：裂缝正在加宽加长、泉水或井水突然异常、坡脚隆起、听到开裂声、落石增多、树木或房屋变形。"
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

        <div class="submit-actions">
          <el-button :icon="LocationFilled" :loading="locating" @click="useCurrentLocation">获取定位</el-button>
          <el-upload
            :action="uploadAction"
            accept="image/*"
            :show-file-list="false"
            :before-upload="handleUploadStart"
            :on-success="handleUploadSuccess"
            :on-error="handleUploadError"
          >
            <el-button :icon="FolderOpened" :loading="uploading">上传并预警初审</el-button>
          </el-upload>
          <el-button type="primary" :icon="Check" :loading="submitting" :disabled="uploading" @click="submitReport">
            提交线索
          </el-button>
        </div>

        <div v-if="form.imageUrl || uploadAnalysis" class="submit-review-grid">
          <img v-if="form.imageUrl" :src="toAbsoluteAssetUrl(form.imageUrl)" class="submit-preview" />
          <div
            v-if="uploadAnalysis"
            class="risk-assessment-card submit-ai-card"
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
            <div class="risk-evidence-list">
              <strong>判定依据</strong>
              <ul>
                <li v-for="item in uploadAnalysis.riskAssessment.evidence" :key="item">{{ item }}</li>
              </ul>
            </div>
            <el-alert
              :type="riskAlertType(uploadAnalysis.riskAssessment.riskLevel)"
              :closable="false"
              show-icon
              title="处置建议"
              :description="uploadAnalysis.riskAssessment.recommendedAction"
            />
          </div>
        </div>
      </el-form>

      <div class="submit-tips">
        <article>
          <el-icon><Camera /></el-icon>
          <span>拍摄裂缝、滑坡边界、落石、道路受阻等可见现象。</span>
        </article>
        <article>
          <el-icon><LocationFilled /></el-icon>
          <span>请站在安全位置提交，不要靠近危险坡体。</span>
        </article>
      </div>
    </section>
  </main>
</template>
