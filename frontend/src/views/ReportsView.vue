<script setup lang="ts">
import { ElMessage } from 'element-plus';
import { onMounted, reactive, ref, watch } from 'vue';
import { API_ORIGIN, api, toAbsoluteAssetUrl } from '../lib/api';
import type { ReportItem, SiteSummary } from '../types';

const loading = ref(false);
const reports = ref<ReportItem[]>([]);
const sites = ref<SiteSummary[]>([]);

const form = reactive({
  siteId: undefined as number | undefined,
  reporterName: '巡检员',
  phone: '13800001234',
  title: '',
  reportType: '滑坡',
  description: '',
  imageUrl: '',
  lat: 41.95,
  lng: 126.95
});

const uploadAction = `${API_ORIGIN}/api/uploads`;

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

function handleUploadSuccess(response: { url: string }) {
  form.imageUrl = response.url;
  ElMessage.success('图片上传成功。');
}

async function submitReport() {
  try {
    await api.post('/reports', form);
    ElMessage.success('群众上报已提交。');
    Object.assign(form, {
      siteId: undefined,
      reporterName: '巡检员',
      phone: '13800001234',
      title: '',
      reportType: '滑坡',
      description: '',
      imageUrl: '',
      lat: 41.95,
      lng: 126.95
    });
    fetchReports();
  } catch (error) {
    ElMessage.error('提交失败，请检查表单。');
    console.error(error);
  }
}

function statusTagType(status: string) {
  if (status === 'verified') return 'success';
  if (status === 'reviewing') return 'warning';
  return 'info';
}

onMounted(fetchReports);
</script>

<template>
  <div class="page-stack">
    <div class="grid-two">
      <el-card class="panel-card">
        <template #header>
          <div class="section-head" style="margin-bottom: 0">
            <div>
              <div class="section-kicker" style="color: var(--muted)">report</div>
              <h3 class="section-title">群众上报采集</h3>
              <p class="section-desc">将公众图文上报并入平台，形成 AI 初审与专家复核闭环。</p>
            </div>
          </div>
        </template>

        <el-form label-position="top">
          <div class="grid-two">
            <el-form-item label="关联监测点">
              <el-select v-model="form.siteId" placeholder="可选">
                <el-option v-for="site in sites" :key="site.id" :label="site.name" :value="site.id" />
              </el-select>
            </el-form-item>
            <el-form-item label="灾害类型">
              <el-select v-model="form.reportType">
                <el-option label="滑坡" value="滑坡" />
                <el-option label="泥石流" value="泥石流" />
                <el-option label="崩塌" value="崩塌" />
                <el-option label="沉陷" value="沉陷" />
                <el-option label="裂缝" value="裂缝" />
              </el-select>
            </el-form-item>
          </div>

          <div class="grid-two">
            <el-form-item label="上报人">
              <el-input v-model="form.reporterName" />
            </el-form-item>
            <el-form-item label="联系电话">
              <el-input v-model="form.phone" />
            </el-form-item>
          </div>

          <el-form-item label="标题">
            <el-input v-model="form.title" placeholder="例如：后山出现新裂缝" />
          </el-form-item>

          <el-form-item label="描述">
            <el-input v-model="form.description" type="textarea" :rows="4" />
          </el-form-item>

          <div class="grid-two">
            <el-form-item label="纬度">
              <el-input-number v-model="form.lat" :precision="6" :step="0.001" style="width: 100%" />
            </el-form-item>
            <el-form-item label="经度">
              <el-input-number v-model="form.lng" :precision="6" :step="0.001" style="width: 100%" />
            </el-form-item>
          </div>

          <el-form-item label="图片附件">
            <el-upload
              :action="uploadAction"
              accept="image/*"
              :show-file-list="false"
              :on-success="handleUploadSuccess"
            >
              <el-button plain>上传图片</el-button>
            </el-upload>
            <img v-if="form.imageUrl" :src="toAbsoluteAssetUrl(form.imageUrl)" class="uploader-preview" />
          </el-form-item>

          <el-button type="primary" @click="submitReport">提交上报</el-button>
        </el-form>
      </el-card>

      <el-card class="panel-card">
        <template #header>
          <div class="section-head" style="margin-bottom: 0">
            <div>
              <h3 class="section-title">质控机制</h3>
              <p class="section-desc">对齐商业计划书里的“AI 初审 + 专家复审 + 信誉体系”思路。</p>
            </div>
          </div>
        </template>

        <el-steps direction="vertical" :active="3">
          <el-step title="公众采集" description="记录位置、时间、图片与基础描述" />
          <el-step title="AI 初审" description="识别灾害类型并估算置信度" />
          <el-step title="专家复核" description="将高价值线索联动到预警中心和方案库" />
        </el-steps>
      </el-card>
    </div>

    <el-card class="panel-card" v-loading="loading">
      <template #header>
        <div class="section-head" style="margin-bottom: 0">
          <div>
            <h4 class="section-title" style="font-size: 20px">上报队列</h4>
            <p class="section-desc">用于审核群众上报并进入标准化业务流程。</p>
          </div>
        </div>
      </template>

      <el-table :data="reports" stripe>
        <el-table-column prop="reporterName" label="上报人" width="100" />
        <el-table-column prop="title" label="标题" min-width="180" />
        <el-table-column prop="reportType" label="类型" width="100" />
        <el-table-column prop="siteName" label="关联点位" width="160" />
        <el-table-column label="置信度" width="110">
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

