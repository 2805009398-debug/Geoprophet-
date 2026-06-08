import fs from 'node:fs/promises';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { appConfig, runtimePaths } from '../config';

type BBox = [number, number, number, number];

type RemoteSensingRegion = {
  id: string;
  name: string;
  bbox: BBox;
  description?: string;
};

type RemoteSensingProduct = {
  id: string;
  title: string;
  source: string;
  layerName: string;
  format: 'image/jpeg' | 'image/png';
  extension: 'jpg' | 'png';
  transparent: boolean;
  description: string;
};

type RemoteSensingAsset = {
  productId: string;
  productTitle: string;
  source: string;
  layerName: string;
  regionId: string;
  regionName: string;
  bbox: BBox;
  assetDate: string;
  format: string;
  filePath: string;
  metadataPath: string;
  bytes: number;
  width: number;
  height: number;
  wmsUrl: string;
  status: 'available';
  createdAt: string;
};

type RemoteSensingSyncOptions = {
  triggeredBy: 'startup' | 'scheduler' | 'manual';
  targetDate?: string;
};

type RemoteSensingSyncResult = {
  id: number;
  status: 'success' | 'partial' | 'failed' | 'running';
  triggeredBy: string;
  targetDate: string;
  startedAt: string;
  finishedAt?: string;
  regionCount: number;
  productCount: number;
  assetCount: number;
  errorCount: number;
  message: string;
  assets: RemoteSensingAsset[];
  errors: Array<{
    productId: string;
    regionId: string;
    message: string;
  }>;
};

type RemoteSensingAssetListItem = {
  id: number;
  productId: string;
  productTitle: string;
  source: string;
  layerName: string;
  regionId: string;
  regionName: string;
  bbox: unknown[];
  assetDate: string;
  format: string;
  filePath: string;
  bytes: number;
  width: number;
  height: number;
  wmsUrl: string;
  status: string;
  createdAt: string;
};

const defaultProducts: RemoteSensingProduct[] = [
  {
    id: 'modis-terra-true-color',
    title: 'MODIS Terra 真彩色',
    source: 'NASA GIBS',
    layerName: 'MODIS_Terra_CorrectedReflectance_TrueColor',
    format: 'image/jpeg',
    extension: 'jpg',
    transparent: false,
    description: 'Terra MODIS 日尺度真彩色浏览影像，用于区域地表状态和云覆盖快速核验。'
  },
  {
    id: 'viirs-snpp-true-color',
    title: 'VIIRS SNPP 真彩色',
    source: 'NASA GIBS',
    layerName: 'VIIRS_SNPP_CorrectedReflectance_TrueColor',
    format: 'image/jpeg',
    extension: 'jpg',
    transparent: false,
    description: 'Suomi NPP VIIRS 日尺度真彩色浏览影像，作为 MODIS 的近实时补充。'
  },
  {
    id: 'imerg-precipitation-rate',
    title: 'GPM IMERG 降雨率',
    source: 'NASA GIBS',
    layerName: 'IMERG_Precipitation_Rate',
    format: 'image/png',
    extension: 'png',
    transparent: true,
    description: 'GPM IMERG 降雨率可视化图层，用于滑坡、泥石流降雨触发背景判断。'
  }
];

const fallbackRegions: RemoteSensingRegion[] = [
  {
    id: 'china_northeast',
    name: '中国东北重点区',
    bbox: [115, 38, 135, 54]
  },
  {
    id: 'china_southwest_core',
    name: '中国西南核心区',
    bbox: [97, 21, 111, 34]
  },
  {
    id: 'china_southwest_extended',
    name: '中国西南扩展区',
    bbox: [73, 21, 111, 36]
  }
];

let syncInFlight: Promise<RemoteSensingSyncResult> | null = null;
let schedulerTimer: NodeJS.Timeout | null = null;
let nextScheduledAt: string | null = null;

export function startRemoteSensingScheduler(fastify: FastifyInstance) {
  if (!fastify.appConfig.remoteSensingSyncEnabled || schedulerTimer) {
    return;
  }

  const intervalMs = Math.max(1, fastify.appConfig.remoteSensingSyncIntervalHours) * 60 * 60 * 1000;

  const runScheduledSync = async (triggeredBy: 'startup' | 'scheduler') => {
    const targetDate = getDefaultTargetDate(fastify);
    if (await hasSuccessfulRunForDate(fastify, targetDate)) {
      insertSystemLog(fastify, 'info', `NASA GIBS 遥感数据 ${targetDate} 已同步，跳过本次${triggeredBy === 'startup' ? '启动补拉' : '定时任务'}。`);
      return;
    }

    try {
      await syncRemoteSensingAssets(fastify, { triggeredBy, targetDate });
    } catch (error) {
      fastify.log.warn({ error }, 'remote sensing scheduled sync failed');
    }
  };

  if (fastify.appConfig.remoteSensingSyncOnStart) {
    setTimeout(() => {
      void runScheduledSync('startup');
    }, 3000).unref();
  }

  const scheduleNext = () => {
    const scheduledAt = new Date(Date.now() + intervalMs);
    nextScheduledAt = scheduledAt.toISOString();
    schedulerTimer = setTimeout(async () => {
      await runScheduledSync('scheduler');
      scheduleNext();
    }, intervalMs);
    schedulerTimer.unref();
  };

  scheduleNext();
}

export function stopRemoteSensingScheduler() {
  if (schedulerTimer) {
    clearTimeout(schedulerTimer);
    schedulerTimer = null;
  }
  nextScheduledAt = null;
}

export async function syncRemoteSensingAssets(
  fastify: FastifyInstance,
  options: RemoteSensingSyncOptions
): Promise<RemoteSensingSyncResult> {
  if (syncInFlight) {
    return syncInFlight;
  }

  syncInFlight = runSync(fastify, options).finally(() => {
    syncInFlight = null;
  });

  return syncInFlight;
}

export async function getRemoteSensingStatus(fastify: FastifyInstance) {
  const products = getSelectedProducts(fastify.appConfig.remoteSensingProducts);
  const regions = await getSelectedRegions(fastify.appConfig.remoteSensingRegions);
  const lastRun = getLastRun(fastify);
  const recentRuns = listRecentRuns(fastify, 5);
  const recentAssets = listRecentAssets(fastify, 12);
  const assetSummary = getAssetSummary(fastify);

  return {
    enabled: fastify.appConfig.remoteSensingSyncEnabled,
    syncOnStart: fastify.appConfig.remoteSensingSyncOnStart,
    intervalHours: fastify.appConfig.remoteSensingSyncIntervalHours,
    lagDays: fastify.appConfig.remoteSensingLagDays,
    endpoint: fastify.appConfig.remoteSensingGibsEndpoint,
    nextScheduledAt,
    inProgress: Boolean(syncInFlight),
    manifestPath: 'remote_sensing/nasa_gibs_daily_manifest.json',
    products: products.map(({ id, title, layerName, source, description }) => ({
      id,
      title,
      layerName,
      source,
      description
    })),
    regions: regions.map(({ id, name, bbox, description }) => ({ id, name, bbox, description })),
    summary: assetSummary,
    lastRun,
    recentRuns,
    recentAssets
  };
}

async function runSync(
  fastify: FastifyInstance,
  options: RemoteSensingSyncOptions
): Promise<RemoteSensingSyncResult> {
  const targetDate = options.targetDate ?? getDefaultTargetDate(fastify);
  const products = getSelectedProducts(fastify.appConfig.remoteSensingProducts);
  const regions = await getSelectedRegions(fastify.appConfig.remoteSensingRegions);
  const startedAt = nowSql();
  const runId = createRun(fastify, {
    status: 'running',
    triggeredBy: options.triggeredBy,
    targetDate,
    startedAt,
    regionCount: regions.length,
    productCount: products.length
  });
  const assets: RemoteSensingAsset[] = [];
  const errors: RemoteSensingSyncResult['errors'] = [];

  insertSystemLog(
    fastify,
    'info',
    `开始同步 NASA GIBS 遥感数据：日期 ${targetDate}，区域 ${regions.length} 个，产品 ${products.length} 个。`
  );

  for (const region of regions) {
    for (const product of products) {
      try {
        const asset = await downloadProductForRegion(fastify, product, region, targetDate);
        assets.push(asset);
        upsertAsset(fastify, runId, asset);
      } catch (error) {
        const message = error instanceof Error ? error.message : 'remote-sensing-download-failed';
        errors.push({
          productId: product.id,
          regionId: region.id,
          message
        });
        fastify.log.warn({ error, productId: product.id, regionId: region.id }, 'remote sensing asset failed');
      }
    }
  }

  await writeManifest(fastify);

  const status = errors.length === 0 ? 'success' : assets.length > 0 ? 'partial' : 'failed';
  const finishedAt = nowSql();
  const message =
    status === 'success'
      ? `NASA GIBS 遥感数据同步完成，新增或更新 ${assets.length} 个资产。`
      : status === 'partial'
        ? `NASA GIBS 遥感数据部分同步完成，成功 ${assets.length} 个，失败 ${errors.length} 个。`
        : `NASA GIBS 遥感数据同步失败，失败 ${errors.length} 个。`;

  finishRun(fastify, runId, {
    status,
    finishedAt,
    assetCount: assets.length,
    errorCount: errors.length,
    message,
    summary: {
      assets,
      errors
    }
  });
  insertSystemLog(fastify, status === 'failed' ? 'error' : status === 'partial' ? 'warning' : 'info', message);

  return {
    id: runId,
    status,
    triggeredBy: options.triggeredBy,
    targetDate,
    startedAt,
    finishedAt,
    regionCount: regions.length,
    productCount: products.length,
    assetCount: assets.length,
    errorCount: errors.length,
    message,
    assets,
    errors
  };
}

async function downloadProductForRegion(
  fastify: FastifyInstance,
  product: RemoteSensingProduct,
  region: RemoteSensingRegion,
  targetDate: string
): Promise<RemoteSensingAsset> {
  const { width, height } = getImageSize(region.bbox, fastify.appConfig.remoteSensingMaxImageWidth);
  const wmsUrl = buildWmsUrl(fastify, product, region.bbox, targetDate, width, height);
  const response = await fetchWithTimeout(wmsUrl, fastify.appConfig.remoteSensingRequestTimeoutMs);
  const contentType = response.headers.get('content-type') ?? '';

  if (!response.ok) {
    throw new Error(`NASA GIBS HTTP ${response.status}`);
  }

  if (!contentType.toLowerCase().startsWith('image/')) {
    const text = await response.text();
    throw new Error(`NASA GIBS 返回非影像内容：${text.slice(0, 180)}`);
  }

  const buffer = Buffer.from(await response.arrayBuffer());
  if (buffer.length === 0) {
    throw new Error('NASA GIBS 返回空影像。');
  }

  const outputDir = path.join(runtimePaths.geohazardsDataDir, 'remote_sensing', targetDate, region.id);
  await fs.mkdir(outputDir, { recursive: true });

  const baseName = `${product.id}_${targetDate}_${region.id}`;
  const imagePath = path.join(outputDir, `${baseName}.${product.extension}`);
  const metadataPath = path.join(outputDir, `${baseName}.json`);
  await fs.writeFile(imagePath, buffer);

  const createdAt = nowSql();
  const asset: RemoteSensingAsset = {
    productId: product.id,
    productTitle: product.title,
    source: product.source,
    layerName: product.layerName,
    regionId: region.id,
    regionName: region.name,
    bbox: region.bbox,
    assetDate: targetDate,
    format: product.format,
    filePath: normalizePath(path.relative(runtimePaths.geohazardsDataDir, imagePath)),
    metadataPath: normalizePath(path.relative(runtimePaths.geohazardsDataDir, metadataPath)),
    bytes: buffer.length,
    width,
    height,
    wmsUrl,
    status: 'available',
    createdAt
  };

  await fs.writeFile(
    metadataPath,
    `${JSON.stringify(
      {
        ...asset,
        description: product.description,
        fetchedAt: new Date().toISOString()
      },
      null,
      2
    )}\n`,
    'utf-8'
  );

  return asset;
}

function buildWmsUrl(
  fastify: FastifyInstance,
  product: RemoteSensingProduct,
  bbox: BBox,
  targetDate: string,
  width: number,
  height: number
) {
  const [west, south, east, north] = bbox;
  const url = new URL(fastify.appConfig.remoteSensingGibsEndpoint);
  url.searchParams.set('SERVICE', 'WMS');
  url.searchParams.set('REQUEST', 'GetMap');
  url.searchParams.set('VERSION', '1.1.1');
  url.searchParams.set('LAYERS', product.layerName);
  url.searchParams.set('STYLES', '');
  url.searchParams.set('SRS', 'EPSG:4326');
  url.searchParams.set('BBOX', [west, south, east, north].join(','));
  url.searchParams.set('WIDTH', String(width));
  url.searchParams.set('HEIGHT', String(height));
  url.searchParams.set('FORMAT', product.format);
  url.searchParams.set('TIME', targetDate);
  url.searchParams.set('TRANSPARENT', product.transparent ? 'TRUE' : 'FALSE');
  return url.toString();
}

async function fetchWithTimeout(url: string, timeoutMs: number) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(url, {
      signal: controller.signal,
      headers: {
        'user-agent': 'GeoProphet remote sensing sync/0.1'
      }
    });
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error('NASA GIBS 请求超时。');
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

function getImageSize(bbox: BBox, maxWidth: number) {
  const [west, south, east, north] = bbox;
  const widthDegrees = Math.max(east - west, 0.01);
  const heightDegrees = Math.max(north - south, 0.01);
  const width = Math.max(256, Math.trunc(maxWidth));
  const height = Math.max(256, Math.round(width * (heightDegrees / widthDegrees)));
  return {
    width,
    height: Math.min(Math.max(height, 256), 1600)
  };
}

async function getSelectedRegions(selectedIds: string[]) {
  const regions = await readRegions();
  if (selectedIds.length === 0) {
    return regions;
  }

  const selected = regions.filter((region) => selectedIds.includes(region.id));
  return selected.length > 0 ? selected : regions;
}

async function readRegions(): Promise<RemoteSensingRegion[]> {
  try {
    const content = await fs.readFile(path.join(runtimePaths.geohazardsDataDir, 'hicool_regions.json'), 'utf-8');
    const payload = JSON.parse(content) as { regions?: unknown };
    if (!Array.isArray(payload.regions)) {
      return fallbackRegions;
    }

    const regions = payload.regions
      .map((item) => parseRegion(item))
      .filter((item): item is RemoteSensingRegion => Boolean(item));
    return regions.length > 0 ? regions : fallbackRegions;
  } catch {
    return fallbackRegions;
  }
}

function parseRegion(value: unknown): RemoteSensingRegion | null {
  if (!value || typeof value !== 'object') {
    return null;
  }

  const region = value as {
    id?: unknown;
    name?: unknown;
    bbox?: unknown;
    description?: unknown;
  };

  if (typeof region.id !== 'string' || typeof region.name !== 'string' || !Array.isArray(region.bbox)) {
    return null;
  }

  const bbox = region.bbox.map((part) => Number(part));
  if (bbox.length !== 4 || bbox.some((part) => !Number.isFinite(part))) {
    return null;
  }

  return {
    id: toSlug(region.id),
    name: region.name,
    bbox: bbox as BBox,
    description: typeof region.description === 'string' ? region.description : undefined
  };
}

function getSelectedProducts(selectedIds: string[]) {
  if (selectedIds.length === 0) {
    return defaultProducts;
  }

  const selected = defaultProducts.filter((product) => selectedIds.includes(product.id));
  return selected.length > 0 ? selected : defaultProducts;
}

function createRun(
  fastify: FastifyInstance,
  run: {
    status: string;
    triggeredBy: string;
    targetDate: string;
    startedAt: string;
    regionCount: number;
    productCount: number;
  }
) {
  const result = fastify.db
    .prepare(
      `
        INSERT INTO remote_sensing_sync_runs (
          status, triggered_by, target_date, started_at, region_count, product_count, message
        )
        VALUES (@status, @triggeredBy, @targetDate, @startedAt, @regionCount, @productCount, @message)
      `
    )
    .run({
      ...run,
      message: 'NASA GIBS 遥感数据同步运行中。'
    });

  return Number(result.lastInsertRowid);
}

function finishRun(
  fastify: FastifyInstance,
  runId: number,
  values: {
    status: string;
    finishedAt: string;
    assetCount: number;
    errorCount: number;
    message: string;
    summary: unknown;
  }
) {
  fastify.db
    .prepare(
      `
        UPDATE remote_sensing_sync_runs
        SET
          status = @status,
          finished_at = @finishedAt,
          asset_count = @assetCount,
          error_count = @errorCount,
          message = @message,
          summary_json = @summaryJson
        WHERE id = @runId
      `
    )
    .run({
      ...values,
      summaryJson: JSON.stringify(values.summary),
      runId
    });
}

function upsertAsset(fastify: FastifyInstance, runId: number, asset: RemoteSensingAsset) {
  fastify.db
    .prepare(
      `
        INSERT INTO remote_sensing_assets (
          run_id, product_id, product_title, source, layer_name, region_id, region_name,
          bbox_json, asset_date, format, file_path, bytes, width, height, wms_url,
          status, error_message, created_at
        )
        VALUES (
          @runId, @productId, @productTitle, @source, @layerName, @regionId, @regionName,
          @bboxJson, @assetDate, @format, @filePath, @bytes, @width, @height, @wmsUrl,
          @status, NULL, @createdAt
        )
        ON CONFLICT(product_id, region_id, asset_date) DO UPDATE SET
          run_id = excluded.run_id,
          product_title = excluded.product_title,
          source = excluded.source,
          layer_name = excluded.layer_name,
          region_name = excluded.region_name,
          bbox_json = excluded.bbox_json,
          format = excluded.format,
          file_path = excluded.file_path,
          bytes = excluded.bytes,
          width = excluded.width,
          height = excluded.height,
          wms_url = excluded.wms_url,
          status = excluded.status,
          error_message = NULL,
          created_at = excluded.created_at
      `
    )
    .run({
      ...asset,
      runId,
      bboxJson: JSON.stringify(asset.bbox)
    });
}

async function writeManifest(fastify: FastifyInstance) {
  const rows = listRecentAssets(fastify, 1000);
  const outDir = path.join(runtimePaths.geohazardsDataDir, 'remote_sensing');
  await fs.mkdir(outDir, { recursive: true });
  await fs.writeFile(
    path.join(outDir, 'nasa_gibs_daily_manifest.json'),
    `${JSON.stringify(
      {
        updatedAt: new Date().toISOString(),
        source: 'NASA GIBS WMS',
        endpoint: appConfig.remoteSensingGibsEndpoint,
        assets: rows
      },
      null,
      2
    )}\n`,
    'utf-8'
  );
  await fs.writeFile(
    path.join(outDir, 'nasa_gibs_daily_manifest.csv'),
    toCsv(
      rows.map((row) => ({
        assetDate: row.assetDate,
        productId: row.productId,
        productTitle: row.productTitle,
        regionId: row.regionId,
        regionName: row.regionName,
        filePath: row.filePath,
        bytes: row.bytes,
        width: row.width,
        height: row.height,
        source: row.source,
        layerName: row.layerName
      }))
    ),
    'utf-8'
  );
}

function getLastRun(fastify: FastifyInstance) {
  return fastify.db
    .prepare(
      `
        SELECT
          id,
          status,
          triggered_by AS triggeredBy,
          target_date AS targetDate,
          started_at AS startedAt,
          finished_at AS finishedAt,
          region_count AS regionCount,
          product_count AS productCount,
          asset_count AS assetCount,
          error_count AS errorCount,
          message
        FROM remote_sensing_sync_runs
        ORDER BY started_at DESC, id DESC
        LIMIT 1
      `
    )
    .get() as Record<string, unknown> | undefined;
}

function listRecentRuns(fastify: FastifyInstance, limit: number) {
  return fastify.db
    .prepare(
      `
        SELECT
          id,
          status,
          triggered_by AS triggeredBy,
          target_date AS targetDate,
          started_at AS startedAt,
          finished_at AS finishedAt,
          asset_count AS assetCount,
          error_count AS errorCount,
          message
        FROM remote_sensing_sync_runs
        ORDER BY started_at DESC, id DESC
        LIMIT ?
      `
    )
    .all(limit);
}

function listRecentAssets(fastify: FastifyInstance, limit: number): RemoteSensingAssetListItem[] {
  return fastify.db
    .prepare(
      `
        SELECT
          id,
          product_id AS productId,
          product_title AS productTitle,
          source,
          layer_name AS layerName,
          region_id AS regionId,
          region_name AS regionName,
          bbox_json AS bboxJson,
          asset_date AS assetDate,
          format,
          file_path AS filePath,
          bytes,
          width,
          height,
          wms_url AS wmsUrl,
          status,
          created_at AS createdAt
        FROM remote_sensing_assets
        ORDER BY asset_date DESC, created_at DESC, id DESC
        LIMIT ?
      `
    )
    .all(limit)
    .map((row) => {
      const item = row as Record<string, unknown>;
      return {
        id: Number(item.id ?? 0),
        productId: String(item.productId ?? ''),
        productTitle: String(item.productTitle ?? ''),
        source: String(item.source ?? ''),
        layerName: String(item.layerName ?? ''),
        regionId: String(item.regionId ?? ''),
        regionName: String(item.regionName ?? ''),
        bbox: parseJsonArray(item.bboxJson),
        assetDate: String(item.assetDate ?? ''),
        format: String(item.format ?? ''),
        filePath: String(item.filePath ?? ''),
        bytes: Number(item.bytes ?? 0),
        width: Number(item.width ?? 0),
        height: Number(item.height ?? 0),
        wmsUrl: String(item.wmsUrl ?? ''),
        status: String(item.status ?? ''),
        createdAt: String(item.createdAt ?? '')
      };
    });
}

function getAssetSummary(fastify: FastifyInstance) {
  const row = fastify.db
    .prepare(
      `
        SELECT
          COUNT(*) AS assetCount,
          COALESCE(SUM(bytes), 0) AS totalBytes,
          MAX(asset_date) AS latestAssetDate,
          MAX(created_at) AS lastAssetAt
        FROM remote_sensing_assets
        WHERE status = 'available'
      `
    )
    .get() as {
      assetCount: number;
      totalBytes: number;
      latestAssetDate?: string | null;
      lastAssetAt?: string | null;
    };

  return {
    assetCount: Number(row.assetCount ?? 0),
    totalBytes: Number(row.totalBytes ?? 0),
    totalSizeMb: Number((Number(row.totalBytes ?? 0) / 1024 / 1024).toFixed(2)),
    latestAssetDate: row.latestAssetDate ?? null,
    lastAssetAt: row.lastAssetAt ?? null
  };
}

async function hasSuccessfulRunForDate(fastify: FastifyInstance, targetDate: string) {
  const row = fastify.db
    .prepare(
      `
        SELECT id
        FROM remote_sensing_sync_runs
        WHERE target_date = ? AND status IN ('success', 'partial')
        LIMIT 1
      `
    )
    .get(targetDate);
  return Boolean(row);
}

function insertSystemLog(fastify: FastifyInstance, level: 'info' | 'warning' | 'error', message: string) {
  fastify.db
    .prepare(
      `
        INSERT INTO system_logs (category, level, message, created_at)
        VALUES ('ingestion', @level, @message, @createdAt)
      `
    )
    .run({
      level,
      message,
      createdAt: nowSql()
    });
}

function getDefaultTargetDate(fastify: FastifyInstance) {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() - fastify.appConfig.remoteSensingLagDays);
  return date.toISOString().slice(0, 10);
}

function nowSql() {
  return new Date().toISOString().slice(0, 19).replace('T', ' ');
}

function toSlug(value: string) {
  return value.trim().toLowerCase().replace(/[^a-z0-9_-]+/g, '_').replace(/^_+|_+$/g, '');
}

function normalizePath(value: string) {
  return value.replace(/\\/g, '/');
}

function parseJsonArray(value: unknown) {
  if (typeof value !== 'string') {
    return [];
  }

  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function toCsv(rows: Array<Record<string, unknown>>) {
  if (rows.length === 0) {
    return '';
  }

  const headers = Object.keys(rows[0] ?? {});
  const lines = [
    headers.join(','),
    ...rows.map((row) => headers.map((header) => csvValue(row[header])).join(','))
  ];
  return `${lines.join('\n')}\n`;
}

function csvValue(value: unknown) {
  const text = String(value ?? '');
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}
