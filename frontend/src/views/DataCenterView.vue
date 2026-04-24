<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { api } from '../lib/api';
import type { DashboardOverview, SystemLog } from '../types';

const overview = ref<DashboardOverview | null>(null);
const logs = ref<SystemLog[]>([]);
const loading = ref(false);

async function fetchData() {
  loading.value = true;
  try {
    const [overviewResponse, logsResponse] = await Promise.all([
      api.get<DashboardOverview>('/dashboard/overview'),
      api.get<{ items: SystemLog[] }>('/system/logs', { params: { category: 'ingestion' } })
    ]);
    overview.value = overviewResponse.data;
    logs.value = logsResponse.data.items;
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
    status: '定时同步',
    desc: '用于接入卫星专题成果和变化检测图层'
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
  </div>
</template>

