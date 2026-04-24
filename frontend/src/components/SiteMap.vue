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

function renderMarkers() {
  if (!map || !layerGroup) {
    return;
  }

  layerGroup.clearLayers();
  const bounds: L.LatLngTuple[] = [];

  for (const point of props.points) {
    const color =
      point.riskLevel === 'critical'
        ? '#dc2626'
        : point.riskLevel === 'high'
          ? '#f97316'
          : point.riskLevel === 'medium'
            ? '#ca8a04'
            : '#0f766e';

    const marker = L.circleMarker([point.lat, point.lng], {
      radius: 8 + point.activeAlerts,
      color,
      fillColor: color,
      fillOpacity: 0.82,
      weight: 2
    });

    marker.bindPopup(`
      <strong>${point.name}</strong><br/>
      类型：${point.hazardType}<br/>
      风险：${point.riskLevel}<br/>
      活动预警：${point.activeAlerts}
    `);

    marker.addTo(layerGroup);
    bounds.push([point.lat, point.lng]);
  }

  if (bounds.length > 0) {
    map.fitBounds(bounds, { padding: [28, 28] });
  }
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
