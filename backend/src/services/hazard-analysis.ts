import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import type { MultipartFile } from '@fastify/multipart';
import type { FastifyInstance } from 'fastify';
import { runtimePaths } from '../config';
import { badRequest, upstreamFailure, upstreamTimeout } from '../errors';
import { analysisImagePolicy, readValidatedUpload, reportImagePolicy } from '../uploads';

type TaskType = 'landslide';
type ProviderType = 'mock' | 'external-http' | 'vision-llm';

type Point = {
  x: number;
  y: number;
};

type SegmentationRegion = {
  label: string;
  score: number;
  polygon: Point[];
};

type ClassificationResult = {
  hasHazard: boolean;
  label: string;
  confidence: number;
};

type RiskLevel = 'low' | 'medium' | 'high' | 'critical';

type RiskAssessment = {
  riskLevel: RiskLevel;
  riskScore: number;
  label: string;
  evidence: string[];
  recommendedAction: string;
  reviewRequired: boolean;
  basis: string;
};

type AnalysisMetadataValue = string | number | boolean | null;

export type HazardPrediction = {
  id?: number;
  taskType: TaskType;
  provider: ProviderType;
  modelName: string;
  sourceName: string;
  sourceUrl: string;
  createdAt: string;
  summary: string;
  confidence: number;
  riskAssessment: RiskAssessment;
  classification?: ClassificationResult;
  segmentation: {
    regions: SegmentationRegion[];
  };
  metadata: Record<string, AnalysisMetadataValue>;
};

export type SavedUpload = {
  originalName: string;
  storedName: string;
  absolutePath: string;
  publicUrl: string;
  mimeType: string;
};

export async function analyzeUpload(
  fastify: FastifyInstance,
  taskType: TaskType,
  file: MultipartFile
) {
  const savedUpload = await saveUpload(file);
  const prediction = fastify.appConfig.aiInferenceBaseUrl
    ? await runExternalPrediction(fastify, taskType, savedUpload)
    : await runMockPrediction(taskType, savedUpload);

  return persistPrediction(fastify, prediction);
}

export async function analyzeMobileImageUpload(
  fastify: FastifyInstance,
  taskType: TaskType,
  file: MultipartFile
) {
  const savedUpload = await saveUpload(file, reportImagePolicy);
  const prediction = await runVisionPrediction(fastify, taskType, savedUpload);
  return persistPrediction(fastify, prediction);
}

export async function analyzeSavedReportImageUpload(
  fastify: FastifyInstance,
  taskType: TaskType,
  savedUpload: SavedUpload
) {
  if (fastify.appConfig.visionProvider !== 'disabled' && fastify.appConfig.visionProvider !== 'deepseek') {
    const prediction = await runVisionPrediction(fastify, taskType, savedUpload);
    return persistPrediction(fastify, prediction);
  }

  const prediction = fastify.appConfig.aiInferenceBaseUrl
    ? await runExternalPrediction(fastify, taskType, savedUpload)
    : await runMockPrediction(taskType, savedUpload);

  return persistPrediction(fastify, prediction);
}

export function listAnalysisRuns(fastify: FastifyInstance, limit = 10) {
  const rows = fastify.db
    .prepare(
      `
        SELECT
          id,
          task_type AS taskType,
          source_name AS sourceName,
          source_url AS sourceUrl,
          provider,
          model_name AS modelName,
          confidence_score AS confidence,
          summary,
          created_at AS createdAt
        FROM analysis_runs
        WHERE task_type = 'landslide'
        ORDER BY created_at DESC, id DESC
        LIMIT ?
      `
    )
    .all(limit);

  return rows;
}

async function saveUpload(file: MultipartFile, policy = analysisImagePolicy): Promise<SavedUpload> {
  const upload = await readValidatedUpload(file, policy);
  const storedName = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}${upload.extension}`;
  const absolutePath = path.join(runtimePaths.analysisUploadsDir, storedName);
  await fs.writeFile(absolutePath, upload.buffer);

  return {
    originalName: upload.originalName,
    storedName,
    absolutePath,
    publicUrl: `/uploads/analysis/${storedName}`,
    mimeType: upload.mimeType
  };
}

async function runExternalPrediction(
  fastify: FastifyInstance,
  taskType: TaskType,
  savedUpload: SavedUpload
): Promise<HazardPrediction> {
  const fileBuffer = await fs.readFile(savedUpload.absolutePath);
  const formData = new FormData();
  formData.append(
    'file',
    new Blob([fileBuffer], { type: savedUpload.mimeType }),
    savedUpload.originalName
  );

  const endpointPath = fastify.appConfig.aiLandslideEndpoint;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), fastify.appConfig.aiInferenceTimeoutMs);
  let response: Response;

  try {
    response = await fetch(new URL(endpointPath, fastify.appConfig.aiInferenceBaseUrl).toString(), {
      method: 'POST',
      body: formData,
      signal: controller.signal
    });
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw upstreamTimeout('外部推理服务响应超时，请稍后重试。');
    }
    throw upstreamFailure('外部推理服务不可用，请检查模型服务状态。');
  } finally {
    clearTimeout(timeout);
  }

  if (!response.ok) {
    throw upstreamFailure(`外部推理服务调用失败: ${response.status}`);
  }

  const payload = await parseExternalPredictionPayload(response);
  return normalizeExternalPrediction(taskType, savedUpload, payload);
}

async function parseExternalPredictionPayload(response: Response) {
  let payload: unknown;

  try {
    payload = await response.json();
  } catch {
    throw upstreamFailure('外部推理服务返回格式不正确。');
  }

  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw upstreamFailure('外部推理服务返回格式不正确。');
  }

  return payload as Record<string, unknown>;
}

async function runVisionPrediction(
  fastify: FastifyInstance,
  taskType: TaskType,
  savedUpload: SavedUpload
): Promise<HazardPrediction> {
  if (fastify.appConfig.visionProvider === 'disabled') {
    throw badRequest('视觉大模型未启用，请先配置 VISION_PROVIDER、VISION_API_KEY 和 VISION_MODEL。');
  }

  if (fastify.appConfig.visionProvider === 'deepseek') {
    throw badRequest('DeepSeek 官方 API 当前未提供稳定图片输入能力，请改用豆包或其他 OpenAI-compatible 视觉模型。');
  }

  if (!fastify.appConfig.visionApiKey || !fastify.appConfig.visionBaseUrl || !fastify.appConfig.visionModel) {
    throw upstreamFailure('视觉大模型配置不完整，请检查 VISION_API_KEY、VISION_BASE_URL 和 VISION_MODEL。');
  }

  const fileBuffer = await fs.readFile(savedUpload.absolutePath);
  const dataUrl = `data:${savedUpload.mimeType};base64,${fileBuffer.toString('base64')}`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), fastify.appConfig.visionTimeoutMs);
  let response: Response;

  try {
    response = await fetch(buildProviderUrl(fastify.appConfig.visionBaseUrl, fastify.appConfig.visionChatEndpoint), {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${fastify.appConfig.visionApiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: fastify.appConfig.visionModel,
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'image_url',
                image_url: {
                  url: dataUrl
                }
              },
              {
                type: 'text',
                text: buildVisionPrompt()
              }
            ]
          }
        ],
        max_tokens: 700,
        temperature: 0.1
      }),
      signal: controller.signal
    });
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw upstreamTimeout('视觉大模型响应超时，请稍后重试。');
    }
    throw upstreamFailure('视觉大模型服务不可用，请检查供应商配置和网络状态。');
  } finally {
    clearTimeout(timeout);
  }

  if (!response.ok) {
    throw upstreamFailure(`视觉大模型调用失败: ${response.status}`);
  }

  const payload = await parseExternalPredictionPayload(response);
  const content = extractChatCompletionContent(payload);
  const visionResult = parseVisionResult(content);
  return normalizeVisionPrediction(fastify, taskType, savedUpload, visionResult);
}

function buildProviderUrl(baseUrl: string, endpoint: string) {
  if (/\/chat\/completions\/?$/i.test(baseUrl)) {
    return baseUrl;
  }

  const normalizedBase = baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`;
  const normalizedEndpoint = endpoint.replace(/^\/+/, '');
  return new URL(normalizedEndpoint, normalizedBase).toString();
}

function buildVisionPrompt() {
  return [
    '你是地质灾害移动巡查图片初审助手。请只根据图片可见内容判断是否存在滑坡、崩塌、泥石流、坡体失稳或明显灾害风险迹象。',
    '重点识别滑坡预警前兆：坡体后部弧形裂缝，中部或前部放射状、横向裂缝，裂缝明显加宽加长；坡脚土体上隆、鼓包、挤压变形；坡体四周松弛、零星碎石掉落、小型崩塌；树木倾斜、醉汉林、马刀树，房屋或挡墙裂缝拉张。',
    '如果图片能清楚看到渗水、浑浊水流、水位突变痕迹、池塘漏失或新鲜湿痕，也可作为地下水异常线索；但不要仅凭普通水体、阴影或植被推断地下水异常。',
    '微小声响、动物惊恐不安等属于现场描述前兆，静态图片通常无法判断；除非图片中有明确可见证据，否则不要把它们当作视觉证据。',
    '请输出严格 JSON，不要输出 Markdown、代码块或解释性前后缀。',
    'JSON schema:',
    '{',
    '  "hasHazard": boolean,',
    '  "confidence": number,',
    '  "riskLevel": "low" | "medium" | "high" | "critical",',
    '  "riskScore": number,',
    '  "hazardType": "landslide" | "mudslide" | "rockfall" | "collapse" | "unknown" | "none",',
    '  "summary": string,',
    '  "regions": [{"label": string, "score": number, "polygon": [{"x": number, "y": number}]}],',
    '  "warningSigns": string[],',
    '  "observations": string[],',
    '  "evidence": string[],',
    '  "recommendedAction": string',
    '}',
    'riskScore 使用 0 到 1 的小数，riskLevel 根据图像可见风险分为 low、medium、high、critical。',
    '坐标使用 0 到 1 的相对比例，x 从左到右，y 从上到下；如果无法可靠定位区域，regions 返回空数组。',
    'warningSigns 只填写图片中可见且与滑坡前兆相关的短语，例如“坡体后缘弧形裂缝”“坡脚隆起”“树木倾斜”“零星落石”。',
    '不要把普通山体、道路、植被、水面或阴影误判为灾害；证据不足时 hasHazard=false，并说明需要人工复核。'
  ].join('\n');
}

function extractChatCompletionContent(payload: Record<string, unknown>) {
  const choices = payload.choices;
  if (!Array.isArray(choices)) {
    throw upstreamFailure('视觉大模型返回格式不正确。');
  }

  const firstChoice = choices[0];
  if (!firstChoice || typeof firstChoice !== 'object') {
    throw upstreamFailure('视觉大模型返回格式不正确。');
  }

  const message = (firstChoice as Record<string, unknown>).message;
  if (!message || typeof message !== 'object') {
    throw upstreamFailure('视觉大模型返回格式不正确。');
  }

  const content = (message as Record<string, unknown>).content;
  if (typeof content === 'string') {
    return content;
  }

  if (Array.isArray(content)) {
    const text = content
      .map((part) => {
        if (!part || typeof part !== 'object') {
          return '';
        }
        const partRecord = part as Record<string, unknown>;
        return typeof partRecord.text === 'string' ? partRecord.text : '';
      })
      .join('\n')
      .trim();
    if (text) {
      return text;
    }
  }

  throw upstreamFailure('视觉大模型未返回可解析文本。');
}

function parseVisionResult(content: string) {
  const jsonText = extractJsonObject(content);
  let parsed: unknown;

  try {
    parsed = JSON.parse(jsonText);
  } catch {
    throw upstreamFailure('视觉大模型返回的 JSON 无法解析。');
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw upstreamFailure('视觉大模型返回格式不正确。');
  }

  return parsed as Record<string, unknown>;
}

function extractJsonObject(content: string) {
  const trimmed = content.trim();
  const fencedMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fencedMatch?.[1]) {
    return fencedMatch[1].trim();
  }

  const start = trimmed.indexOf('{');
  const end = trimmed.lastIndexOf('}');
  if (start >= 0 && end > start) {
    return trimmed.slice(start, end + 1);
  }

  return trimmed;
}

function normalizeVisionPrediction(
  fastify: FastifyInstance,
  taskType: TaskType,
  savedUpload: SavedUpload,
  payload: Record<string, unknown>
): HazardPrediction {
  const hasHazard = Boolean(payload.hasHazard ?? payload.has_landslide ?? payload.hasLandslide ?? false);
  const confidence = clamp(Number(payload.confidence ?? payload.score ?? (hasHazard ? 0.75 : 0.35)), 0, 1);
  const hazardType = toNonEmptyString(payload.hazardType) ?? (hasHazard ? 'landslide' : 'none');
  const regions = normalizeVisionRegions(payload.regions, hasHazard ? '疑似地灾区域' : '地灾区域');
  const warningSigns = normalizeStringList(payload.warningSigns ?? payload.warning_signs).slice(0, 6);
  const observations = normalizeStringList(payload.observations).slice(0, 6);
  const evidence = normalizeStringList(payload.evidence).slice(0, 6);
  const recommendedAction = toNonEmptyString(payload.recommendedAction);
  const providerName = fastify.appConfig.visionProvider === 'doubao' ? 'doubao' : 'openai-compatible';
  const riskAssessment = buildRiskAssessment({
    hasHazard,
    confidence,
    hazardType,
    regions,
    observations,
    evidence: [...warningSigns.map((item) => `滑坡前兆：${item}`), ...evidence],
    recommendedAction,
    providedRiskLevel: normalizeRiskLevel(payload.riskLevel ?? payload.risk_level),
    providedRiskScore: normalizeRiskScore(payload.riskScore ?? payload.risk_score)
  });

  return {
    taskType,
    provider: 'vision-llm',
    modelName: fastify.appConfig.visionModel ?? 'vision-model',
    sourceName: savedUpload.originalName,
    sourceUrl: savedUpload.publicUrl,
    createdAt: toSqlTimestamp(new Date()),
    summary:
      toNonEmptyString(payload.summary) ??
      (hasHazard ? '视觉大模型判定图片存在疑似地质灾害迹象。' : '视觉大模型未发现明确地质灾害迹象。'),
    confidence,
    riskAssessment,
    classification: {
      hasHazard,
      label: hasHazard ? hazardType : 'no-hazard',
      confidence
    },
    segmentation: {
      regions
    },
    metadata: {
      inputMode: 'mobile-photo',
      visionProvider: providerName,
      hazardType,
      warningSigns: warningSigns.join('；') || null,
      reviewSuggested: riskAssessment.reviewRequired,
      observations: observations.join('；') || null,
      recommendedAction: riskAssessment.recommendedAction
    }
  };
}

function normalizeVisionRegions(value: unknown, fallbackLabel: string): SegmentationRegion[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .filter((region): region is Record<string, unknown> => Boolean(region) && typeof region === 'object')
    .map((region) => {
      const polygon = normalizePolygon(region.polygon);
      return {
        label: toNonEmptyString(region.label) ?? fallbackLabel,
        score: clamp(Number(region.score ?? 0.75), 0, 1),
        polygon
      };
    })
    .filter((region) => region.polygon.length >= 3)
    .slice(0, 5);
}

function normalizeStringList(value: unknown) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((item) => (typeof item === 'string' ? item.trim() : ''))
    .filter(Boolean);
}

async function runMockPrediction(
  taskType: TaskType,
  savedUpload: SavedUpload
): Promise<HazardPrediction> {
  const fileBuffer = await fs.readFile(savedUpload.absolutePath);
  const seed = createSeed(fileBuffer, savedUpload.originalName);
  const createdAt = toSqlTimestamp(new Date());
  const hasHazard = seed > 0.34;
  const confidence = clamp(hasHazard ? 0.71 + seed * 0.22 : 0.67 + (0.34 - seed) * 0.45, 0.51, 0.97);
  const regions = hasHazard ? [buildPolygonRegion(seed, '疑似滑坡区域', confidence)] : [];
  const observations = hasHazard
    ? ['存在疑似裸露坡面或坡体纹理异常', '图像中出现可疑边坡失稳区域']
    : ['未检出明确滑坡、崩塌或泥石流迹象'];
  const riskAssessment = buildRiskAssessment({
    hasHazard,
    confidence,
    hazardType: hasHazard ? 'landslide' : 'none',
    regions,
    observations
  });

  return {
    taskType,
    provider: 'mock',
    modelName: 'LandslideVision',
    sourceName: savedUpload.originalName,
    sourceUrl: savedUpload.publicUrl,
    createdAt,
    summary: hasHazard
      ? '检测到疑似滑坡或坡体失稳纹理，建议结合现场巡查进一步复核。'
      : '当前图片中未见明显滑坡形变迹象，可作为常规巡查样本留存。',
    confidence,
    riskAssessment,
    classification: {
      hasHazard,
      label: hasHazard ? 'landslide' : 'no-landslide',
      confidence
    },
    segmentation: {
      regions
    },
    metadata: {
      inputMode: 'ground-or-uav-photo',
      reviewSuggested: riskAssessment.reviewRequired,
      segmentationStageTriggered: hasHazard,
      observations: observations.join('；'),
      recommendedAction: riskAssessment.recommendedAction
    }
  };
}

function normalizeExternalPrediction(
  taskType: TaskType,
  savedUpload: SavedUpload,
  payload: Record<string, unknown>
): HazardPrediction {
  const createdAt = toSqlTimestamp(new Date());
  const hasHazard = Boolean(payload.has_landslide ?? payload.hasLandslide ?? false);
  const confidence = clamp(Number(payload.confidence ?? payload.score ?? (hasHazard ? 0.88 : 0.22)), 0, 1);
  const regions = normalizeRegions(
    payload.segmentation,
    payload.mask,
    hasHazard ? '疑似滑坡区域' : '滑坡区域'
  );
  const observations = normalizeStringList(payload.observations).slice(0, 6);
  const riskAssessment = buildRiskAssessment({
    hasHazard,
    confidence,
    hazardType: toNonEmptyString(payload.hazardType) ?? (hasHazard ? 'landslide' : 'none'),
    regions,
    observations,
    evidence: normalizeStringList(payload.evidence).slice(0, 6),
    recommendedAction: toNonEmptyString(payload.recommendedAction),
    providedRiskLevel: normalizeRiskLevel(payload.riskLevel ?? payload.risk_level),
    providedRiskScore: normalizeRiskScore(payload.riskScore ?? payload.risk_score)
  });

  return {
    taskType,
    provider: 'external-http',
    modelName: toNonEmptyString(payload.modelName) ?? 'LandslideVision',
    sourceName: savedUpload.originalName,
    sourceUrl: savedUpload.publicUrl,
    createdAt,
    summary:
      toNonEmptyString(payload.summary) ??
      (hasHazard ? '外部模型判定为疑似滑坡样本。' : '外部模型未检出明显滑坡迹象。'),
    confidence,
    riskAssessment,
    classification: {
      hasHazard,
      label: hasHazard ? 'landslide' : 'no-landslide',
      confidence
    },
    segmentation: {
      regions
    },
    metadata: {
      inputMode: 'ground-or-uav-photo',
      rawMaskIncluded: Array.isArray(payload.mask),
      reviewSuggested: riskAssessment.reviewRequired,
      observations: observations.join('；') || null,
      recommendedAction: riskAssessment.recommendedAction
    }
  };
}

function normalizeRegions(
  segmentationValue: unknown,
  maskValue: unknown,
  fallbackLabel: string
): SegmentationRegion[] {
  const rawRegions = extractSegmentationRegions(segmentationValue);
  if (rawRegions) {
    return rawRegions.map((region) => ({
      label: toNonEmptyString(region.label) ?? fallbackLabel,
      score: clamp(Number(region.score ?? 0.8), 0, 1),
      polygon: normalizePolygon(region.polygon)
    }));
  }

  const maskRegion = maskToRegion(maskValue, fallbackLabel);
  return maskRegion ? [maskRegion] : [];
}

function extractSegmentationRegions(value: unknown): Array<Record<string, unknown>> | null {
  if (isRegionArray(value)) {
    return value;
  }

  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const regions = (value as Record<string, unknown>).regions;
    if (isRegionArray(regions)) {
      return regions;
    }
  }

  return null;
}

function isRegionArray(value: unknown): value is Array<Record<string, unknown>> {
  return Array.isArray(value) && value.every((item) => item && typeof item === 'object');
}

function normalizePolygon(value: unknown): Point[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((point) => {
      if (!point || typeof point !== 'object') {
        return null;
      }

      const x = clamp(Number((point as Record<string, unknown>).x ?? 0), 0, 1);
      const y = clamp(Number((point as Record<string, unknown>).y ?? 0), 0, 1);
      return { x, y };
    })
    .filter((point): point is Point => point !== null);
}

function maskToRegion(maskValue: unknown, label: string): SegmentationRegion | null {
  const mask = parseMask(maskValue);
  if (!mask.length || !mask[0]?.length) {
    return null;
  }

  let minRow = Number.POSITIVE_INFINITY;
  let minCol = Number.POSITIVE_INFINITY;
  let maxRow = -1;
  let maxCol = -1;
  let positives = 0;

  for (let row = 0; row < mask.length; row += 1) {
    for (let col = 0; col < mask[row].length; col += 1) {
      if (mask[row][col] <= 0) {
        continue;
      }

      positives += 1;
      minRow = Math.min(minRow, row);
      minCol = Math.min(minCol, col);
      maxRow = Math.max(maxRow, row);
      maxCol = Math.max(maxCol, col);
    }
  }

  if (!positives || maxRow < 0 || maxCol < 0) {
    return null;
  }

  const height = mask.length;
  const width = mask[0].length;
  const polygon = [
    { x: minCol / width, y: minRow / height },
    { x: (maxCol + 1) / width, y: minRow / height },
    { x: (maxCol + 1) / width, y: (maxRow + 1) / height },
    { x: minCol / width, y: (maxRow + 1) / height }
  ];

  return {
    label,
    score: clamp(positives / (width * height), 0.55, 0.98),
    polygon
  };
}

function parseMask(maskValue: unknown): number[][] {
  if (!Array.isArray(maskValue)) {
    return [];
  }

  return maskValue
    .filter((row): row is unknown[] => Array.isArray(row))
    .map((row) =>
      row.map((value) => {
        const numeric = Number(value);
        return Number.isFinite(numeric) ? numeric : 0;
      })
    );
}

function buildPolygonRegion(seed: number, label: string, score: number): SegmentationRegion {
  const centerX = 0.32 + seed * 0.36;
  const centerY = 0.28 + ((seed * 1.7) % 1) * 0.34;
  const halfWidth = 0.12 + ((seed * 2.3) % 1) * 0.1;
  const halfHeight = 0.1 + ((seed * 3.1) % 1) * 0.09;

  return {
    label,
    score: clamp(score, 0, 1),
    polygon: [
      { x: clamp(centerX - halfWidth, 0.04, 0.92), y: clamp(centerY - halfHeight * 0.75, 0.04, 0.92) },
      { x: clamp(centerX + halfWidth * 0.82, 0.04, 0.96), y: clamp(centerY - halfHeight, 0.04, 0.92) },
      { x: clamp(centerX + halfWidth, 0.04, 0.96), y: clamp(centerY + halfHeight * 0.24, 0.04, 0.96) },
      { x: clamp(centerX + halfWidth * 0.36, 0.04, 0.96), y: clamp(centerY + halfHeight, 0.04, 0.96) },
      { x: clamp(centerX - halfWidth * 0.74, 0.04, 0.96), y: clamp(centerY + halfHeight * 0.88, 0.04, 0.96) },
      { x: clamp(centerX - halfWidth, 0.04, 0.96), y: clamp(centerY, 0.04, 0.96) }
    ]
  };
}

function buildRiskAssessment(input: {
  hasHazard: boolean;
  confidence: number;
  hazardType: string;
  regions: SegmentationRegion[];
  observations?: string[];
  evidence?: string[];
  recommendedAction?: string | null;
  providedRiskLevel?: RiskLevel | null;
  providedRiskScore?: number | null;
}): RiskAssessment {
  const visualEvidence = [
    ...(input.evidence ?? []),
    ...(input.observations ?? []),
    ...input.regions.map((region) => `${region.label}，区域置信度 ${Math.round(region.score * 100)}%`)
  ].filter(Boolean).slice(0, 6);

  if (!visualEvidence.length) {
    visualEvidence.push(input.hasHazard ? '模型检出疑似地灾视觉特征' : '图像中未检出明确地灾视觉特征');
  }

  const bestRegionScore = input.regions.reduce((max, region) => Math.max(max, region.score), 0);
  const computedScore = input.hasHazard
    ? clamp(0.42 + input.confidence * 0.38 + bestRegionScore * 0.12 + Math.min(visualEvidence.length, 3) * 0.03, 0, 1)
    : clamp((1 - input.confidence) * 0.34 + (input.confidence < 0.65 ? 0.12 : 0), 0, 0.45);
  const riskScore = clamp(input.providedRiskScore ?? computedScore, 0, 1);
  const riskLevel = input.providedRiskLevel ?? riskLevelFromScore(riskScore);
  const label = riskLevelLabel(riskLevel);
  const recommendedAction = input.recommendedAction ?? defaultRiskAction(riskLevel, input.hasHazard);

  return {
    riskLevel,
    riskScore,
    label,
    evidence: visualEvidence,
    recommendedAction,
    reviewRequired: riskLevel !== 'low' || input.confidence < 0.72,
    basis: input.hasHazard
      ? `基于图像中的${hazardTypeLabel(input.hazardType)}视觉特征、模型置信度和疑似区域位置进行初筛研判。`
      : '基于图像可见内容未检出明确地灾迹象；若现场处于雨后、陡坡或历史隐患点附近，仍建议结合多源数据复核。'
  };
}

function normalizeRiskLevel(value: unknown): RiskLevel | null {
  if (typeof value !== 'string') {
    return null;
  }

  const normalized = value.trim().toLowerCase();
  if (normalized === 'low' || normalized === 'medium' || normalized === 'high' || normalized === 'critical') {
    return normalized;
  }

  return null;
}

function normalizeRiskScore(value: unknown): number | null {
  const score = Number(value);
  if (!Number.isFinite(score)) {
    return null;
  }

  return clamp(score > 1 ? score / 100 : score, 0, 1);
}

function riskLevelFromScore(score: number): RiskLevel {
  if (score >= 0.85) {
    return 'critical';
  }
  if (score >= 0.68) {
    return 'high';
  }
  if (score >= 0.4) {
    return 'medium';
  }
  return 'low';
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

function defaultRiskAction(level: RiskLevel, hasHazard: boolean) {
  if (level === 'critical') {
    return '立即上报主管部门，组织现场核查和临时避险管控，必要时启动临时响应流程。';
  }
  if (level === 'high') {
    return '尽快安排专业人员现场复核，叠加降雨、坡度和历史隐患点数据，持续跟踪变化。';
  }
  if (level === 'medium') {
    return hasHazard
      ? '纳入重点巡查清单，补充近景照片、位置和降雨信息后复核。'
      : '证据不足但存在不确定性，建议结合现场位置、降雨和历史隐患点进行人工复核。';
  }
  return '暂未发现明显风险，建议作为常规巡查样本留存，并在强降雨后复查。';
}

function hazardTypeLabel(value: string) {
  const labels: Record<string, string> = {
    landslide: '滑坡',
    mudslide: '泥石流',
    rockfall: '崩塌落石',
    collapse: '崩塌',
    unknown: '疑似地质灾害',
    none: '未见明显地灾'
  };
  return labels[value] ?? '疑似地质灾害';
}

function persistPrediction(fastify: FastifyInstance, prediction: HazardPrediction): HazardPrediction {
  const result = fastify.db
    .prepare(
      `
        INSERT INTO analysis_runs (
          task_type, source_name, source_url, provider, model_name,
          confidence_score, summary, result_json, created_at
        )
        VALUES (
          @taskType, @sourceName, @sourceUrl, @provider, @modelName,
          @confidence, @summary, @resultJson, @createdAt
        )
      `
    )
    .run({
      taskType: prediction.taskType,
      sourceName: prediction.sourceName,
      sourceUrl: prediction.sourceUrl,
      provider: prediction.provider,
      modelName: prediction.modelName,
      confidence: prediction.confidence,
      summary: prediction.summary,
      resultJson: JSON.stringify(prediction),
      createdAt: prediction.createdAt
    });

  return {
    ...prediction,
    id: Number(result.lastInsertRowid)
  };
}

function createSeed(fileBuffer: Buffer, originalName: string) {
  const digest = createHash('sha1').update(fileBuffer).update(originalName).digest();
  return digest.readUInt32BE(0) / 0xffffffff;
}

function clamp(value: number, min: number, max: number) {
  if (!Number.isFinite(value)) {
    return min;
  }

  return Math.max(min, Math.min(max, value));
}

function toNonEmptyString(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function toSqlTimestamp(date: Date) {
  return date.toISOString().slice(0, 19).replace('T', ' ');
}
