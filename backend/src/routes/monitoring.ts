import { FastifyInstance } from 'fastify';
import { authenticate } from '../guards';
import { getRemoteSensingStatus } from '../services/remote-sensing-sync';

type Severity = 'low' | 'medium' | 'high' | 'critical';

const severityRank: Record<Severity, number> = {
  low: 1,
  medium: 2,
  high: 3,
  critical: 4
};

const severityLabels: Record<Severity, string> = {
  low: '低风险',
  medium: '一般风险',
  high: '高风险',
  critical: '极高风险'
};

const workflowSteps = [
  {
    key: 'aoi',
    title: '配置AOI/阈值',
    status: 'done',
    detail: '重点山区、道路、景区和隐患点已纳入每日调度范围。'
  },
  {
    key: 'query',
    title: '查询遥感与降雨',
    status: 'done',
    detail: 'NASA GIBS、GPM IMERG、Landsat/公开数据作为基础数据源。'
  },
  {
    key: 'quality',
    title: '质量筛选',
    status: 'running',
    detail: '按时间、空间覆盖、云量和数据质量筛选可用资产。'
  },
  {
    key: 'fusion',
    title: '融合识别',
    status: 'running',
    detail: '叠加遥感、DEM、降雨、历史灾害点和群众上报。'
  },
  {
    key: 'review',
    title: '专家复核',
    status: 'waiting',
    detail: '高风险图斑和高可信图片初筛结果进入专家复核队列。'
  },
  {
    key: 'output',
    title: '看板/报告更新',
    status: 'waiting',
    detail: '输出风险等级、疑似图斑、预警原因和建议复核点。'
  }
];

export async function monitoringRoutes(fastify: FastifyInstance) {
  fastify.get('/api/monitoring/daily', { preHandler: authenticate }, async () => {
    const remoteSensing = await getRemoteSensingStatus(fastify);
    const sites = listSites(fastify);
    const alerts = listActiveAlerts(fastify);
    const reports = listPendingReports(fastify);
    const recentAssets = remoteSensing.recentAssets ?? [];
    const latestAssetDate =
      asOptionalString(remoteSensing.summary.latestAssetDate) ??
      asOptionalString(remoteSensing.lastRun?.targetDate) ??
      null;
    const latestRun = remoteSensing.lastRun ?? null;
    const hazardPatches = buildHazardPatches(sites, alerts, reports, recentAssets.length);
    const reviewQueue = buildReviewQueue(alerts, reports, hazardPatches);
    const productCoverage = buildProductCoverage(remoteSensing.products, recentAssets);

    const highPatchCount = hazardPatches.filter((item) => severityRank[item.riskLevel] >= severityRank.high).length;
    const criticalPatchCount = hazardPatches.filter((item) => item.riskLevel === 'critical').length;
    const pendingReviewCount = reviewQueue.filter((item) => item.status === 'pending').length;

    return {
      service: {
        title: '每日自动化遥感监测服务',
        subtitle: '每日调度 + 有新数据即更新 + 多源数据补位',
        targetDate: latestAssetDate,
        enabled: remoteSensing.enabled,
        inProgress: remoteSensing.inProgress,
        nextScheduledAt: remoteSensing.nextScheduledAt,
        intervalHours: remoteSensing.intervalHours,
        lagDays: remoteSensing.lagDays,
        lastRun: latestRun
      },
      stats: [
        {
          label: '监测AOI',
          value: remoteSensing.regions.length,
          suffix: '个',
          tone: 'primary',
          hint: '政府端配置的重点区域与风险阈值'
        },
        {
          label: '可用遥感资产',
          value: remoteSensing.summary.assetCount,
          suffix: '个',
          tone: 'success',
          hint: `最近影像日期 ${latestAssetDate ?? '待同步'}`
        },
        {
          label: '高风险图斑',
          value: highPatchCount,
          suffix: '处',
          tone: criticalPatchCount > 0 ? 'danger' : 'warning',
          hint: '由预警、站点风险和近地面线索融合生成'
        },
        {
          label: '待专家复核',
          value: pendingReviewCount,
          suffix: '项',
          tone: pendingReviewCount > 0 ? 'warning' : 'success',
          hint: '高风险点和AI初筛结果进入复核闭环'
        }
      ],
      workflow: workflowSteps,
      dataSources: [
        ...productCoverage,
        {
          id: 'dem-slope',
          title: 'DEM / 坡度坡向',
          source: 'ALOS/SRTM/ASTER',
          status: 'standby',
          availableAssets: sites.length,
          quality: 92,
          usage: '易发性分析与风险分级背景因子'
        },
        {
          id: 'public-reports',
          title: '群众上报/移动端实拍',
          source: '公众端与巡查端',
          status: reports.length > 0 ? 'running' : 'ready',
          availableAssets: reports.length,
          quality: reports.length > 0 ? 86 : 70,
          usage: '补充近地面证据，触发专家复核'
        }
      ],
      regions: remoteSensing.regions.map((region) => ({
        ...region,
        assetCount: recentAssets.filter((asset) => asset.regionId === region.id).length,
        activeAlertCount: alerts.filter((alert) => matchesRegion(alert.district, region.name)).length
      })),
      hazardPatches,
      reviewQueue,
      recentAssets,
      recentRuns: remoteSensing.recentRuns,
      reportDraft: buildReportDraft(hazardPatches, reviewQueue, latestAssetDate)
    };
  });
}

function listSites(fastify: FastifyInstance) {
  return fastify.db
    .prepare(
      `
        SELECT id, name, district, hazard_type AS hazardType, risk_level AS riskLevel,
          status, lat, lng, description
        FROM sites
        ORDER BY id
      `
    )
    .all() as Array<{
      id: number;
      name: string;
      district: string;
      hazardType: string;
      riskLevel: Severity;
      status: string;
      lat: number;
      lng: number;
      description: string;
    }>;
}

function listActiveAlerts(fastify: FastifyInstance) {
  return fastify.db
    .prepare(
      `
        SELECT
          a.id, a.title, a.severity, a.status, a.source, a.description,
          a.recommended_action AS recommendedAction, a.created_at AS createdAt,
          s.id AS siteId, s.name AS siteName, s.district, s.hazard_type AS hazardType,
          s.risk_level AS siteRiskLevel, s.lat, s.lng
        FROM alerts a
        JOIN sites s ON s.id = a.site_id
        WHERE a.status = 'active'
        ORDER BY a.created_at DESC
      `
    )
    .all() as Array<{
      id: number;
      title: string;
      severity: Severity;
      status: string;
      source: string;
      description: string;
      recommendedAction: string;
      createdAt: string;
      siteId: number;
      siteName: string;
      district: string;
      hazardType: string;
      siteRiskLevel: Severity;
      lat: number;
      lng: number;
    }>;
}

function listPendingReports(fastify: FastifyInstance) {
  return fastify.db
    .prepare(
      `
        SELECT
          r.id, r.title, r.report_type AS reportType, r.status, r.confidence_score AS confidenceScore,
          r.ai_risk_level AS aiRiskLevel, r.ai_risk_label AS aiRiskLabel,
          r.ai_summary AS aiSummary, r.ai_review_required AS aiReviewRequired,
          r.created_at AS createdAt, r.lat, r.lng,
          COALESCE(s.name, '未关联监测点') AS siteName,
          COALESCE(s.district, '待定位') AS district
        FROM crowd_reports r
        LEFT JOIN sites s ON s.id = r.site_id
        WHERE r.status IN ('pending', 'reviewing')
        ORDER BY r.created_at DESC
        LIMIT 8
      `
    )
    .all() as Array<{
      id: number;
      title: string;
      reportType: string;
      status: string;
      confidenceScore: number;
      aiRiskLevel?: Severity | null;
      aiRiskLabel?: string | null;
      aiSummary?: string | null;
      aiReviewRequired?: number;
      createdAt: string;
      lat: number;
      lng: number;
      siteName: string;
      district: string;
    }>;
}

function buildProductCoverage(products: any[], assets: any[]) {
  return products.map((product) => {
    const productAssets = assets.filter((asset) => asset.productId === product.id);
    const quality = productAssets.length > 0 ? Math.min(98, 72 + productAssets.length * 4) : 55;
    return {
      id: product.id,
      title: product.title,
      source: product.source,
      status: productAssets.length > 0 ? 'ready' : 'waiting',
      availableAssets: productAssets.length,
      quality,
      usage: product.id.includes('precipitation')
        ? '降雨触发条件监测'
        : '地表变化、云量和裸土异常快速核验'
    };
  });
}

function buildHazardPatches(sites: ReturnType<typeof listSites>, alerts: ReturnType<typeof listActiveAlerts>, reports: ReturnType<typeof listPendingReports>, assetCount: number) {
  return sites
    .map((site) => {
      const siteAlerts = alerts.filter((alert) => alert.siteId === site.id);
      const linkedReports = reports.filter((report) => report.siteName === site.name);
      const topAlert = siteAlerts.sort((left, right) => severityRank[right.severity] - severityRank[left.severity])[0];
      const riskLevel = topAlert?.severity ?? site.riskLevel;
      const confidence = Math.min(0.97, 0.58 + severityRank[riskLevel] * 0.08 + siteAlerts.length * 0.04 + linkedReports.length * 0.03 + Math.min(assetCount, 6) * 0.015);

      return {
        id: `patch-${site.id}`,
        name: `${site.name}疑似风险图斑`,
        district: site.district,
        hazardType: site.hazardType,
        riskLevel,
        riskLabel: severityLabels[riskLevel],
        confidence: Number(confidence.toFixed(2)),
        lat: site.lat,
        lng: site.lng,
        evidenceCount: siteAlerts.length + linkedReports.length + (assetCount > 0 ? 1 : 0),
        source: topAlert ? topAlert.source : '站点风险基线',
        reason: topAlert?.description ?? site.description,
        recommendedAction: topAlert?.recommendedAction ?? '保持遥感与现场巡查联动，纳入下一轮专家复核。'
      };
    })
    .filter((patch) => severityRank[patch.riskLevel] >= severityRank.medium)
    .sort((left, right) => severityRank[right.riskLevel] - severityRank[left.riskLevel] || right.confidence - left.confidence);
}

function buildReviewQueue(alerts: ReturnType<typeof listActiveAlerts>, reports: ReturnType<typeof listPendingReports>, patches: ReturnType<typeof buildHazardPatches>) {
  const alertItems = alerts.slice(0, 5).map((alert) => ({
    id: `alert-${alert.id}`,
    type: '预警复核',
    title: alert.title,
    siteName: alert.siteName,
    district: alert.district,
    riskLevel: alert.severity,
    priority: severityRank[alert.severity],
    status: 'pending',
    source: alert.source,
    createdAt: alert.createdAt,
    summary: alert.description
  }));

  const reportItems = reports.slice(0, 5).map((report) => {
    const riskLevel = report.aiRiskLevel ?? (report.confidenceScore >= 0.82 ? 'high' : 'medium');
    return {
      id: `report-${report.id}`,
      type: '群众图像初筛',
      title: report.title,
      siteName: report.siteName,
      district: report.district,
      riskLevel,
      priority: severityRank[riskLevel],
      status: report.status === 'reviewing' ? 'reviewing' : 'pending',
      source: report.aiRiskLabel ? `AI初筛：${report.aiRiskLabel}` : '公众端上报',
      createdAt: report.createdAt,
      summary: report.aiSummary ?? `${report.reportType}线索，可信度 ${Math.round(report.confidenceScore * 100)}%。`
    };
  });

  const patchItems = patches.slice(0, 3).map((patch) => ({
    id: patch.id,
    type: '遥感图斑复核',
    title: patch.name,
    siteName: patch.name.replace('疑似风险图斑', ''),
    district: patch.district,
    riskLevel: patch.riskLevel,
    priority: severityRank[patch.riskLevel],
    status: 'pending',
    source: patch.source,
    createdAt: null,
    summary: patch.reason
  }));

  return [...alertItems, ...reportItems, ...patchItems]
    .sort((left, right) => right.priority - left.priority)
    .slice(0, 10);
}

function buildReportDraft(patches: ReturnType<typeof buildHazardPatches>, reviewQueue: ReturnType<typeof buildReviewQueue>, targetDate: string | null) {
  const highRisk = patches.filter((patch) => severityRank[patch.riskLevel] >= severityRank.high);
  const leading = highRisk[0] ?? patches[0];
  return {
    title: `${targetDate ?? '今日'}地灾风险监测日报`,
    riskSummary: leading
      ? `${leading.district}${leading.name}处于${leading.riskLabel}，建议优先安排现场核查。`
      : '当前未形成高风险疑似图斑，维持常规遥感与群众线索巡检。',
    patchCount: patches.length,
    highRiskCount: highRisk.length,
    reviewCount: reviewQueue.length,
    recommendedActions: [
      highRisk.length > 0 ? '对高风险图斑开展专家复核和现场核查。' : '保持每日自动调度，等待新影像补位。',
      '将群众上报图片与遥感图斑做空间邻近比对。',
      '复核结论回流样本库，用于YOLO/分割模型持续微调。'
    ]
  };
}

function asOptionalString(value: unknown) {
  return typeof value === 'string' && value.trim() ? value : null;
}

function matchesRegion(district: string, regionName: string) {
  if (regionName.includes('东北')) {
    return ['江源', '浑江', '临江', '抚松', '靖宇', '长白'].some((name) => district.includes(name));
  }

  return regionName.includes(district) || district.includes(regionName);
}
