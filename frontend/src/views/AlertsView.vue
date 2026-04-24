<script setup lang="ts">
import { ElMessage } from 'element-plus';
import { onMounted, reactive, ref } from 'vue';
import { api } from '../lib/api';
import type { AlertItem, SiteSummary } from '../types';

const loading = ref(false);
const dialogVisible = ref(false);
const alerts = ref<AlertItem[]>([]);
const sites = ref<SiteSummary[]>([]);

const filters = reactive({
  severity: '',
  status: ''
});

const form = reactive({
  siteId: undefined as number | undefined,
  title: '',
  severity: 'high',
  source: 'AI趋势模型',
  description: '',
  recommendedAction: ''
});

async function fetchAlerts() {
  loading.value = true;
  try {
    const params = Object.fromEntries(Object.entries(filters).filter(([, value]) => value));
    const { data } = await api.get<{ items: AlertItem[] }>('/alerts', { params });
    alerts.value = data.items;
  } finally {
    loading.value = false;
  }
}

async function fetchSites() {
  const { data } = await api.get<{ items: SiteSummary[] }>('/sites');
  sites.value = data.items;
}

async function acknowledge(id: number) {
  await api.patch(`/alerts/${id}/ack`);
  ElMessage.success('预警已确认。');
  fetchAlerts();
}

async function createAlert() {
  try {
    await api.post('/alerts', form);
    ElMessage.success('预警已创建。');
    dialogVisible.value = false;
    Object.assign(form, {
      siteId: undefined,
      title: '',
      severity: 'high',
      source: 'AI趋势模型',
      description: '',
      recommendedAction: ''
    });
    fetchAlerts();
  } catch (error) {
    ElMessage.error('预警创建失败。');
    console.error(error);
  }
}

function severityTagType(severity: string) {
  if (severity === 'critical' || severity === 'high') return 'danger';
  if (severity === 'medium') return 'warning';
  return 'success';
}

function statusTagType(status: string) {
  if (status === 'active') return 'danger';
  if (status === 'acknowledged') return 'success';
  return 'info';
}

onMounted(async () => {
  await Promise.all([fetchAlerts(), fetchSites()]);
});
</script>

<template>
  <div class="page-stack">
    <el-card class="panel-card">
      <div class="toolbar">
        <div>
          <div class="section-kicker" style="color: var(--muted)">alerts</div>
          <h3 class="section-title">预警中心</h3>
          <p class="section-desc">支持活动预警查看、确认和人工补录，联动处置建议。</p>
        </div>
        <div class="info-strip">
          <el-select v-model="filters.severity" placeholder="等级" clearable style="width: 120px">
            <el-option label="critical" value="critical" />
            <el-option label="high" value="high" />
            <el-option label="medium" value="medium" />
            <el-option label="low" value="low" />
          </el-select>
          <el-select v-model="filters.status" placeholder="状态" clearable style="width: 140px">
            <el-option label="active" value="active" />
            <el-option label="acknowledged" value="acknowledged" />
          </el-select>
          <el-button type="primary" @click="fetchAlerts">筛选</el-button>
          <el-button plain @click="dialogVisible = true">新增预警</el-button>
        </div>
      </div>
    </el-card>

    <el-card class="panel-card" v-loading="loading">
      <el-table :data="alerts" stripe>
        <el-table-column prop="siteName" label="监测点" min-width="150" />
        <el-table-column prop="title" label="预警标题" min-width="220" />
        <el-table-column label="等级" width="110">
          <template #default="{ row }">
            <el-tag :type="severityTagType(row.severity)">{{ row.severity }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="状态" width="120">
          <template #default="{ row }">
            <el-tag :type="statusTagType(row.status)">{{ row.status }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="source" label="来源" width="120" />
        <el-table-column prop="recommendedAction" label="处置建议" min-width="260" />
        <el-table-column prop="createdAt" label="时间" width="170" />
        <el-table-column label="操作" width="120" fixed="right">
          <template #default="{ row }">
            <el-button
              size="small"
              type="primary"
              text
              :disabled="row.status !== 'active'"
              @click="acknowledge(row.id)"
            >
              确认
            </el-button>
          </template>
        </el-table-column>
      </el-table>
    </el-card>

    <el-dialog v-model="dialogVisible" title="新增预警" width="620px">
      <el-form label-position="top">
        <div class="grid-two">
          <el-form-item label="监测点">
            <el-select v-model="form.siteId" placeholder="选择监测点">
              <el-option v-for="site in sites" :key="site.id" :label="site.name" :value="site.id" />
            </el-select>
          </el-form-item>
          <el-form-item label="预警等级">
            <el-select v-model="form.severity">
              <el-option label="critical" value="critical" />
              <el-option label="high" value="high" />
              <el-option label="medium" value="medium" />
              <el-option label="low" value="low" />
            </el-select>
          </el-form-item>
        </div>
        <el-form-item label="标题">
          <el-input v-model="form.title" />
        </el-form-item>
        <el-form-item label="来源">
          <el-input v-model="form.source" />
        </el-form-item>
        <el-form-item label="预警说明">
          <el-input v-model="form.description" type="textarea" :rows="3" />
        </el-form-item>
        <el-form-item label="处置建议">
          <el-input v-model="form.recommendedAction" type="textarea" :rows="3" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="dialogVisible = false">取消</el-button>
        <el-button type="primary" @click="createAlert">保存</el-button>
      </template>
    </el-dialog>
  </div>
</template>

