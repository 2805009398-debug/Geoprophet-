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

export interface PlanItem {
  id: number;
  title: string;
  level: string;
  status: string;
  leader: string;
  summary: string;
  resourceSummary: string;
  updatedAt: string;
}

export interface SystemLog {
  id: number;
  category: string;
  level: string;
  message: string;
  createdAt: string;
}

export interface RequirementItem {
  area: string;
  implemented: string[];
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

export interface HazardPrediction {
  id: number;
  taskType: 'landslide' | 'glacier';
  provider: 'mock' | 'external-http';
  modelName: string;
  sourceName: string;
  sourceUrl: string;
  createdAt: string;
  summary: string;
  confidence: number;
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

export interface AnalysisRunItem {
  id: number;
  taskType: 'landslide' | 'glacier';
  sourceName: string;
  sourceUrl: string;
  provider: 'mock' | 'external-http';
  modelName: string;
  confidence: number;
  summary: string;
  createdAt: string;
}
