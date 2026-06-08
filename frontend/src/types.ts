export interface UserProfile {
  id: number;
  username: string;
  role: string;
  name: string;
}

export interface LoginProviders {
  providers: {
    local: boolean;
    oidc: {
      enabled: boolean;
      issuer?: string;
      clientId?: string;
      redirectUri?: string;
    };
  };
  demoAccounts: Array<{
    username: string;
    password: string;
    role: string;
  }>;
}

export interface DashboardStat {
  label: string;
  value: number;
  suffix: string;
  tone: 'primary' | 'success' | 'warning' | 'danger';
  hint: string;
}

export interface DistributionItem {
  total: number;
  riskLevel?: string;
  severity?: string;
}

export interface TrendSeries {
  labels: string[];
  series: number[];
}

export interface MapPoint {
  id: number;
  name: string;
  hazardType: string;
  riskLevel: string;
  status: string;
  lat: number;
  lng: number;
  activeAlerts: number;
}

export interface DashboardOverview {
  stats: DashboardStat[];
  riskDistribution: DistributionItem[];
  severityDistribution: DistributionItem[];
  alertTrend: TrendSeries;
  reportTrend: TrendSeries;
  siteMap: MapPoint[];
  recentAlerts: AlertItem[];
  recentFeed: SystemLog[];
  ingestionStatus: {
    channelCount: number;
    avgLatencyMs: number;
    transmissionErrors: number;
    successRate: number;
  };
}

export interface SiteSummary {
  id: number;
  code: string;
  name: string;
  district: string;
  hazardType: string;
  riskLevel: string;
  status: string;
  lat: number;
  lng: number;
  lastInspectionAt: string;
  description: string;
  sensorCount: number;
  activeAlerts: number;
}

export interface SiteSensor {
  id: number;
  name: string;
  sensorType: string;
  unit: string;
  status: string;
  lastValue: number;
  lastCollectedAt: string;
}

export interface SiteObservation {
  id: number;
  observedAt: string;
  value: number;
  quality: string;
  anomalyLevel: string;
  sensorName: string;
  sensorType: string;
  unit: string;
}

export interface AssessmentItem {
  id: number;
  siteName: string;
  district: string;
  level: string;
  populationAffected: number;
  economicLoss: number;
  roadImpact: string;
  summary: string;
  createdAt: string;
}

export interface SiteDetail {
  site: SiteSummary;
  sensors: SiteSensor[];
  observations: SiteObservation[];
  assessment?: Omit<AssessmentItem, 'siteName' | 'district'>;
}

export interface AlertItem {
  id: number;
  title: string;
  severity: string;
  status: string;
  source: string;
  description: string;
  recommendedAction: string;
  createdAt: string;
  acknowledgedAt?: string | null;
  siteName: string;
  district: string;
}

export interface ReportItem {
  id: number;
  reporterName: string;
  phone: string;
  title: string;
  reportType: string;
  description: string;
  imageUrl?: string | null;
  lat: number;
  lng: number;
  confidenceScore: number;
  status: string;
  createdAt: string;
  siteName?: string | null;
  aiAnalysisRunId?: number | null;
  aiProvider?: string | null;
  aiModelName?: string | null;
  aiRiskLevel?: RiskAssessment['riskLevel'] | null;
  aiRiskLabel?: string | null;
  aiSummary?: string | null;
  aiRecommendedAction?: string | null;
  aiReviewRequired?: boolean;
}

export interface ModelItem {
  id: number;
  name: string;
  category: string;
  version: string;
  accuracy: number;
  status: string;
  lastRunAt: string;
  summary: string;
}

export interface SystemLog {
  id: number;
  category: string;
  level: string;
  message: string;
  createdAt: string;
}

export interface PredictionPoint {
  x: number;
  y: number;
}

export interface PredictionRegion {
  label: string;
  score: number;
  polygon: PredictionPoint[];
}

export interface RiskAssessment {
  riskLevel: 'low' | 'medium' | 'high' | 'critical';
  riskScore: number;
  label: string;
  evidence: string[];
  recommendedAction: string;
  reviewRequired: boolean;
  basis: string;
}

export interface HazardPrediction {
  id: number;
  taskType: 'landslide';
  provider: 'mock' | 'external-http' | 'vision-llm';
  modelName: string;
  sourceName: string;
  sourceUrl: string;
  createdAt: string;
  summary: string;
  confidence: number;
  riskAssessment: RiskAssessment;
  classification?: {
    hasHazard: boolean;
    label: string;
    confidence: number;
  };
  segmentation: {
    regions: PredictionRegion[];
  };
  metadata: Record<string, string | number | boolean | null>;
}

export interface ReportImageUploadResponse {
  url: string;
  aiAnalysisRunId?: number;
  analysis: HazardPrediction;
}

export interface AnalysisRunItem {
  id: number;
  taskType: 'landslide';
  sourceName: string;
  sourceUrl: string;
  provider: 'mock' | 'external-http' | 'vision-llm';
  modelName: string;
  confidence: number;
  summary: string;
  createdAt: string;
}

export interface VisionConfig {
  provider: 'disabled' | 'doubao' | 'openai-compatible' | 'deepseek';
  enabled: boolean;
  configured: boolean;
  model: string | null;
  baseUrl: string | null;
  timeoutMs: number;
}

export interface GeohazardLayerMeta {
  id: string;
  title: string;
  source: string;
  theme: string;
  region: string;
  geometryType: 'point' | 'polygon';
  path: string;
  color: string;
  description: string;
  available: boolean;
  recordCount: number;
  bytes: number;
}

export interface GeohazardOverview {
  summary: {
    fileCount: number;
    recordCount: number;
    vectorRecordCount: number;
    totalBytes: number;
    totalSizeMb: number;
    vectorLayerCount: number;
    rasterFileCount: number;
  };
  groups: Array<{
    name: string;
    fileCount: number;
    totalBytes: number;
    totalSizeMb: number;
  }>;
  layers: GeohazardLayerMeta[];
  catalog: Array<Record<string, string>>;
  regions: Array<{
    id: string;
    name: string;
    bbox: number[];
    description: string;
  }>;
  landsatScenes: Array<{
    path: string;
    sceneId: string;
    bytes: number;
  }>;
  gatedProducts: Array<{
    name: string;
    reason: string;
  }>;
  storage?: {
    vector: string;
    raster: string;
  };
  remoteSensing: RemoteSensingStatus;
}

export interface RemoteSensingProduct {
  id: string;
  title: string;
  layerName: string;
  source: string;
  description: string;
}

export interface RemoteSensingRegion {
  id: string;
  name: string;
  bbox: number[];
  description?: string;
}

export interface RemoteSensingRun {
  id: number;
  status: 'running' | 'success' | 'partial' | 'failed';
  triggeredBy: string;
  targetDate: string;
  startedAt: string;
  finishedAt?: string | null;
  regionCount?: number;
  productCount?: number;
  assetCount: number;
  errorCount: number;
  message: string;
}

export interface RemoteSensingAsset {
  id: number;
  productId: string;
  productTitle: string;
  source: string;
  layerName: string;
  regionId: string;
  regionName: string;
  bbox: number[];
  assetDate: string;
  format: string;
  filePath: string;
  bytes: number;
  width: number;
  height: number;
  wmsUrl: string;
  status: string;
  createdAt: string;
}

export interface RemoteSensingStatus {
  enabled: boolean;
  syncOnStart: boolean;
  intervalHours: number;
  lagDays: number;
  endpoint: string;
  nextScheduledAt?: string | null;
  inProgress: boolean;
  manifestPath: string;
  products: RemoteSensingProduct[];
  regions: RemoteSensingRegion[];
  summary: {
    assetCount: number;
    totalBytes: number;
    totalSizeMb: number;
    latestAssetDate?: string | null;
    lastAssetAt?: string | null;
  };
  lastRun?: RemoteSensingRun | null;
  recentRuns: RemoteSensingRun[];
  recentAssets: RemoteSensingAsset[];
}

export interface MonitoringWorkflowStep {
  key: string;
  title: string;
  status: 'done' | 'running' | 'waiting';
  detail: string;
}

export interface MonitoringDataSource {
  id: string;
  title: string;
  source: string;
  status: 'ready' | 'running' | 'waiting' | 'standby';
  availableAssets: number;
  quality: number;
  usage: string;
}

export interface MonitoringRegion {
  id: string;
  name: string;
  bbox: number[];
  description?: string;
  assetCount: number;
  activeAlertCount: number;
}

export interface MonitoringHazardPatch {
  id: string;
  name: string;
  district: string;
  hazardType: string;
  riskLevel: 'low' | 'medium' | 'high' | 'critical';
  riskLabel: string;
  confidence: number;
  lat: number;
  lng: number;
  evidenceCount: number;
  source: string;
  reason: string;
  recommendedAction: string;
}

export interface MonitoringReviewItem {
  id: string;
  type: string;
  title: string;
  siteName: string;
  district: string;
  riskLevel: 'low' | 'medium' | 'high' | 'critical';
  priority: number;
  status: 'pending' | 'reviewing';
  source: string;
  createdAt?: string | null;
  summary: string;
}

export interface MonitoringDailyOverview {
  service: {
    title: string;
    subtitle: string;
    targetDate?: string | null;
    enabled: boolean;
    inProgress: boolean;
    nextScheduledAt?: string | null;
    intervalHours: number;
    lagDays: number;
    lastRun?: RemoteSensingRun | null;
  };
  stats: DashboardStat[];
  workflow: MonitoringWorkflowStep[];
  dataSources: MonitoringDataSource[];
  regions: MonitoringRegion[];
  hazardPatches: MonitoringHazardPatch[];
  reviewQueue: MonitoringReviewItem[];
  recentAssets: RemoteSensingAsset[];
  recentRuns: RemoteSensingRun[];
  reportDraft: {
    title: string;
    riskSummary: string;
    patchCount: number;
    highRiskCount: number;
    reviewCount: number;
    recommendedActions: string[];
  };
}

export interface GeoJsonFeature {
  type: 'Feature';
  geometry: {
    type: string;
    coordinates: unknown;
  } | null;
  properties: Record<string, string | number | boolean | null>;
}

export interface GeoJsonFeatureCollection {
  type: 'FeatureCollection';
  features: GeoJsonFeature[];
  totalFeatures?: number;
  returnedFeatures?: number;
  previewLimited?: boolean;
  previewLimit?: number | null;
  offset?: number;
  filters?: {
    bbox?: number[];
    property?: string;
    value?: string;
    keyword?: string;
    limit?: number | null;
    offset?: number;
  };
}

export interface LandslideSampleOption {
  label: string;
  value: string;
  count: number;
}

export interface LandslideSampleSummary {
  source: {
    name: string;
    provider: string;
    path: string;
    bytes: number;
    updatedAt: string | null;
  };
  summary: {
    total: number;
    rawTotal: number;
    dated: number;
    undated: number;
    countries: number;
    totalFatalities: number;
    totalInjuries: number;
    bounds: number[] | null;
    dateRange: {
      start: string | null;
      end: string | null;
    };
  };
  filtering: {
    countryCodes: string[];
    minEventDate: string;
    rawTotal: number;
    excludedTotal: number;
    excludedByCountry: number;
    excludedByDate: number;
  };
  categories: LandslideSampleOption[];
  triggers: LandslideSampleOption[];
  sizes: LandslideSampleOption[];
  countries: LandslideSampleOption[];
  regions: LandslideSampleOption[];
  topCountries: LandslideSampleOption[];
  topRegions: LandslideSampleOption[];
  yearlyTrend: Array<{
    year: string;
    count: number;
  }>;
}

export interface LandslideSampleItem {
  id: string;
  objectId: number | null;
  eventId: string;
  title: string;
  description: string;
  category: string;
  trigger: string;
  size: string;
  setting: string;
  countryName: string;
  countryCode: string;
  adminDivision: string;
  locationDescription: string;
  locationAccuracy: string;
  closestPlace: string;
  eventDate: string | null;
  submittedDate: string | null;
  fatalities: number;
  injuries: number;
  sourceName: string;
  sourceLink: string;
  photoLink: string;
  lat: number;
  lng: number;
}

export interface LandslideSampleResponse {
  items: LandslideSampleItem[];
  total: number;
  limit: number;
  offset: number;
  returned: number;
  mapReturned: number;
  previewLimited: boolean;
  filters: Record<string, unknown>;
  featureCollection: GeoJsonFeatureCollection;
}
