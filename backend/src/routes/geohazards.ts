import fs from 'node:fs/promises';
import path from 'node:path';
import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { runtimePaths } from '../config';
import { badRequest, notFound } from '../errors';
import { geohazardLayerDefinitions } from '../geohazards/layers';
import { authenticate, requireRoles } from '../guards';
import { getPostgisPool } from '../services/postgis';
import { getRemoteSensingStatus, syncRemoteSensingAssets } from '../services/remote-sensing-sync';

type CsvRow = Record<string, string>;
type BBox = [number, number, number, number];
type LayerQuery = {
  bbox?: BBox;
  property?: string;
  value?: string;
  keyword?: string;
  limit: number | null;
  offset: number;
};

const layerQuerySchema = z
  .object({
    bbox: z.string().optional(),
    property: z.string().trim().regex(/^[A-Za-z0-9_]+$/).optional(),
    value: z.string().trim().optional(),
    keyword: z.string().trim().optional(),
    limit: z.coerce.number().int().min(1).max(10_000).optional(),
    offset: z.coerce.number().int().min(0).optional()
  })
  .refine((query) => !(query.property && query.value === undefined) && !(query.value !== undefined && !query.property), {
    message: 'property 和 value 必须同时提供。'
  });

export async function geohazardRoutes(fastify: FastifyInstance) {
  fastify.get('/api/geohazards/overview', { preHandler: authenticate }, async () => {
    const remoteSensing = await getRemoteSensingStatus(fastify);
    const postgisOverview = await readPostgisOverview(fastify);
    if (postgisOverview) {
      return {
        ...postgisOverview,
        remoteSensing
      };
    }

    const manifest = await readCsvFile('download_manifest.csv');
    const catalog = await readCsvFile('hicool_geohazard_data_catalog.csv');
    const regions = await readJsonFile('hicool_regions.json');
    const layerSummaries = await buildLayerSummaries(manifest);
    const totalBytes = manifest.reduce((sum, row) => sum + toNumber(row.bytes), 0);
    const recordCount = manifest.reduce((sum, row) => sum + toNumber(row.record_count), 0);
    const vectorRecordCount = manifest
      .filter((row) => row.type === 'geojson')
      .reduce((sum, row) => sum + toNumber(row.record_count), 0);
    const groups = groupManifestByFolder(manifest);

    return {
      summary: {
        fileCount: manifest.length,
        recordCount,
        vectorRecordCount,
        totalBytes,
        totalSizeMb: toMegabytes(totalBytes),
        vectorLayerCount: layerSummaries.filter((layer) => layer.available).length,
        rasterFileCount: manifest.filter((row) => row.type === 'tif').length
      },
      groups,
      layers: layerSummaries,
      catalog,
      regions: regions?.regions ?? [],
      landsatScenes: manifest
        .filter((row) => row.path.endsWith('.stac.json'))
        .map((row) => ({
          path: row.path,
          sceneId: row.notes,
          bytes: toNumber(row.bytes)
        })),
      gatedProducts: [
        {
          name: 'NASADEM / GPM IMERG / HLS / Sentinel-1',
          reason: '需要 Earthdata 或 USGS 登录授权，当前项目环境未配置账号。'
        }
      ],
      remoteSensing
    };
  });

  fastify.get('/api/geohazards/remote-sensing/status', { preHandler: authenticate }, async () => (
    getRemoteSensingStatus(fastify)
  ));

  fastify.get('/api/geohazards/weather', { preHandler: authenticate }, async (request) => {
    const query = z.object({
      lat: z.coerce.number().min(-90).max(90),
      lng: z.coerce.number().min(-180).max(180),
      label: z.string().trim().max(80).optional()
    }).parse(request.query ?? {});

    return getWeatherSnapshot(query.lat, query.lng, query.label);
  });

  fastify.get('/api/geohazards/gee/map', { preHandler: authenticate }, async () => ({
    enabled: fastify.appConfig.geeEnabled && Boolean(fastify.appConfig.geeTileUrlTemplate),
    configured: Boolean(fastify.appConfig.geeTileUrlTemplate),
    title: fastify.appConfig.geeLayerTitle,
    tileUrlTemplate: fastify.appConfig.geeTileUrlTemplate ?? null,
    attribution: fastify.appConfig.geeAttribution,
    opacity: fastify.appConfig.geeOpacity,
    minZoom: fastify.appConfig.geeMinZoom,
    maxZoom: fastify.appConfig.geeMaxZoom,
    note: fastify.appConfig.geeTileUrlTemplate
      ? '已配置 Google Earth Engine 瓦片模板，可在地图中叠加。'
      : '未配置 GEE_TILE_URL_TEMPLATE。请在后端通过服务账号或 Earth Engine 脚本生成瓦片模板后填入环境变量。'
  }));

  fastify.post('/api/geohazards/remote-sensing/sync', { preHandler: [authenticate, requireRoles('admin', 'operator', 'expert')] }, async (request, reply) => {
    const query = z.object({ targetDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional() }).parse(request.query ?? {});
    const result = await syncRemoteSensingAssets(fastify, {
      triggeredBy: 'manual',
      targetDate: query.targetDate
    });
    return reply.code(result.status === 'failed' ? 502 : 201).send(result);
  });

  fastify.get('/api/geohazards/layers/:layerId', { preHandler: authenticate }, async (request, reply) => {
    const params = z.object({ layerId: z.string() }).parse(request.params);
    const layer = geohazardLayerDefinitions.find((item) => item.id === params.layerId);

    if (!layer) {
      return reply.code(404).send({ message: '未找到指定地灾图层。', requestId: request.id });
    }

    const layerQuery = parseLayerQuery(request.query, layer.previewLimit);
    const postgisLayer = await readPostgisLayer(fastify, layer.id, layerQuery);
    if (postgisLayer) {
      reply.type('application/geo+json');
      return postgisLayer;
    }

    const absolutePath = resolveDataPath(layer.path);
    if (!(await exists(absolutePath))) {
      throw notFound('图层数据文件不存在，请检查地灾数据目录配置。');
    }

    const content = await fs.readFile(absolutePath, 'utf-8');
    const collection = JSON.parse(content);
    if (Array.isArray(collection.features)) {
      const filteredFeatures = applyLayerQuery(collection.features, layerQuery);
      const limitedFeatures = sliceFeatures(filteredFeatures, layerQuery);
      collection.features = limitedFeatures;
      collection.totalFeatures = filteredFeatures.length;
      collection.returnedFeatures = limitedFeatures.length;
      collection.previewLimited = isResultLimited(filteredFeatures.length, limitedFeatures.length, layerQuery);
      collection.previewLimit = layerQuery.limit;
      collection.offset = layerQuery.offset;
      collection.filters = describeLayerFilters(layerQuery);
    }
    reply.type('application/geo+json');
    return collection;
  });
}

async function buildLayerSummaries(manifest: CsvRow[]) {
  return Promise.all(
    geohazardLayerDefinitions.map(async (layer) => {
      const absolutePath = resolveDataPath(layer.path);
      const manifestRow = manifest.find((row) => normalizePath(row.path).endsWith(normalizePath(layer.path)));
      const available = await exists(absolutePath);

      return {
        ...layer,
        available,
        recordCount: toNumber(manifestRow?.record_count),
        bytes: toNumber(manifestRow?.bytes)
      };
    })
  );
}

async function readPostgisOverview(fastify: FastifyInstance) {
  if (!fastify.appConfig.geohazardsPreferPostgis) {
    return null;
  }

  const pool = getPostgisPool();
  if (!pool) {
    return null;
  }

  try {
    const [assetResult, layerResult, catalogResult, regionResult, landsatResult] = await Promise.all([
      pool.query(`
        SELECT
          path,
          file_type AS type,
          bytes,
          record_count,
          width,
          height,
          bands,
          crs,
          notes
        FROM geohazard.data_assets
        ORDER BY path
      `),
      pool.query(`
        SELECT
          id,
          title,
          source,
          theme,
          region,
          geometry_type AS "geometryType",
          path,
          color,
          description,
          available,
          record_count AS "recordCount",
          bytes
        FROM geohazard.layers
        ORDER BY id
      `),
      pool.query(`
        SELECT
          id AS dataset_id,
          theme,
          product_short_name,
          source,
          platform,
          resolution,
          temporal_coverage,
          recommended_region,
          project_use,
          priority,
          access_url,
          notes
        FROM geohazard.datasets
        ORDER BY priority DESC, id
      `),
      pool.query(`
        SELECT
          id,
          name,
          description,
          ARRAY[
            ST_XMin(bbox::box3d),
            ST_YMin(bbox::box3d),
            ST_XMax(bbox::box3d),
            ST_YMax(bbox::box3d)
          ] AS bbox
        FROM geohazard.regions
        ORDER BY id
      `),
      pool.query(`
        SELECT path, notes, bytes
        FROM geohazard.data_assets
        WHERE path LIKE '%.stac.json'
        ORDER BY path
      `)
    ]);

    const assets = assetResult.rows;
    const totalBytes = assets.reduce((sum, row) => sum + toNumber(row.bytes), 0);
    const recordCount = assets.reduce((sum, row) => sum + toNumber(row.record_count), 0);
    const vectorRecordCount = assets
      .filter((row) => row.type === 'geojson')
      .reduce((sum, row) => sum + toNumber(row.record_count), 0);

    return {
      summary: {
        fileCount: assets.length,
        recordCount,
        vectorRecordCount,
        totalBytes,
        totalSizeMb: toMegabytes(totalBytes),
        vectorLayerCount: layerResult.rows.filter((layer) => layer.available).length,
        rasterFileCount: assets.filter((row) => row.type === 'tif').length
      },
      groups: groupManifestByFolder(assets),
      layers: layerResult.rows,
      catalog: catalogResult.rows,
      regions: regionResult.rows,
      landsatScenes: landsatResult.rows.map((row) => ({
        path: row.path,
        sceneId: row.notes,
        bytes: toNumber(row.bytes)
      })),
      gatedProducts: [
        {
          name: 'NASADEM / GPM IMERG / HLS / Sentinel-1',
          reason: '需要 Earthdata 或 USGS 登录授权，当前项目环境未配置账号。'
        }
      ],
      storage: {
        vector: 'postgis',
        raster: 'file-assets'
      }
    };
  } catch (error) {
    fastify.log.warn({ error }, 'PostGIS geohazard overview unavailable; falling back to files.');
    return null;
  }
}

async function readPostgisLayer(fastify: FastifyInstance, layerId: string, layerQuery: LayerQuery) {
  if (!fastify.appConfig.geohazardsPreferPostgis) {
    return null;
  }

  const pool = getPostgisPool();
  if (!pool) {
    return null;
  }

  try {
    const filter = buildPostgisFilter(layerId, layerQuery);
    const countResult = await pool.query(
      `SELECT COUNT(*)::int AS total FROM geohazard.features WHERE ${filter.whereClause}`,
      filter.params
    );
    const totalFeatures = Number(countResult.rows[0]?.total ?? 0);
    const limit = layerQuery.limit ?? 2_147_483_647;
    const limitIndex = filter.params.length + 1;
    const offsetIndex = filter.params.length + 2;
    const result = await pool.query(
      `
        SELECT jsonb_build_object(
          'type', 'FeatureCollection',
          'totalFeatures', $${limitIndex + 2}::int,
          'returnedFeatures', COUNT(*)::int,
          'previewLimited', $${limitIndex + 3}::boolean,
          'previewLimit', $${limitIndex + 4}::int,
          'offset', $${offsetIndex}::int,
          'filters', $${limitIndex + 5}::jsonb,
          'features', COALESCE(
            jsonb_agg(
              jsonb_build_object(
                'type', 'Feature',
                'geometry', ST_AsGeoJSON(geom)::jsonb,
                'properties', properties
              )
              ORDER BY id
            ),
            '[]'::jsonb
          )
        ) AS collection
        FROM (
          SELECT id, properties, geom
          FROM geohazard.features
          WHERE ${filter.whereClause}
          ORDER BY id
          LIMIT $${limitIndex}::int
          OFFSET $${offsetIndex}::int
        ) limited_features
      `,
      [
        ...filter.params,
        limit,
        layerQuery.offset,
        totalFeatures,
        isResultLimited(totalFeatures, Math.min(Math.max(totalFeatures - layerQuery.offset, 0), limit), layerQuery),
        layerQuery.limit,
        JSON.stringify(describeLayerFilters(layerQuery))
      ]
    );

    return result.rows[0]?.collection ?? { type: 'FeatureCollection', features: [] };
  } catch (error) {
    fastify.log.warn({ error, layerId }, 'PostGIS geohazard layer unavailable; falling back to files.');
    return null;
  }
}

function parseLayerQuery(rawQuery: unknown, previewLimit?: number): LayerQuery {
  const parsed = layerQuerySchema.parse(rawQuery ?? {});
  return {
    bbox: parsed.bbox ? parseBbox(parsed.bbox) : undefined,
    property: parsed.property,
    value: parsed.value,
    keyword: parsed.keyword || undefined,
    limit: parsed.limit ?? previewLimit ?? null,
    offset: parsed.offset ?? 0
  };
}

function parseBbox(value: string): BBox {
  const parts = value.split(',').map((part) => Number(part.trim()));
  if (parts.length !== 4 || parts.some((part) => !Number.isFinite(part))) {
    throw badRequest('bbox 参数格式应为 west,south,east,north。');
  }

  const [west, south, east, north] = parts;
  if (west >= east || south >= north || west < -180 || east > 180 || south < -90 || north > 90) {
    throw badRequest('bbox 参数范围不合法。');
  }

  return [west, south, east, north];
}

function applyLayerQuery(features: any[], layerQuery: LayerQuery) {
  return features.filter((feature) => {
    if (layerQuery.bbox && !geometryIntersectsBbox(feature.geometry, layerQuery.bbox)) {
      return false;
    }

    if (layerQuery.property && String(feature.properties?.[layerQuery.property] ?? '') !== layerQuery.value) {
      return false;
    }

    if (layerQuery.keyword) {
      const haystack = JSON.stringify(feature.properties ?? {}).toLowerCase();
      if (!haystack.includes(layerQuery.keyword.toLowerCase())) {
        return false;
      }
    }

    return true;
  });
}

function sliceFeatures(features: any[], layerQuery: LayerQuery) {
  const start = layerQuery.offset;
  const end = layerQuery.limit === null ? undefined : start + layerQuery.limit;
  return features.slice(start, end);
}

function isResultLimited(totalFeatures: number, returnedFeatures: number, layerQuery: LayerQuery) {
  return layerQuery.offset > 0 || returnedFeatures < totalFeatures;
}

function describeLayerFilters(layerQuery: LayerQuery) {
  return {
    bbox: layerQuery.bbox,
    property: layerQuery.property,
    value: layerQuery.value,
    keyword: layerQuery.keyword,
    limit: layerQuery.limit,
    offset: layerQuery.offset
  };
}

function geometryIntersectsBbox(geometry: any, bbox: BBox) {
  const geometryBbox = getGeometryBbox(geometry);
  if (!geometryBbox) {
    return false;
  }

  const [west, south, east, north] = geometryBbox;
  const [filterWest, filterSouth, filterEast, filterNorth] = bbox;
  return west <= filterEast && east >= filterWest && south <= filterNorth && north >= filterSouth;
}

function getGeometryBbox(geometry: any): BBox | null {
  let west = Infinity;
  let south = Infinity;
  let east = -Infinity;
  let north = -Infinity;

  function visit(value: unknown) {
    if (!Array.isArray(value)) {
      return;
    }

    if (typeof value[0] === 'number' && typeof value[1] === 'number') {
      const lng = value[0];
      const lat = value[1];
      west = Math.min(west, lng);
      south = Math.min(south, lat);
      east = Math.max(east, lng);
      north = Math.max(north, lat);
      return;
    }

    for (const item of value) {
      visit(item);
    }
  }

  visit(geometry?.coordinates);
  if (!Number.isFinite(west) || !Number.isFinite(south) || !Number.isFinite(east) || !Number.isFinite(north)) {
    return null;
  }

  return [west, south, east, north];
}

function buildPostgisFilter(layerId: string, layerQuery: LayerQuery) {
  const params: unknown[] = [layerId];
  const conditions = ['layer_id = $1'];

  if (layerQuery.bbox) {
    const [west, south, east, north] = layerQuery.bbox;
    const index = params.length + 1;
    params.push(west, south, east, north);
    conditions.push(`ST_Intersects(geom, ST_MakeEnvelope($${index}, $${index + 1}, $${index + 2}, $${index + 3}, 4326))`);
  }

  if (layerQuery.property && layerQuery.value !== undefined) {
    const index = params.length + 1;
    params.push(layerQuery.property, layerQuery.value);
    conditions.push(`(properties ->> $${index}::text) = $${index + 1}`);
  }

  if (layerQuery.keyword) {
    const index = params.length + 1;
    params.push(`%${layerQuery.keyword}%`);
    conditions.push(`concat_ws(' ', title, admin_name, category, trigger, source_name, properties::text) ILIKE $${index}`);
  }

  return {
    whereClause: conditions.join(' AND '),
    params
  };
}

function groupManifestByFolder(manifest: CsvRow[]) {
  const grouped = new Map<string, { name: string; fileCount: number; totalBytes: number; totalSizeMb: number }>();

  for (const row of manifest) {
    const folder = normalizePath(path.dirname(row.path || '')).replace(/^data\/geohazards\/?/, '') || 'root';
    const current = grouped.get(folder) ?? { name: folder, fileCount: 0, totalBytes: 0, totalSizeMb: 0 };
    current.fileCount += 1;
    current.totalBytes += toNumber(row.bytes);
    current.totalSizeMb = toMegabytes(current.totalBytes);
    grouped.set(folder, current);
  }

  return [...grouped.values()].sort((left, right) => left.name.localeCompare(right.name));
}

async function readCsvFile(relativePath: string) {
  const absolutePath = resolveDataPath(relativePath);
  if (!(await exists(absolutePath))) {
    return [];
  }

  const content = await fs.readFile(absolutePath, 'utf-8');
  const rows = parseCsv(content);
  const [headers, ...records] = rows;
  if (!headers) {
    return [];
  }

  return records
    .filter((record) => record.some((value) => value.trim()))
    .map((record) =>
      headers.reduce<CsvRow>((row, header, index) => {
        row[header] = record[index] ?? '';
        return row;
      }, {})
    );
}

async function readJsonFile(relativePath: string) {
  const absolutePath = resolveDataPath(relativePath);
  if (!(await exists(absolutePath))) {
    return null;
  }

  const content = await fs.readFile(absolutePath, 'utf-8');
  return JSON.parse(content);
}

function parseCsv(content: string) {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;

  for (let index = 0; index < content.length; index += 1) {
    const char = content[index];
    const next = content[index + 1];

    if (char === '"') {
      if (quoted && next === '"') {
        field += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
      continue;
    }

    if (char === ',' && !quoted) {
      row.push(field);
      field = '';
      continue;
    }

    if ((char === '\n' || char === '\r') && !quoted) {
      if (char === '\r' && next === '\n') {
        index += 1;
      }
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
      continue;
    }

    field += char;
  }

  if (field || row.length) {
    row.push(field);
    rows.push(row);
  }

  return rows;
}

async function exists(absolutePath: string) {
  try {
    await fs.access(absolutePath);
    return true;
  } catch {
    return false;
  }
}

function resolveDataPath(relativePath: string) {
  const normalized = normalizePath(relativePath).replace(/^data\/geohazards\/?/, '');
  const absolutePath = path.resolve(runtimePaths.geohazardsDataDir, normalized);
  const dataRoot = path.resolve(runtimePaths.geohazardsDataDir);
  const relativeToRoot = path.relative(dataRoot, absolutePath);

  if (relativeToRoot.startsWith('..') || path.isAbsolute(relativeToRoot)) {
    throw new Error('非法地灾数据路径。');
  }

  return absolutePath;
}

function normalizePath(value: string) {
  return value.replace(/\\/g, '/');
}

function toNumber(value: unknown) {
  const numeric = Number(value ?? 0);
  return Number.isFinite(numeric) ? numeric : 0;
}

function toMegabytes(bytes: number) {
  return Number((bytes / 1024 / 1024).toFixed(2));
}

async function getWeatherSnapshot(lat: number, lng: number, label?: string) {
  const url = new URL('https://api.open-meteo.com/v1/forecast');
  url.searchParams.set('latitude', String(lat));
  url.searchParams.set('longitude', String(lng));
  url.searchParams.set('timezone', 'auto');
  url.searchParams.set('forecast_days', '2');
  url.searchParams.set('past_days', '1');
  url.searchParams.set(
    'current',
    [
      'temperature_2m',
      'relative_humidity_2m',
      'apparent_temperature',
      'precipitation',
      'rain',
      'weather_code',
      'cloud_cover',
      'wind_speed_10m',
      'wind_direction_10m',
      'wind_gusts_10m'
    ].join(',')
  );
  url.searchParams.set(
    'hourly',
    ['precipitation', 'precipitation_probability', 'relative_humidity_2m'].join(',')
  );
  url.searchParams.set(
    'daily',
    ['precipitation_sum', 'precipitation_probability_max'].join(',')
  );

  const response = await fetchWithTimeout(url.toString(), 8000);
  if (!response.ok) {
    throw new Error(`Open-Meteo HTTP ${response.status}`);
  }

  const payload = await response.json() as {
    latitude?: number;
    longitude?: number;
    timezone?: string;
    current?: Record<string, unknown>;
    current_units?: Record<string, string>;
    hourly?: {
      time?: string[];
      precipitation?: number[];
      precipitation_probability?: number[];
      relative_humidity_2m?: number[];
    };
    daily?: {
      time?: string[];
      precipitation_sum?: number[];
      precipitation_probability_max?: number[];
    };
  };

  const currentTime = String(payload.current?.time ?? new Date().toISOString());
  const last24hPrecipitation = sumRecentHourly(payload.hourly?.time, payload.hourly?.precipitation, currentTime, 24);
  const next24hPrecipitation = sumFutureHourly(payload.hourly?.time, payload.hourly?.precipitation, currentTime, 24);
  const maxNext24hProbability = maxFutureHourly(
    payload.hourly?.time,
    payload.hourly?.precipitation_probability,
    currentTime,
    24
  );
  const currentPrecipitation = toNumber(payload.current?.precipitation);
  const risk = classifyWeatherRisk(currentPrecipitation, last24hPrecipitation, next24hPrecipitation, maxNext24hProbability);

  return {
    provider: 'Open-Meteo',
    label: label || '当前AOI',
    lat,
    lng,
    timezone: payload.timezone ?? null,
    fetchedAt: new Date().toISOString(),
    current: {
      time: currentTime,
      temperature: toNullableNumber(payload.current?.temperature_2m),
      apparentTemperature: toNullableNumber(payload.current?.apparent_temperature),
      relativeHumidity: toNullableNumber(payload.current?.relative_humidity_2m),
      precipitation: currentPrecipitation,
      rain: toNullableNumber(payload.current?.rain),
      weatherCode: toNullableNumber(payload.current?.weather_code),
      cloudCover: toNullableNumber(payload.current?.cloud_cover),
      windSpeed: toNullableNumber(payload.current?.wind_speed_10m),
      windDirection: toNullableNumber(payload.current?.wind_direction_10m),
      windGusts: toNullableNumber(payload.current?.wind_gusts_10m)
    },
    rainfall: {
      last24h: Number(last24hPrecipitation.toFixed(1)),
      next24h: Number(next24hPrecipitation.toFixed(1)),
      next24hProbability: maxNext24hProbability
    },
    daily: (payload.daily?.time ?? []).slice(0, 2).map((day, index) => ({
      date: day,
      precipitationSum: toNullableNumber(payload.daily?.precipitation_sum?.[index]),
      precipitationProbabilityMax: toNullableNumber(payload.daily?.precipitation_probability_max?.[index])
    })),
    risk,
    sourceUrl: url.toString()
  };
}

async function fetchWithTimeout(url: string, timeoutMs: number) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(url, {
      signal: controller.signal,
      headers: {
        'user-agent': 'GeoProphet weather context/0.1'
      }
    });
  } finally {
    clearTimeout(timeout);
  }
}

function sumRecentHourly(times: string[] = [], values: number[] = [], currentTime: string, hours: number) {
  const currentMs = Date.parse(currentTime);
  const startMs = currentMs - hours * 60 * 60 * 1000;
  return times.reduce((sum, time, index) => {
    const timeMs = Date.parse(time);
    if (!Number.isFinite(timeMs) || timeMs < startMs || timeMs > currentMs) {
      return sum;
    }
    return sum + toNumber(values[index]);
  }, 0);
}

function sumFutureHourly(times: string[] = [], values: number[] = [], currentTime: string, hours: number) {
  const currentMs = Date.parse(currentTime);
  const endMs = currentMs + hours * 60 * 60 * 1000;
  return times.reduce((sum, time, index) => {
    const timeMs = Date.parse(time);
    if (!Number.isFinite(timeMs) || timeMs < currentMs || timeMs > endMs) {
      return sum;
    }
    return sum + toNumber(values[index]);
  }, 0);
}

function maxFutureHourly(times: string[] = [], values: number[] = [], currentTime: string, hours: number) {
  const currentMs = Date.parse(currentTime);
  const endMs = currentMs + hours * 60 * 60 * 1000;
  const candidates = times
    .map((time, index) => ({ timeMs: Date.parse(time), value: Number(values[index]) }))
    .filter((item) => Number.isFinite(item.timeMs) && item.timeMs >= currentMs && item.timeMs <= endMs)
    .map((item) => item.value)
    .filter(Number.isFinite);
  return candidates.length > 0 ? Math.max(...candidates) : null;
}

function classifyWeatherRisk(
  currentPrecipitation: number,
  last24hPrecipitation: number,
  next24hPrecipitation: number,
  next24hProbability: number | null
) {
  const probability = next24hProbability ?? 0;
  const score = Math.min(
    100,
    Math.round(
      currentPrecipitation * 9 +
      last24hPrecipitation * 1.2 +
      next24hPrecipitation +
      probability * 0.25
    )
  );
  const level = score >= 70 || last24hPrecipitation >= 50 ? 'high' : score >= 35 || last24hPrecipitation >= 20 ? 'medium' : 'low';
  const label = level === 'high' ? '强降雨触发关注' : level === 'medium' ? '降雨触发观察' : '常规天气关注';

  return {
    level,
    score,
    label,
    basis: `近24小时降雨 ${last24hPrecipitation.toFixed(1)} mm，未来24小时预估 ${next24hPrecipitation.toFixed(1)} mm，最高降雨概率 ${next24hProbability ?? 0}%。`
  };
}

function toNullableNumber(value: unknown) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}
