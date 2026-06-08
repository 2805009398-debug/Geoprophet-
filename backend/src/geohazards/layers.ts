export type GeohazardLayerDefinition = {
  id: string;
  datasetId: string;
  title: string;
  source: string;
  theme: string;
  region: string;
  geometryType: 'point' | 'polygon';
  path: string;
  color: string;
  description: string;
  previewLimit?: number;
};

export const geohazardLayerDefinitions: GeohazardLayerDefinition[] = [
  {
    id: 'coolr-reports-northeast',
    datasetId: 'NASA_COOLR_EVENTS',
    title: 'COOLR Reports 东北点位',
    source: 'NASA COOLR',
    theme: '公开灾害样本',
    region: '中国东北重点区',
    geometryType: 'point',
    path: 'coolr/nasa_coolr_reports_points_china_northeast_bbox_115_38_135_54.geojson',
    color: '#dc2626',
    description: 'NASA COOLR 中国东北公开上报点位，可作为白山市演示的外部样本补充。'
  },
  {
    id: 'coolr-reports-southwest-core',
    datasetId: 'NASA_COOLR_EVENTS',
    title: 'COOLR Reports 西南核心区点位',
    source: 'NASA COOLR',
    theme: '公开灾害样本',
    region: '中国西南核心区',
    geometryType: 'point',
    path: 'coolr/nasa_coolr_reports_points_china_southwest_core_bbox_97_21_111_34.geojson',
    color: '#f97316',
    description: '四川、云南、贵州、重庆等西南核心区公开滑坡/泥石流上报点位。'
  },
  {
    id: 'coolr-reports-southwest-extended',
    datasetId: 'NASA_COOLR_EVENTS',
    title: 'COOLR Reports 西南扩展区点位',
    source: 'NASA COOLR',
    theme: '公开灾害样本',
    region: '中国西南扩展区',
    geometryType: 'point',
    path: 'coolr/nasa_coolr_reports_points_china_southwest_extended_bbox_73_21_111_36.geojson',
    color: '#d97706',
    description: '包含西藏与横断山区的西南扩展范围公开上报点位。'
  },
  {
    id: 'coolr-events-china',
    datasetId: 'NASA_COOLR_EVENTS',
    title: 'COOLR Events 中国事件点',
    source: 'NASA COOLR',
    theme: '公开灾害事件',
    region: '中国',
    geometryType: 'point',
    path: 'nasa_coolr_china_landslide_events.geojson',
    color: '#7c3aed',
    description: 'NASA COOLR 中国事件点，适合作为模型验证和案例展示。'
  },
  {
    id: 'lhasa-exposure-northeast',
    datasetId: 'NASA_LHASA',
    title: 'LHASA Exposure 东北风险面',
    source: 'NASA LHASA',
    theme: '降雨诱发滑坡风险',
    region: '中国东北重点区',
    geometryType: 'polygon',
    path: 'lhasa/nasa_lhasa_exposure_china_northeast_bbox_115_38_135_54.geojson',
    color: '#0f766e',
    description: 'LHASA 行政区风险暴露图层，包含低/中/高风险人口与道路暴露指标。'
  },
  {
    id: 'lhasa-exposure-southwest-core',
    datasetId: 'NASA_LHASA',
    title: 'LHASA Exposure 西南核心区风险面',
    source: 'NASA LHASA',
    theme: '降雨诱发滑坡风险',
    region: '中国西南核心区',
    geometryType: 'polygon',
    path: 'lhasa/nasa_lhasa_exposure_china_southwest_core_bbox_97_21_111_34.geojson',
    color: '#0b4f58',
    description: '西南核心区 LHASA 风险暴露面，适合做区域危险性底图。'
  },
  {
    id: 'coolr-events-global-points',
    datasetId: 'NASA_COOLR_EVENTS',
    title: 'COOLR Events 全球事件点',
    source: 'NASA COOLR',
    theme: '全球公开灾害事件',
    region: '全球',
    geometryType: 'point',
    path: 'coolr_global/nasa_coolr_events_points_global.geojson',
    color: '#7c3aed',
    description: 'NASA COOLR 全球事件点，用于扩展滑坡/泥石流样本量和模型训练素材。',
    previewLimit: 5000
  },
  {
    id: 'coolr-reports-global-points',
    datasetId: 'NASA_COOLR_EVENTS',
    title: 'COOLR Reports 全球上报点',
    source: 'NASA COOLR',
    theme: '全球公开灾害样本',
    region: '全球',
    geometryType: 'point',
    path: 'coolr_global/nasa_coolr_reports_points_global.geojson',
    color: '#dc2626',
    description: 'NASA COOLR 全球上报点，用于补充公开滑坡/崩塌/泥石流样本。',
    previewLimit: 5000
  },
  {
    id: 'coolr-events-global-polygons',
    datasetId: 'NASA_COOLR_EVENTS',
    title: 'COOLR Events 全球灾害面',
    source: 'NASA COOLR',
    theme: '全球公开灾害边界',
    region: '全球',
    geometryType: 'polygon',
    path: 'coolr_global/nasa_coolr_events_polygons_global.geojson',
    color: '#0f766e',
    description: 'NASA COOLR 全球滑坡面边界样本，可用于分割样本和灾害范围验证。',
    previewLimit: 1000
  },
  {
    id: 'coolr-reports-global-polygons',
    datasetId: 'NASA_COOLR_EVENTS',
    title: 'COOLR Reports 全球上报面',
    source: 'NASA COOLR',
    theme: '全球公开灾害边界',
    region: '全球',
    geometryType: 'polygon',
    path: 'coolr_global/nasa_coolr_reports_polygons_global.geojson',
    color: '#d97706',
    description: 'NASA COOLR 全球上报面要素，作为少量边界样本补充。'
  }
];
