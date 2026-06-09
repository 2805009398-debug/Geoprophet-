<script setup lang="ts">
import L from 'leaflet';
import { nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import type { GeoJsonFeature, GeoJsonFeatureCollection, GeohazardLayerMeta, RegionBoundary, WeatherSnapshot } from '../types';

const props = defineProps<{
  collection: GeoJsonFeatureCollection | null;
  layer: GeohazardLayerMeta | null;
  weather?: WeatherSnapshot | null;
  boundaries?: RegionBoundary[];
}>();

const container = ref<HTMLDivElement | null>(null);
let map: L.Map | null = null;
let layerGroup: L.LayerGroup | null = null;
let boundaryLayer: L.LayerGroup | null = null;
let weatherLayer: L.LayerGroup | null = null;
let resizeObserver: ResizeObserver | null = null;

function renderLayer() {
  if (!map || !layerGroup) {
    return;
  }

  layerGroup.clearLayers();
  boundaryLayer?.clearLayers();

  if (!props.collection?.features.length) {
    map.setView([35.6, 105.4], 4);
    renderBoundaries();
    renderWeatherMarker();
    queueMapResize();
    return;
  }

  renderBoundaries();
  const color = props.layer?.color ?? '#0f766e';
  const geoJsonLayer = L.geoJSON(props.collection as never, {
    pointToLayer: (_feature, latlng) =>
      L.circleMarker(latlng, {
        radius: props.layer?.geometryType === 'point' ? 7 : 5,
        color: '#ffffff',
        fillColor: color,
        fillOpacity: 0.88,
        weight: 2,
        opacity: 1
      }),
    style: (feature) => ({
      color,
      weight: 1.8,
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
  renderWeatherMarker();
  queueMapResize();
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

function renderWeatherMarker() {
  if (!map || !weatherLayer) {
    return;
  }

  weatherLayer.clearLayers();
  if (!props.weather) {
    return;
  }

  const marker = L.circleMarker([props.weather.lat, props.weather.lng], {
    radius: 12,
    color: '#ffffff',
    fillColor: weatherColor(props.weather.risk.level),
    fillOpacity: 0.92,
    weight: 3
  });

  marker.bindPopup(`
    <strong>${escapeHtml(props.weather.label)}实时天气</strong>
    <br/>风险：${escapeHtml(props.weather.risk.label)}
    <br/>当前降雨：${props.weather.current.precipitation} mm
    <br/>近24小时：${props.weather.rainfall.last24h} mm
    <br/>未来24小时：${props.weather.rainfall.next24h} mm
    <br/>温度：${props.weather.current.temperature ?? '-'} °C
  `);
  marker.addTo(weatherLayer);
}

function renderBoundaries() {
  if (!map || !boundaryLayer || !props.boundaries?.length) {
    return;
  }

  const collection = {
    type: 'FeatureCollection',
    features: props.boundaries.map((boundary) => ({
      type: 'Feature',
      geometry: boundary.geometry,
      properties: {
        name: boundary.name
      }
    }))
  };

  L.geoJSON(collection as never, {
    style: {
      color: '#315f9f',
      weight: 2,
      opacity: 0.88,
      fillColor: '#315f9f',
      fillOpacity: 0.045,
      dashArray: '6 5'
    },
    onEachFeature: (feature, leafletLayer) => {
      const name = stringValue((feature.properties as Record<string, unknown> | undefined)?.name) ?? '地区边界';
      leafletLayer.bindPopup(`<strong>${escapeHtml(name)}</strong><br/>地区矢量边界`);
    }
  }).addTo(boundaryLayer);
}

function weatherColor(level: WeatherSnapshot['risk']['level']) {
  if (level === 'high') return '#c43c32';
  if (level === 'medium') return '#b87514';
  return '#315f9f';
}

function queueMapResize() {
  window.setTimeout(() => {
    map?.invalidateSize();
  }, 80);
}

function addFallbackGrid() {
  if (!map) {
    return;
  }

  const bounds = L.latLngBounds([15, 70], [55, 140]);
  L.rectangle(bounds, {
    color: '#b7c9d1',
    weight: 1,
    fillColor: '#eef4f5',
    fillOpacity: 0.42,
    interactive: false
  }).addTo(map);

  for (const lat of [20, 30, 40, 50]) {
    L.polyline([[lat, 70], [lat, 140]], {
      color: '#d7e1e4',
      weight: 1,
      interactive: false
    }).addTo(map);
  }

  for (const lng of [80, 100, 120]) {
    L.polyline([[15, lng], [55, lng]], {
      color: '#d7e1e4',
      weight: 1,
      interactive: false
    }).addTo(map);
  }
}

onMounted(() => {
  if (!container.value) {
    return;
  }

  map = L.map(container.value, {
    zoomControl: true,
    preferCanvas: true
  }).setView([35.6, 105.4], 4);

  addFallbackGrid();
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '&copy; OpenStreetMap',
    maxZoom: 18,
    crossOrigin: true
  }).addTo(map);

  boundaryLayer = L.layerGroup().addTo(map);
  layerGroup = L.layerGroup().addTo(map);
  weatherLayer = L.layerGroup().addTo(map);
  resizeObserver = new ResizeObserver(queueMapResize);
  resizeObserver.observe(container.value);
  void nextTick(queueMapResize);
  renderLayer();
});

watch(
  () => [props.collection, props.layer, props.weather, props.boundaries],
  () => {
    renderLayer();
  },
  { deep: true }
);

onBeforeUnmount(() => {
  resizeObserver?.disconnect();
  resizeObserver = null;
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
      <template v-if="weather">
        <span class="legend-divider"></span>
        <span class="legend-swatch legend-swatch--weather"></span>
        <span>{{ weather.risk.label }}</span>
      </template>
      <template v-if="boundaries?.length">
        <span class="legend-divider"></span>
        <span class="legend-line"></span>
        <span>地区边界</span>
      </template>
    </div>
  </div>
</template>
