import fs from 'node:fs/promises';
import path from 'node:path';
import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { writeAuditLog } from '../audit';
import { runtimePaths } from '../config';
import { emitDomainEvent } from '../events';
import { badRequest } from '../errors';
import { authenticate } from '../guards';
import { createRateLimiter } from '../rate-limit';
import { analyzeSavedReportImageUpload } from '../services/hazard-analysis';
import type { HazardPrediction } from '../services/hazard-analysis';
import { readValidatedUpload, reportImagePolicy } from '../uploads';

const createReportSchema = z.object({
  siteId: z.coerce.number().optional(),
  reporterName: z.string().trim().min(2),
  phone: z.string().trim().min(6),
  title: z.string().trim().min(2),
  reportType: z.enum(['滑坡', '泥石流', '崩塌', '沉陷', '裂缝']),
  description: z.string().trim().min(4),
  imageUrl: z.string().optional(),
  lat: z.coerce.number(),
  lng: z.coerce.number(),
  confidenceScore: z.coerce.number().min(0).max(1).optional(),
  aiAnalysisRunId: z.coerce.number().int().positive().optional()
}).refine((report) => !report.imageUrl || report.aiAnalysisRunId, {
  message: '带图线索必须先完成图片初审。'
});

type RiskLevel = HazardPrediction['riskAssessment']['riskLevel'];
type ReportDraft = z.infer<typeof createReportSchema>;

type StoredAnalysisRun = {
  id: number;
  sourceUrl: string;
  provider: string;
  modelName: string;
  confidence: number;
  summary: string;
  resultJson: string;
};

type LinkedVisionReview = {
  id?: number;
  provider: string;
  modelName: string;
  confidence: number;
  summary: string;
  riskLevel: RiskLevel;
  riskLabel: string;
  recommendedAction: string;
  reviewRequired: boolean;
};

type LandslideWarningAssessment = {
  signs: string[];
  riskLevel: RiskLevel;
  confidence: number;
  summary: string;
  recommendedAction: string;
  reviewRequired: boolean;
};

type WarningSignRule = {
  label: string;
  weight: number;
  patterns: RegExp[];
};

const landslideWarningSignRules: WarningSignRule[] = [
  {
    label: '裂缝急剧扩展',
    weight: 0.32,
    patterns: [
      /弧形裂缝|后缘裂缝|后部裂缝|坡体后部.*裂缝/,
      /放射状裂缝|横向裂缝/,
      /裂缝.*(急剧|明显|不断).*(扩展|扩大|加宽|加长|变宽|变长)/,
      /(加宽|加长|变宽|变长).*(裂缝)/
    ]
  },
  {
    label: '地下水异常',
    weight: 0.24,
    patterns: [
      /(泉水|井水).*(突然|多年|干涸|复活|浑浊|水位|突变)/,
      /(地下水|水位).*(异常|突变|突然|明显)/,
      /(池塘|水塘|地表水).*(漏失|漏水|渗漏|明显下降|突然下降)/
    ]
  },
  {
    label: '坡脚土体隆起或挤压变形',
    weight: 0.3,
    patterns: [
      /(坡脚|前缘).*(隆起|上隆|凸起|鼓包|挤压|变形)/,
      /(土体|地面).*(上隆|鼓包|挤压变形)/
    ]
  },
  {
    label: '地下或岩土体异常声响',
    weight: 0.2,
    patterns: [
      /(地下|岩石|岩土体).*(声响|开裂声|拉扯|剪切|挤压|隆隆声|摩擦声)/,
      /(听到|发出).*(开裂|隆隆|摩擦|挤压).*(声|声音|声响)/
    ]
  },
  {
    label: '零星落石或小型崩塌',
    weight: 0.26,
    patterns: [
      /(碎石|落石|石块).*(掉落|滚落|坠落|滑落)/,
      /小型崩塌|局部崩塌|掉块/,
      /(岩体|土体|坡体).*(松弛|松动|垮塌|崩塌)/
    ]
  },
  {
    label: '树木房屋或动物异常',
    weight: 0.22,
    patterns: [
      /树木.*(倾斜|歪倒)|醉汉林|马刀树/,
      /(房屋|墙体|挡墙).*(开裂|裂缝|拉张)/,
      /(猪|狗|牛|鼠|动物).*(惊恐|不安|不入睡|乱跑|异常)/
    ]
  }
];

export async function reportRoutes(fastify: FastifyInstance) {
  const publicRateLimit = createRateLimiter({
    keyPrefix: 'public-report',
    windowMs: fastify.appConfig.rateLimitWindowMs,
    max: fastify.appConfig.publicRateLimitMax,
    message: '提交过于频繁，请稍后再试。'
  });

  fastify.get('/api/reports', { preHandler: authenticate }, async () => {
    const rows = fastify.db
      .prepare(`
        SELECT
          r.id,
          r.reporter_name AS reporterName,
          r.phone,
          r.title,
          r.report_type AS reportType,
          r.description,
          r.image_url AS imageUrl,
          r.lat,
          r.lng,
          r.confidence_score AS confidenceScore,
          r.ai_analysis_run_id AS aiAnalysisRunId,
          r.ai_provider AS aiProvider,
          r.ai_model_name AS aiModelName,
          r.ai_risk_level AS aiRiskLevel,
          r.ai_risk_label AS aiRiskLabel,
          r.ai_summary AS aiSummary,
          r.ai_recommended_action AS aiRecommendedAction,
          r.ai_review_required AS aiReviewRequired,
          r.status,
          r.created_at AS createdAt,
          s.name AS siteName
        FROM crowd_reports r
        LEFT JOIN sites s ON s.id = r.site_id
        ORDER BY r.created_at DESC
      `)
      .all();

    return {
      items: rows.map((row) => ({
        ...(row as Record<string, unknown>),
        aiReviewRequired: Boolean((row as { aiReviewRequired?: number | null }).aiReviewRequired)
      }))
    };
  });

  fastify.post('/api/reports', { preHandler: publicRateLimit }, async (request, reply) => {
    const parsed = createReportSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ message: '上报信息不完整。', requestId: request.id });
    }

    const now = new Date().toISOString().slice(0, 19).replace('T', ' ');
    const report = parsed.data;
    const visionReview = report.aiAnalysisRunId
      ? readLinkedVisionReview(fastify, report.aiAnalysisRunId, report.imageUrl)
      : null;
    const warningAssessment = assessLandslideWarningSigns(report);
    const reportReview = mergeReportReview(visionReview, warningAssessment);
    const confidence = reportReview?.confidence ?? report.confidenceScore ?? Number((0.55 + Math.random() * 0.35).toFixed(2));
    const result = fastify.db
      .prepare(`
        INSERT INTO crowd_reports (
          site_id, reporter_name, phone, title, report_type, description,
          image_url, lat, lng, confidence_score,
          ai_analysis_run_id, ai_provider, ai_model_name, ai_risk_level,
          ai_risk_label, ai_summary, ai_recommended_action, ai_review_required,
          status, created_at
        )
        VALUES (
          @siteId, @reporterName, @phone, @title, @reportType, @description,
          @imageUrl, @lat, @lng, @confidence,
          @aiAnalysisRunId, @aiProvider, @aiModelName, @aiRiskLevel,
          @aiRiskLabel, @aiSummary, @aiRecommendedAction, @aiReviewRequired,
          'pending', @createdAt
        )
      `)
      .run({
        siteId: report.siteId ?? null,
        reporterName: report.reporterName,
        phone: report.phone,
        title: report.title,
        reportType: report.reportType,
        description: report.description,
        imageUrl: report.imageUrl ?? null,
        lat: report.lat,
        lng: report.lng,
        confidence,
        aiAnalysisRunId: reportReview?.id ?? null,
        aiProvider: reportReview?.provider ?? null,
        aiModelName: reportReview?.modelName ?? null,
        aiRiskLevel: reportReview?.riskLevel ?? null,
        aiRiskLabel: reportReview?.riskLabel ?? null,
        aiSummary: reportReview?.summary ?? null,
        aiRecommendedAction: reportReview?.recommendedAction ?? null,
        aiReviewRequired: reportReview?.reviewRequired ? 1 : 0,
        createdAt: now
      });

    writeAuditLog(fastify, request, {
      action: 'report.submitted',
      entityType: 'crowd_report',
      entityId: String(result.lastInsertRowid),
      summary: `群众上报：${report.title}`,
      metadata: {
        reportType: report.reportType,
        siteId: report.siteId ?? null,
        confidence,
        aiAnalysisRunId: reportReview?.id ?? null,
        aiRiskLevel: reportReview?.riskLevel ?? null,
        aiReviewRequired: reportReview?.reviewRequired ?? false,
        warningSigns: warningAssessment?.signs ?? [],
        lat: report.lat,
        lng: report.lng
      }
    });
    emitDomainEvent(fastify, request, {
      eventType: 'report.submitted',
      aggregateType: 'crowd_report',
      aggregateId: String(result.lastInsertRowid),
      payload: {
        title: report.title,
        reportType: report.reportType,
        siteId: report.siteId ?? null,
        confidence,
        aiAnalysisRunId: reportReview?.id ?? null,
        aiRiskLevel: reportReview?.riskLevel ?? null,
        aiReviewRequired: reportReview?.reviewRequired ?? false,
        warningSigns: warningAssessment?.signs ?? [],
        lat: report.lat,
        lng: report.lng
      }
    });

    return reply.code(201).send({ id: result.lastInsertRowid });
  });

  fastify.post('/api/uploads', { preHandler: publicRateLimit }, async (request, reply) => {
    const file = await request.file();
    if (!file) {
      return reply.code(400).send({ message: '请选择要上传的图片。', requestId: request.id });
    }

    const upload = await readValidatedUpload(file, reportImagePolicy);
    const fileName = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}${upload.extension}`;
    const outputPath = path.join(runtimePaths.uploadsDir, fileName);
    const publicUrl = `/uploads/${fileName}`;
    await fs.writeFile(outputPath, upload.buffer);

    const analysis = await analyzeSavedReportImageUpload(fastify, 'landslide', {
      originalName: upload.originalName,
      storedName: fileName,
      absolutePath: outputPath,
      publicUrl,
      mimeType: upload.mimeType
    });

    writeAuditLog(fastify, request, {
      action: 'upload.report_image_saved',
      entityType: 'upload',
      entityId: fileName,
      summary: '群众上报图片上传并完成图片预警初审。',
      metadata: {
        originalName: upload.originalName,
        mimeType: upload.mimeType,
        publicUrl,
        aiAnalysisRunId: analysis.id,
        aiProvider: analysis.metadata.visionProvider,
        aiRiskLevel: analysis.riskAssessment.riskLevel,
        aiReviewRequired: analysis.riskAssessment.reviewRequired
      }
    });
    emitDomainEvent(fastify, request, {
      eventType: 'report.image_reviewed',
      aggregateType: 'analysis_run',
      aggregateId: analysis.id ?? '',
      payload: {
        sourceUrl: publicUrl,
        provider: analysis.metadata.visionProvider,
        modelName: analysis.modelName,
        confidence: analysis.confidence,
        riskLevel: analysis.riskAssessment.riskLevel,
        reviewRequired: analysis.riskAssessment.reviewRequired
      }
    });

    return reply.code(201).send({
      url: publicUrl,
      aiAnalysisRunId: analysis.id,
      analysis
    });
  });
}

function readLinkedVisionReview(
  fastify: FastifyInstance,
  analysisRunId: number,
  imageUrl?: string | null
): LinkedVisionReview {
  const row = fastify.db
    .prepare(`
      SELECT
        id,
        source_url AS sourceUrl,
        provider,
        model_name AS modelName,
        confidence_score AS confidence,
        summary,
        result_json AS resultJson
      FROM analysis_runs
      WHERE id = ?
    `)
    .get(analysisRunId) as StoredAnalysisRun | undefined;

  if (!row) {
    throw badRequest('图片初审记录不存在，请重新上传照片。');
  }

  if (imageUrl && row.sourceUrl !== imageUrl) {
    throw badRequest('图片地址与初审记录不匹配，请重新上传照片。');
  }

  let prediction: HazardPrediction;
  try {
    prediction = JSON.parse(row.resultJson) as HazardPrediction;
  } catch {
    throw badRequest('图片初审结果无法解析，请重新上传照片。');
  }

  if (!isReportImageReview(row, prediction)) {
    throw badRequest('群众照片必须先通过图片初审后再提交。');
  }

  return {
    id: row.id,
    provider: reviewProviderName(row, prediction),
    modelName: row.modelName,
    confidence: row.confidence,
    summary: row.summary,
    riskLevel: prediction.riskAssessment.riskLevel,
    riskLabel: prediction.riskAssessment.label,
    recommendedAction: prediction.riskAssessment.recommendedAction,
    reviewRequired: prediction.riskAssessment.reviewRequired
  };
}

function isReportImageReview(row: StoredAnalysisRun, prediction: HazardPrediction) {
  if (row.provider === 'vision-llm') {
    return prediction.metadata.visionProvider === 'doubao' || prediction.metadata.visionProvider === 'openai-compatible';
  }

  return row.provider === 'external-http' || row.provider === 'mock';
}

function reviewProviderName(row: StoredAnalysisRun, prediction: HazardPrediction) {
  if (row.provider === 'vision-llm') {
    const provider = prediction.metadata.visionProvider;
    return typeof provider === 'string' && provider ? provider : row.provider;
  }

  return row.provider;
}

function assessLandslideWarningSigns(report: ReportDraft): LandslideWarningAssessment | null {
  const text = `${report.title} ${report.description}`.replace(/\s+/g, '');
  const matchedRules = landslideWarningSignRules.filter((rule) =>
    rule.patterns.some((pattern) => pattern.test(text))
  );

  if (!matchedRules.length) {
    return null;
  }

  const signs = [...new Set(matchedRules.map((rule) => rule.label))];
  const score = clamp(
    0.36 + matchedRules.reduce((total, rule) => total + rule.weight, 0) + Math.max(0, signs.length - 1) * 0.08,
    0.45,
    0.95
  );
  const riskLevel = riskLevelFromScore(score);
  const confidence = clamp(0.62 + signs.length * 0.08, 0.68, 0.92);

  return {
    signs,
    riskLevel,
    confidence,
    summary: `现场描述命中滑坡预警前兆：${signs.join('、')}。`,
    recommendedAction: defaultWarningAction(riskLevel),
    reviewRequired: true
  };
}

function mergeReportReview(
  visionReview: LinkedVisionReview | null,
  warningAssessment: LandslideWarningAssessment | null
): LinkedVisionReview | null {
  if (!visionReview && !warningAssessment) {
    return null;
  }

  if (!warningAssessment) {
    return visionReview;
  }

  if (!visionReview) {
    return {
      provider: 'text-warning-rules',
      modelName: 'LandslideWarningSigns',
      confidence: warningAssessment.confidence,
      summary: warningAssessment.summary,
      riskLevel: warningAssessment.riskLevel,
      riskLabel: riskLevelLabel(warningAssessment.riskLevel),
      recommendedAction: warningAssessment.recommendedAction,
      reviewRequired: warningAssessment.reviewRequired
    };
  }

  const riskLevel = higherRiskLevel(visionReview.riskLevel, warningAssessment.riskLevel);
  const warningTakesPriority = riskRank(warningAssessment.riskLevel) >= riskRank(visionReview.riskLevel);
  const warningSummary = `现场描述命中滑坡预警前兆：${warningAssessment.signs.join('、')}。`;

  return {
    ...visionReview,
    provider: `${visionReview.provider}+text-warning-rules`,
    confidence: Math.max(visionReview.confidence, warningAssessment.confidence),
    summary: warningTakesPriority ? `${warningSummary}${visionReview.summary ? ` 图片初审：${visionReview.summary}` : ''}` : `${visionReview.summary} ${warningSummary}`,
    riskLevel,
    riskLabel: riskLevelLabel(riskLevel),
    recommendedAction: warningTakesPriority ? warningAssessment.recommendedAction : visionReview.recommendedAction,
    reviewRequired: true
  };
}

function clamp(value: number, min: number, max: number) {
  if (!Number.isFinite(value)) {
    return min;
  }

  return Math.max(min, Math.min(max, value));
}

function riskLevelFromScore(score: number): RiskLevel {
  if (score >= 0.85) return 'critical';
  if (score >= 0.68) return 'high';
  if (score >= 0.4) return 'medium';
  return 'low';
}

function riskRank(level: RiskLevel) {
  const ranks: Record<RiskLevel, number> = {
    low: 0,
    medium: 1,
    high: 2,
    critical: 3
  };
  return ranks[level];
}

function higherRiskLevel(left: RiskLevel, right: RiskLevel) {
  return riskRank(right) > riskRank(left) ? right : left;
}

function riskLevelLabel(level: RiskLevel) {
  const labels: Record<RiskLevel, string> = {
    low: '低风险',
    medium: '中风险',
    high: '高风险',
    critical: '极高风险'
  };
  return labels[level];
}

function defaultWarningAction(level: RiskLevel) {
  if (level === 'critical') {
    return '立即上报主管部门，组织现场核查、临时避险和警戒管控，必要时启动应急响应。';
  }
  if (level === 'high') {
    return '尽快安排专业人员现场复核，重点核查裂缝变化、地下水、坡脚变形和落石情况。';
  }
  return '纳入重点巡查清单，补充近景照片、位置、发生时间和变化速度后复核。';
}
