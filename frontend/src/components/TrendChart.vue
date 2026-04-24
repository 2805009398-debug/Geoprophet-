<script setup lang="ts">
import { BarChart, LineChart, PieChart } from 'echarts/charts';
import {
  GridComponent,
  LegendComponent,
  TooltipComponent
} from 'echarts/components';
import { CanvasRenderer } from 'echarts/renderers';
import { use } from 'echarts/core';
import type { EChartsOption } from 'echarts';
import VChart from 'vue-echarts';

use([CanvasRenderer, TooltipComponent, LegendComponent, GridComponent, LineChart, BarChart, PieChart]);

defineProps<{
  option: EChartsOption;
}>();
</script>

<template>
  <VChart class="chart-card" :option="option" autoresize />
</template>

