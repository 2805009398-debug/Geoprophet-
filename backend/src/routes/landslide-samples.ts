import fs from 'node:fs/promises';
import path from 'node:path';
import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { runtimePaths } from '../config';
import { badRequest, notFound } from '../errors';
import { authenticate } from '../guards';

type Coordinates = [number, number];
type Bounds = [number, number, number, number];
type FeatureProperties = Record<string, unknown>;

type LandslideSample = {
  id: string;
  objectId: number | null;
  eventId: string;
  title: string;
  description: string;
  category: string;
  categoryKey: string;
  trigger: string;
  triggerKey: string;
  size: string;
  sizeKey: string;
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
  rawProperties: FeatureProperties;
};

type SampleStore = {
  samples: LandslideSample[];
  bounds: Bounds | null;
  sourcePath: string;
  bytes: number;
  updatedAt: string | null;
  filtering: SampleStoreFiltering;
};

type SampleStoreFiltering = {
  countryCodes: string[];
  minEventDate: string;
  rawTotal: number;
  excludedTotal: number;
  excludedByCountry: number;
  excludedByDate: number;
};

const defaultLimit = 25;
const defaultMapLimit = 1000;
const maxLimit = 200;
const maxMapLimit = 2500;
const samplesRelativePath = 'coolr_global/nasa_coolr_reports_points_global.geojson';
const defaultCountryCodes = ['CN'];
const defaultMinEventDate = '2000-01-01';

const sampleQuerySchema = z.object({
  keyword: z.string().trim().optional(),
  country: z.string().trim().optional(),
  category: z.string().trim().optional(),
  trigger: z.string().trim().optional(),
  size: z.string().trim().optional(),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  bbox: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(maxLimit).optional(),
  offset: z.coerce.number().int().min(0).optional(),
  mapLimit: z.coerce.number().int().min(1).max(maxMapLimit).optional()
});

let cachedStore: Promise<SampleStore> | null = null;

export async function landslideSampleRoutes(fastify: FastifyInstance) {
  fastify.get('/api/landslide-samples/summary', { preHandler: authenticate }, async () => {
    const store = await getSampleStore();
    return buildSummary(store);
  });

  fastify.get('/api/landslide-samples', { preHandler: authenticate }, async (request) => {
    const parsed = sampleQuerySchema.parse(request.query ?? {});
    if (parsed.startDate && parsed.endDate && parsed.startDate > parsed.endDate) {
      throw badRequest('startDate 不能晚于 endDate。');
    }

    const store = await getSampleStore();
    const bbox = parsed.bbox ? parseBbox(parsed.bbox) : undefined;
    const filters = {
      keyword: parsed.keyword || undefined,
      country: parsed.country || undefined,
      category: parsed.category || undefined,
      trigger: parsed.trigger || undefined,
      size: parsed.size || undefined,
      startDate: parsed.startDate,
      endDate: parsed.endDate,
      bbox
    };
    const filtered = store.samples.filter((sample) => matchesFilters(sample, filters)).sort(compareSampleDateDesc);
    const offset = parsed.offset ?? 0;
    const limit = parsed.limit ?? defaultLimit;
    const mapLimit = parsed.mapLimit ?? defaultMapLimit;
    const items = filtered.slice(offset, offset + limit).map(toListItem);
    const mapSamples = filtered.slice(0, mapLimit);

    return {
      items,
      total: filtered.length,
      limit,
      offset,
      returned: items.length,
      mapReturned: mapSamples.length,
      previewLimited: filtered.length > mapSamples.length,
      filters: {
        ...filters,
        bbox: filters.bbox
      },
      featureCollection: toFeatureCollection(mapSamples, filtered.length, mapLimit)
    };
  });
}

async function getSampleStore() {
  if (!cachedStore) {
    cachedStore = loadSampleStore();
  }

  return cachedStore;
}

async function loadSampleStore(): Promise<SampleStore> {
  const absolutePath = resolveDataPath(samplesRelativePath);
  let stat;
  try {
    stat = await fs.stat(absolutePath);
  } catch {
    throw notFound('COOLR 全球滑坡样本文件不存在，请检查地灾数据目录配置。');
  }

  const content = await fs.readFile(absolutePath, 'utf-8');
  const collection = JSON.parse(content) as { features?: unknown[] };
  const features = Array.isArray(collection.features) ? collection.features : [];
  const rawSamples = features.map(readSample).filter((sample): sample is LandslideSample => Boolean(sample));
  const samples = rawSamples.filter(matchesDefaultScope).sort(compareSampleDateDesc);

  return {
    samples,
    bounds: getBounds(samples),
    sourcePath: samplesRelativePath,
    bytes: stat.size,
    updatedAt: stat.mtime.toISOString(),
    filtering: getStoreFiltering(rawSamples, samples)
  };
}

function readSample(rawFeature: unknown): LandslideSample | null {
  const feature = rawFeature as {
    geometry?: { coordinates?: unknown };
    properties?: FeatureProperties;
  };
  const coordinates = readCoordinates(feature.geometry?.coordinates);
  if (!coordinates) {
    return null;
  }

  const properties = feature.properties ?? {};
  const objectId = optionalNumber(properties.objectid);
  const eventId = stringValue(properties.event_id);
  const category = stringValue(properties.landslide_category) || 'unknown';
  const trigger = stringValue(properties.landslide_trigger) || 'unknown';
  const size = stringValue(properties.landslide_size) || 'unknown';
  const countryName = stringValue(properties.country_name);
  const countryCode = stringValue(properties.country_code);
  const title = stringValue(properties.event_title) || stringValue(properties.location_description) || '未命名滑坡样本';
  const submittedDate = formatTimestamp(properties.submitted_date);

  return {
    id: eventId || String(objectId ?? `${coordinates[0]},${coordinates[1]}`),
    objectId,
    eventId,
    title,
    description: stringValue(properties.event_description),
    category,
    categoryKey: normalizeOption(category),
    trigger,
    triggerKey: normalizeOption(trigger),
    size,
    sizeKey: normalizeOption(size),
    setting: stringValue(properties.landslide_setting),
    countryName,
    countryCode,
    adminDivision: stringValue(properties.admin_division_name),
    locationDescription: stringValue(properties.location_description),
    locationAccuracy: stringValue(properties.location_accuracy),
    closestPlace: stringValue(properties.gazetteer_closest_point),
    eventDate: formatTimestamp(properties.event_date),
    submittedDate,
    fatalities: optionalNumber(properties.fatality_count) ?? 0,
    injuries: optionalNumber(properties.injury_count) ?? 0,
    sourceName: stringValue(properties.source_name),
    sourceLink: stringValue(properties.source_link),
    photoLink: stringValue(properties.photo_link),
    lng: coordinates[0],
    lat: coordinates[1],
    rawProperties: properties
  };
}

function buildSummary(store: SampleStore) {
  const datedSamples = store.samples.filter((sample) => sample.eventDate);
  const countryNames = new Set(store.samples.map((sample) => sample.countryName).filter(Boolean));
  const totalFatalities = store.samples.reduce((sum, sample) => sum + sample.fatalities, 0);
  const totalInjuries = store.samples.reduce((sum, sample) => sum + sample.injuries, 0);
  const sortedDates = datedSamples.map((sample) => sample.eventDate as string).sort();

  return {
    source: {
      name: 'NASA COOLR Reports Points Global',
      provider: 'NASA COOLR',
      path: store.sourcePath,
      bytes: store.bytes,
      updatedAt: store.updatedAt
    },
    summary: {
      total: store.samples.length,
      rawTotal: store.filtering.rawTotal,
      dated: datedSamples.length,
      undated: store.samples.length - datedSamples.length,
      countries: countryNames.size,
      totalFatalities,
      totalInjuries,
      bounds: store.bounds,
      dateRange: {
        start: sortedDates[0] ?? null,
        end: sortedDates[sortedDates.length - 1] ?? null
      }
    },
    filtering: store.filtering,
    categories: distribution(store.samples, (sample) => sample.category, (sample) => sample.categoryKey),
    triggers: distribution(store.samples, (sample) => sample.trigger, (sample) => sample.triggerKey),
    sizes: distribution(store.samples, (sample) => sample.size, (sample) => sample.sizeKey),
    countries: distribution(
      store.samples,
      (sample) => sample.countryName || sample.countryCode || 'unknown',
      (sample) => sample.countryCode || normalizeOption(sample.countryName)
    ),
    regions: distribution(
      store.samples,
      (sample) => sample.adminDivision || sample.closestPlace || 'unknown',
      (sample) => normalizeOption(sample.adminDivision || sample.closestPlace || 'unknown')
    ),
    topCountries: distribution(
      store.samples,
      (sample) => sample.countryName || sample.countryCode || 'unknown',
      (sample) => sample.countryCode || normalizeOption(sample.countryName)
    ).slice(0, 12),
    topRegions: distribution(
      store.samples,
      (sample) => sample.adminDivision || sample.closestPlace || 'unknown',
      (sample) => normalizeOption(sample.adminDivision || sample.closestPlace || 'unknown')
    ).slice(0, 12),
    yearlyTrend: yearlyTrend(store.samples)
  };
}

function matchesDefaultScope(sample: LandslideSample) {
  return isDefaultCountry(sample) && Boolean(sample.eventDate && sample.eventDate >= defaultMinEventDate);
}

function isDefaultCountry(sample: LandslideSample) {
  const countryCode = sample.countryCode.toUpperCase();
  const countryName = normalizeOption(sample.countryName);
  return defaultCountryCodes.includes(countryCode) || countryName === 'china';
}

function getStoreFiltering(rawSamples: LandslideSample[], scopedSamples: LandslideSample[]): SampleStoreFiltering {
  const excludedByCountry = rawSamples.filter((sample) => !isDefaultCountry(sample)).length;
  const excludedByDate = rawSamples.filter(
    (sample) => isDefaultCountry(sample) && (!sample.eventDate || sample.eventDate < defaultMinEventDate)
  ).length;

  return {
    countryCodes: defaultCountryCodes,
    minEventDate: defaultMinEventDate,
    rawTotal: rawSamples.length,
    excludedTotal: rawSamples.length - scopedSamples.length,
    excludedByCountry,
    excludedByDate
  };
}

function matchesFilters(
  sample: LandslideSample,
  filters: {
    keyword?: string;
    country?: string;
    category?: string;
    trigger?: string;
    size?: string;
    startDate?: string;
    endDate?: string;
    bbox?: Bounds;
  }
) {
  if (filters.country) {
    const countryFilter = filters.country.toLowerCase();
    if (
      sample.countryCode.toLowerCase() !== countryFilter &&
      normalizeOption(sample.countryName) !== normalizeOption(filters.country)
    ) {
      return false;
    }
  }

  if (filters.category && sample.categoryKey !== normalizeOption(filters.category)) {
    return false;
  }

  if (filters.trigger && sample.triggerKey !== normalizeOption(filters.trigger)) {
    return false;
  }

  if (filters.size && sample.sizeKey !== normalizeOption(filters.size)) {
    return false;
  }

  if (filters.startDate && (!sample.eventDate || sample.eventDate < filters.startDate)) {
    return false;
  }

  if (filters.endDate && (!sample.eventDate || sample.eventDate > filters.endDate)) {
    return false;
  }

  if (filters.bbox) {
    const [west, south, east, north] = filters.bbox;
    if (sample.lng < west || sample.lng > east || sample.lat < south || sample.lat > north) {
      return false;
    }
  }

  if (filters.keyword) {
    const keyword = filters.keyword.toLowerCase();
    const haystack = [
      sample.title,
      sample.description,
      sample.countryName,
      sample.adminDivision,
      sample.locationDescription,
      sample.closestPlace,
      sample.category,
      sample.trigger,
      sample.size,
      sample.sourceName
    ]
      .join(' ')
      .toLowerCase();
    if (!haystack.includes(keyword)) {
      return false;
    }
  }

  return true;
}

function toListItem(sample: LandslideSample) {
  return {
    id: sample.id,
    objectId: sample.objectId,
    eventId: sample.eventId,
    title: sample.title,
    description: sample.description,
    category: sample.category,
    trigger: sample.trigger,
    size: sample.size,
    setting: sample.setting,
    countryName: sample.countryName,
    countryCode: sample.countryCode,
    adminDivision: sample.adminDivision,
    locationDescription: sample.locationDescription,
    locationAccuracy: sample.locationAccuracy,
    closestPlace: sample.closestPlace,
    eventDate: sample.eventDate,
    submittedDate: sample.submittedDate,
    fatalities: sample.fatalities,
    injuries: sample.injuries,
    sourceName: sample.sourceName,
    sourceLink: sample.sourceLink,
    photoLink: sample.photoLink,
    lat: sample.lat,
    lng: sample.lng
  };
}

function toFeatureCollection(samples: LandslideSample[], total: number, mapLimit: number) {
  return {
    type: 'FeatureCollection',
    totalFeatures: total,
    returnedFeatures: samples.length,
    previewLimited: total > samples.length,
    previewLimit: mapLimit,
    offset: 0,
    features: samples.map((sample) => ({
      type: 'Feature',
      geometry: {
        type: 'Point',
        coordinates: [sample.lng, sample.lat]
      },
      properties: {
        ...sample.rawProperties,
        event_date_label: sample.eventDate,
        submitted_date_label: sample.submittedDate
      }
    }))
  };
}

function distribution(
  samples: LandslideSample[],
  labelFor: (sample: LandslideSample) => string,
  valueFor: (sample: LandslideSample) => string
) {
  const groups = new Map<string, { label: string; value: string; count: number }>();

  for (const sample of samples) {
    const label = labelFor(sample) || 'unknown';
    const value = valueFor(sample) || normalizeOption(label);
    const key = value.toLowerCase();
    const group = groups.get(key) ?? { label, value, count: 0 };
    group.count += 1;
    groups.set(key, group);
  }

  return [...groups.values()].sort((left, right) => right.count - left.count || left.label.localeCompare(right.label));
}

function yearlyTrend(samples: LandslideSample[]) {
  const counts = new Map<string, number>();
  for (const sample of samples) {
    if (!sample.eventDate) {
      continue;
    }
    const year = sample.eventDate.slice(0, 4);
    counts.set(year, (counts.get(year) ?? 0) + 1);
  }

  return [...counts.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([year, count]) => ({ year, count }));
}

function compareSampleDateDesc(left: LandslideSample, right: LandslideSample) {
  const leftDate = left.eventDate ?? '';
  const rightDate = right.eventDate ?? '';
  if (leftDate !== rightDate) {
    return rightDate.localeCompare(leftDate);
  }

  return left.title.localeCompare(right.title);
}

function parseBbox(value: string): Bounds {
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

function readCoordinates(value: unknown): Coordinates | null {
  if (!Array.isArray(value) || value.length < 2) {
    return null;
  }

  const lng = Number(value[0]);
  const lat = Number(value[1]);
  if (!Number.isFinite(lng) || !Number.isFinite(lat)) {
    return null;
  }

  return [lng, lat];
}

function getBounds(samples: LandslideSample[]): Bounds | null {
  let west = Infinity;
  let south = Infinity;
  let east = -Infinity;
  let north = -Infinity;

  for (const sample of samples) {
    west = Math.min(west, sample.lng);
    south = Math.min(south, sample.lat);
    east = Math.max(east, sample.lng);
    north = Math.max(north, sample.lat);
  }

  if (!Number.isFinite(west) || !Number.isFinite(south) || !Number.isFinite(east) || !Number.isFinite(north)) {
    return null;
  }

  return [west, south, east, north];
}

function optionalNumber(value: unknown) {
  if (value === null || value === undefined || value === '') {
    return null;
  }

  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function stringValue(value: unknown) {
  if (value === null || value === undefined) {
    return '';
  }

  const text = String(value).trim();
  return text === 'null' ? '' : text;
}

function formatTimestamp(value: unknown) {
  const numeric = optionalNumber(value);
  if (numeric === null) {
    return null;
  }

  const date = new Date(numeric);
  if (Number.isNaN(date.getTime())) {
    return null;
  }

  return date.toISOString().slice(0, 10);
}

function normalizeOption(value: string) {
  return value.trim().toLowerCase().replace(/[\s-]+/g, '_');
}

function resolveDataPath(relativePath: string) {
  const absolutePath = path.resolve(runtimePaths.geohazardsDataDir, relativePath);
  const dataRoot = path.resolve(runtimePaths.geohazardsDataDir);
  const relativeToRoot = path.relative(dataRoot, absolutePath);

  if (relativeToRoot.startsWith('..') || path.isAbsolute(relativeToRoot)) {
    throw new Error('非法地灾数据路径。');
  }

  return absolutePath;
}
