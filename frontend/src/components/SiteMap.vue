<script setup lang="ts">
import L from 'leaflet';
import { onBeforeUnmount, onMounted, ref, watch } from 'vue';
import type { MapPoint } from '../types';

const props = defineProps<{
  points: MapPoint[];
}>();

const container = ref<HTMLDivElement | null>(null);
let map: L.Map | null = null;
let layerGroup: L.LayerGroup | null = null;

const markerColors = {
  critical: '#c43c32',
  high: '#b87514',
  medium: '#315f9f',
  low: '#0f766e'
};

function renderMarkers() {
  if (!map || !layerGroup) {
    return;
  }

  layerGroup.clearLayers();
  const bounds: L.LatLngTuple[] = [];

  for (const point of props.points) {
    const color = markerColors[point.riskLevel as keyof typeof markerColors] ?? markerColors.low;

    const marker = L.circleMarker([point.lat, point.lng], {
      radius: 8 + point.activeAlerts,
      color,
      fillColor: color,
      fillOpacity: 0.82,
      weight: 2
    });

    marker.bindPopup(`
      <strong>${escapeHtml(point.name)}</strong><br/>
      类型：${escapeHtml(point.hazardType)}<br/>
      风险：${escapeHtml(point.riskLevel)}<br/>
      活动预警：${escapeHtml(String(point.activeAlerts))}
    `);

    marker.addTo(layerGroup);
    bounds.push([point.lat, point.lng]);
  }

  if (bounds.length > 0) {
    map.fitBounds(bounds, { padding: [28, 28] });
  }
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

onMounted(() => {
  if (!container.value) {
    return;
  }

  map = L.map(container.value, {
    zoomControl: false
  }).setView([41.95, 126.95], 8);

  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '&copy; OpenStreetMap'
  }).addTo(map);

  layerGroup = L.layerGroup().addTo(map);
  renderMarkers();
});

watch(
  () => props.points,
  () => {
    renderMarkers();
  },
  { deep: true }
);

onBeforeUnmount(() => {
  map?.remove();
  map = null;
});
</script>

<template>
  <div ref="container" class="site-map"></div>
</template>
