import { createHash } from 'node:crypto';
import fsSync from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import type { MultipartFile } from '@fastify/multipart';
import type { FastifyInstance } from 'fastify';
import { runtimePaths } from '../config';

type TaskType = 'landslide' | 'glacier';
type ProviderType = 'mock' | 'external-http';

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
  classification?: ClassificationResult;
  segmentation: {
    regions: SegmentationRegion[];
  };
  metadata: Record<string, AnalysisMetadataValue>;
};

type SavedUpload = {
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
        ORDER BY created_at DESC, id DESC
        LIMIT ?
      `
    )
    .all(limit);

  return rows;
}

async function saveUpload(file: MultipartFile): Promise<SavedUpload> {
  const originalName = file.filename?.trim() || 'uploaded-file';
  const extension = path.extname(originalName).toLowerCase() || guessExtension(file.mimetype);
  const storedName = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}${extension}`;
  const absolutePath = path.join(runtimePaths.analysisUploadsDir, storedName);
  await pipeline(file.file, fsSync.createWriteStream(absolutePath));

  return {
    originalName,
    storedName,
    absolutePath,
    publicUrl: `/uploads/analysis/${storedName}`,
    mimeType: file.mimetype || 'application/octet-stream'
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

  const endpointPath =
    taskType === 'landslide'
      ? fastify.appConfig.aiLandslideEndpoint
      : fastify.appConfig.aiGlacierEndpoint;
  const response = await fetch(new URL(endpointPath, fastify.appConfig.aiInferenceBaseUrl).toString(), {
    method: 'POST',
    body: formData
  });

  if (!response.ok) {
    throw new Error(`外部推理服务调用失败: ${response.status}`);
  }

  const payload = (await response.json()) as Record<string, unknown>;
  return normalizeExternalPrediction(taskType, savedUpload, payload);
}

async function runMockPrediction(
  taskType: TaskType,
  savedUpload: SavedUpload
): Promise<HazardPrediction> {
  const fileBuffer = await fs.readFile(savedUpload.absolutePath);
  const seed = createSeed(fileBuffer, savedUpload.originalName);
  const createdAt = toSqlTimestamp(new Date());

  if (taskType === 'landslide') {
    const hasHazard = seed > 0.34;
    const confidence = clamp(hasHazard ? 0.71 + seed * 0.22 : 0.67 + (0.34 - seed) * 0.45, 0.51, 0.97);
    const regions = hasHazard ? [buildPolygonRegion(seed, '疑似滑坡区域', confidence)] : [];

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
        reviewSuggested: hasHazard,
        segmentationStageTriggered: hasHazard
      }
    };
  }

  const coverageRatio = clamp(0.18 + seed * 0.46, 0.18, 0.72);
  const changeIndex = clamp(0.3 + seed * 0.58, 0.3, 0.88);
  const confidence = clamp(0.73 + seed * 0.2, 0.73, 0.95);

  return {
    taskType,
    provider: 'mock',
    modelName: 'GlacierSAR-Net',
    sourceName: savedUpload.originalName,
    sourceUrl: savedUpload.publicUrl,
    createdAt,
    summary: '已生成冰川边界分割结果，并提取变化敏感区供后续人工判读。',
    confidence,
    segmentation: {
      regions: [
        buildPolygonRegion(seed, '冰川主体区域', confidence),
        buildPolygonRegion((seed + 0.19) % 1, '变化敏感区', clamp(confidence - 0.08, 0.55, 0.9))
      ]
    },
    metadata: {
      inputMode: 'insar',
      estimatedCoverageRatio: Number(coverageRatio.toFixed(3)),
      changeIndex: Number(changeIndex.toFixed(3)),
      inferredChannels: 2
    }
  };
}

function normalizeExternalPrediction(
  taskType: TaskType,
  savedUpload: SavedUpload,
  payload: Record<string, unknown>
): HazardPrediction {
  const createdAt = toSqlTimestamp(new Date());

  if (taskType === 'landslide') {
    const hasHazard = Boolean(payload.has_landslide ?? payload.hasLandslide ?? false);
    const confidence = clamp(Number(payload.confidence ?? payload.score ?? (hasHazard ? 0.88 : 0.22)), 0, 1);
    const regions = normalizeRegions(
      payload.segmentation,
      payload.mask,
      hasHazard ? '疑似滑坡区域' : '滑坡区域'
    );

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
        rawMaskIncluded: Array.isArray(payload.mask)
      }
    };
  }

  const regions = normalizeRegions(
    payload.segmentation,
    payload.glacier_mask ?? payload.glacierMask ?? payload.mask,
    '冰川区域'
  );
  const coverageRatio = computeCoverageRatio(payload.glacier_mask ?? payload.glacierMask ?? payload.mask);
  const confidence = clamp(Number(payload.confidence ?? payload.score ?? 0.86), 0, 1);

  return {
    taskType,
    provider: 'external-http',
    modelName: toNonEmptyString(payload.modelName) ?? 'GlacierSAR-Net',
    sourceName: savedUpload.originalName,
    sourceUrl: savedUpload.publicUrl,
    createdAt,
    summary: toNonEmptyString(payload.summary) ?? '外部模型已完成冰川区域分割。',
    confidence,
    segmentation: {
      regions
    },
    metadata: {
      inputMode: 'insar',
      estimatedCoverageRatio: coverageRatio,
      rawMaskIncluded: Array.isArray(payload.glacier_mask ?? payload.glacierMask ?? payload.mask)
    }
  };
}

function normalizeRegions(
  segmentationValue: unknown,
  maskValue: unknown,
  fallbackLabel: string
): SegmentationRegion[] {
  if (isRegionArray(segmentationValue)) {
    return segmentationValue.map((region) => ({
      label: toNonEmptyString(region.label) ?? fallbackLabel,
      score: clamp(Number(region.score ?? 0.8), 0, 1),
      polygon: normalizePolygon(region.polygon)
    }));
  }

  const maskRegion = maskToRegion(maskValue, fallbackLabel);
  return maskRegion ? [maskRegion] : [];
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

function computeCoverageRatio(maskValue: unknown) {
  const mask = parseMask(maskValue);
  if (!mask.length || !mask[0]?.length) {
    return null;
  }

  let positives = 0;
  let total = 0;
  for (const row of mask) {
    for (const value of row) {
      total += 1;
      if (value > 0) {
        positives += 1;
      }
    }
  }

  if (!total) {
    return null;
  }

  return Number((positives / total).toFixed(3));
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

function guessExtension(mimeType?: string) {
  if (!mimeType) {
    return '.bin';
  }

  if (mimeType.includes('png')) return '.png';
  if (mimeType.includes('jpeg') || mimeType.includes('jpg')) return '.jpg';
  if (mimeType.includes('tif')) return '.tif';
  return '.bin';
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
