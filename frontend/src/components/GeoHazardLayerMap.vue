<script setup lang="ts">
import L from 'leaflet';
import { onBeforeUnmount, onMounted, ref, watch } from 'vue';
import type { GeoJsonFeature, GeoJsonFeatureCollection, GeohazardLayerMeta } from '../types';

const props = defineProps<{
  collection: GeoJsonFeatureCollection | null;
  layer: GeohazardLayerMeta | null;
}>();

const container = ref<HTMLDivElement | null>(null);
let map: L.Map | null = null;
let layerGroup: L.LayerGroup | null = null;

function renderLayer() {
  if (!map || !layerGroup) {
    return;
  }

  layerGroup.clearLayers();

  if (!props.collection?.features.length) {
    map.setView([35.6, 105.4], 4);
    return;
  }

  const color = props.layer?.color ?? '#0f766e';
  const geoJsonLayer = L.geoJSON(props.collection as never, {
    pointToLayer: (_feature, latlng) =>
      L.circleMarker(latlng, {
        radius: 5,
        color,
        fillColor: color,
        fillOpacity: 0.78,
        weight: 1.5
      }),
    style: (feature) => ({
      color,
      weight: 1.2,
      fillColor: color,
      fillOpacity: polygonOpacity(feature?.properties as GeoJsonFeature['properties'])
    }),
    onEachFeature: (feature, leafletLayer) => {
      leafletLayer.bindPopup(buildPopup(feature as GeoJsonFeature));
    }
  });

  geoJsonLayer.addTo(layerGroup);
  const bounds = geoJsonLayer.getBounds();
  if (bounds.isValid()) {
    map.fitBounds(bounds, { padding: [28, 28], maxZoom: props.layer?.geometryType === 'point' ? 9 : 7 });
  }
}

function polygonOpacity(properties?: GeoJsonFeature['properties']) {
  const highRisk = Number(properties?.h_haz_f ?? properties?.high_hazard_fraction ?? 0);
  const moderateRisk = Number(properties?.m_haz_f ?? properties?.moderate_hazard_fraction ?? 0);
  if (highRisk > 0) return 0.28;
  if (moderateRisk > 0) return 0.2;
  return 0.12;
}

function buildPopup(feature: GeoJsonFeature) {
  const properties = feature.properties ?? {};
  const title =
    stringValue(properties.event_title) ??
    stringValue(properties.name_2) ??
    stringValue(properties.admin_name) ??
    stringValue(properties.location_description) ??
    props.layer?.title ??
    '地灾图层要素';

  const rows = [
    ['来源', properties.source_name ?? props.layer?.source],
    ['类型', properties.landslide_category ?? props.layer?.theme],
    ['触发', properties.landslide_trigger],
    ['规模', properties.landslide_size],
    ['区域', properties.admin_division_name ?? properties.name_2 ?? props.layer?.region],
    ['最近地名', properties.gazetteer_closest_point],
    ['位置精度', properties.location_accuracy],
    ['日期', formatDate(properties.event_date)],
    ['高风险占比', formatPercent(properties.h_haz_f ?? properties.high_hazard_fraction)],
    ['死亡人数', properties.fatality_count]
  ].filter(([, value]) => value !== undefined && value !== null && String(value).trim());

  return `
    <strong>${escapeHtml(title)}</strong>
    ${rows.map(([label, value]) => `<br/>${escapeHtml(String(label))}：${escapeHtml(String(value))}`).join('')}
  `;
}

function formatDate(value: unknown) {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return new Date(value).toISOString().slice(0, 10);
  }
  return value;
}

function formatPercent(value: unknown) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return undefined;
  }
  return `${(numeric * 100).toFixed(1)}%`;
}

function stringValue(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
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
  }).setView([35.6, 105.4], 4);

  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '&copy; OpenStreetMap'
  }).addTo(map);

  layerGroup = L.layerGroup().addTo(map);
  renderLayer();
});

watch(
  () => [props.collection, props.layer],
  () => {
    renderLayer();
  },
  { deep: true }
);

onBeforeUnmount(() => {
  map?.remove();
  map = null;
});
</script>

<template>
  <div class="geohazard-map-frame">
    <div ref="container" class="geohazard-map"></div>
    <div v-if="layer" class="geohazard-map-legend">
      <span class="legend-swatch" :style="{ backgroundColor: layer.color }"></span>
      <span>{{ layer.title }}</span>
    </div>
  </div>
</template>
