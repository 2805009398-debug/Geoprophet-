<script setup lang="ts">
import type { DashboardStat } from '../types';

defineProps<{
  stat: DashboardStat;
}>();
</script>

<template>
  <article class="stat-card" :data-tone="stat.tone">
    <div class="stat-label">{{ stat.label }}</div>
    <div class="stat-value">
      {{ stat.value }}
      <small>{{ stat.suffix }}</small>
    </div>
    <p>{{ stat.hint }}</p>
  </article>
</template>

