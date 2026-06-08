import fs from 'node:fs/promises';
import path from 'node:path';
import { runtimePaths } from '../config';

type ArcGisFeatureCollection = {
  type: 'FeatureCollection';
  features: Array<Record<string, unknown>>;
};

const services = [
  {
    service: 'COOLR_Events_Points',
    fileName: 'nasa_coolr_events_points_global.geojson'
  },
  {
    service: 'COOLR_Reports_Points',
    fileName: 'nasa_coolr_reports_points_global.geojson'
  },
  {
    service: 'COOLR_Events_Polygons',
    fileName: 'nasa_coolr_events_polygons_global.geojson'
  },
  {
    service: 'COOLR_Reports_Polygons',
    fileName: 'nasa_coolr_reports_polygons_global.geojson'
  }
];

const outDir = path.join(runtimePaths.geohazardsDataDir, 'coolr_global');
const pagesDir = path.join(outDir, '_pages');
const chunkSizeArg = Number(
  process.argv
    .find((arg) => arg.startsWith('--chunk='))
    ?.split('=')
    .slice(1)
    .join('=')
);
const pageSize = Number.isFinite(chunkSizeArg) && chunkSizeArg > 0 ? Math.trunc(chunkSizeArg) : 2000;
const downloadMode =
  process.argv
    .find((arg) => arg.startsWith('--mode='))
    ?.split('=')
    .slice(1)
    .join('=') === 'objectIds'
    ? 'objectIds'
    : 'offset';
const knownCounts: Record<string, number> = {
  COOLR_Events_Points: 40310,
  COOLR_Reports_Points: 14753,
  COOLR_Events_Polygons: 22421,
  COOLR_Reports_Polygons: 48
};

async function main() {
  await fs.mkdir(outDir, { recursive: true });
  await fs.mkdir(pagesDir, { recursive: true });
  const manifest = [];
  const requestedService = process.argv
    .find((arg) => arg.startsWith('--service='))
    ?.split('=')
    .slice(1)
    .join('=');
  const countOverride = Number(
    process.argv
      .find((arg) => arg.startsWith('--count='))
      ?.split('=')
      .slice(1)
      .join('=')
  );
  const selectedServices = requestedService
    ? services.filter((item) => item.service === requestedService)
    : services;

  for (const item of selectedServices) {
    const count = Number.isFinite(countOverride) && countOverride > 0 ? countOverride : await fetchCount(item.service);
    const servicePagesDir = path.join(pagesDir, item.service);
    await fs.mkdir(servicePagesDir, { recursive: true });

    if (downloadMode === 'objectIds') {
      const objectIds = await fetchObjectIds(item.service);
      for (let offset = 0; offset < count; offset += pageSize) {
        const pagePath = path.join(servicePagesDir, `oid-${pageSize}-${offset}.geojson`);
        if (await isUsablePage(pagePath)) {
          console.log(`${item.service}: reuse objectId chunk ${offset}`);
          continue;
        }

        const page = await fetchObjectPage(item.service, objectIds.slice(offset, offset + pageSize));
        await fs.writeFile(pagePath, `${JSON.stringify(page)}\n`, 'utf-8');
        console.log(`${item.service}: saved objectId chunk ${offset} (${page.features.length})`);
      }
    } else {
      for (let offset = 0; offset < count; offset += pageSize) {
        const pagePath = path.join(servicePagesDir, `${offset}.geojson`);
        if (await isUsablePage(pagePath)) {
          console.log(`${item.service}: reuse offset chunk ${offset}`);
          continue;
        }

        const page = await fetchPage(item.service, offset);
        await fs.writeFile(pagePath, `${JSON.stringify(page)}\n`, 'utf-8');
        console.log(`${item.service}: saved offset chunk ${offset} (${page.features.length})`);
      }
    }

    const features = await readServicePages(servicePagesDir, downloadMode === 'objectIds' ? `oid-${pageSize}-` : null);
    const collection: ArcGisFeatureCollection = {
      type: 'FeatureCollection',
      features: features.slice(0, count)
    };
    const outPath = path.join(outDir, item.fileName);
    await fs.writeFile(outPath, `${JSON.stringify(collection)}\n`, 'utf-8');
    manifest.push({
      service: item.service,
      path: normalizePath(path.relative(runtimePaths.projectRoot, outPath)),
      count: features.length
    });
  }

  await fs.writeFile(
    path.join(outDir, 'nasa_coolr_global_download_manifest.json'),
    `${JSON.stringify(manifest, null, 2)}\n`,
    'utf-8'
  );
  console.log(JSON.stringify(manifest, null, 2));
}

async function fetchCount(service: string) {
  for (let attempt = 1; attempt <= 5; attempt += 1) {
    const url = new URL(`https://gis.earthdata.nasa.gov/gis05/rest/services/Landslides/${service}/FeatureServer/0/query`);
    url.searchParams.set('where', '1=1');
    url.searchParams.set('returnCountOnly', 'true');
    url.searchParams.set('f', 'json');

    const payload = await fetchJson<{ count?: number; error?: unknown }>(url);
    if (!payload.error && typeof payload.count === 'number') {
      return payload.count;
    }

    console.warn(`${service} count attempt ${attempt} failed: ${JSON.stringify(payload).slice(0, 200)}`);
    await sleep(1500 * attempt);
  }

  if (knownCounts[service]) {
    console.warn(`${service} using known count fallback: ${knownCounts[service]}`);
    return knownCounts[service];
  }

  const objectIdUrl = new URL(`https://gis.earthdata.nasa.gov/gis05/rest/services/Landslides/${service}/FeatureServer/0/query`);
  objectIdUrl.searchParams.set('where', '1=1');
  objectIdUrl.searchParams.set('returnIdsOnly', 'true');
  objectIdUrl.searchParams.set('f', 'json');
  const idPayload = await fetchJson<{ objectIds?: number[]; error?: unknown }>(objectIdUrl);
  if (!idPayload.error && Array.isArray(idPayload.objectIds)) {
    return idPayload.objectIds.length;
  }

  throw new Error(`Unable to read ${service} count: ${JSON.stringify(idPayload)}`);
}

async function fetchObjectIds(service: string) {
  const cachePath = path.join(pagesDir, `${service}-objectids.json`);
  try {
    const cached = JSON.parse(await fs.readFile(cachePath, 'utf-8')) as number[];
    if (Array.isArray(cached) && cached.length > 0) {
      return cached;
    }
  } catch {
    // Cache is optional.
  }

  for (let attempt = 1; attempt <= 5; attempt += 1) {
    const url = new URL(`https://gis.earthdata.nasa.gov/gis05/rest/services/Landslides/${service}/FeatureServer/0/query`);
    url.searchParams.set('where', '1=1');
    url.searchParams.set('returnIdsOnly', 'true');
    url.searchParams.set('f', 'json');
    const payload = await fetchJson<{ objectIds?: number[]; error?: unknown }>(url);
    if (!payload.error && Array.isArray(payload.objectIds)) {
      payload.objectIds.sort((left, right) => left - right);
      await fs.writeFile(cachePath, `${JSON.stringify(payload.objectIds)}\n`, 'utf-8');
      return payload.objectIds;
    }

    console.warn(`${service} objectIds attempt ${attempt} failed: ${JSON.stringify(payload).slice(0, 200)}`);
    await sleep(1500 * attempt);
  }

  if (knownCounts[service]) {
    const fallbackIds = Array.from({ length: knownCounts[service] }, (_value, index) => index + 1);
    await fs.writeFile(cachePath, `${JSON.stringify(fallbackIds)}\n`, 'utf-8');
    console.warn(`${service} using sequential objectId fallback: 1-${knownCounts[service]}`);
    return fallbackIds;
  }

  throw new Error(`Unable to read ${service} objectIds.`);
}

async function fetchObjectPage(service: string, objectIds: number[]) {
  const url = new URL(`https://gis.earthdata.nasa.gov/gis05/rest/services/Landslides/${service}/FeatureServer/0/query`);
  url.searchParams.set('objectIds', objectIds.join(','));
  url.searchParams.set('outFields', '*');
  url.searchParams.set('returnGeometry', 'true');
  url.searchParams.set('outSR', '4326');
  url.searchParams.set('f', 'geojson');

  const payload = await fetchJson<ArcGisFeatureCollection & { error?: unknown }>(url);
  if (payload.error || !Array.isArray(payload.features)) {
    throw new Error(`Unable to read ${service} objectIds ${objectIds[0]}-${objectIds.at(-1)}: ${JSON.stringify(payload).slice(0, 500)}`);
  }

  return payload;
}

async function isUsablePage(pagePath: string) {
  try {
    const content = await fs.readFile(pagePath, 'utf-8');
    const payload = JSON.parse(content) as ArcGisFeatureCollection;
    return Array.isArray(payload.features);
  } catch {
    return false;
  }
}

async function readServicePages(servicePagesDir: string, prefix: string | null) {
  const entries = await fs.readdir(servicePagesDir);
  const pageFiles = entries
    .filter((entry) => entry.endsWith('.geojson'))
    .filter((entry) => (prefix ? entry.startsWith(prefix) : /^\d+\.geojson$/.test(entry)))
    .sort((left, right) => Number.parseInt(prefix ? left.replace(prefix, '') : left, 10) - Number.parseInt(prefix ? right.replace(prefix, '') : right, 10));
  const features: Array<Record<string, unknown>> = [];

  for (const pageFile of pageFiles) {
    const content = await fs.readFile(path.join(servicePagesDir, pageFile), 'utf-8');
    const page = JSON.parse(content) as ArcGisFeatureCollection;
    features.push(...page.features);
  }

  return features;
}

async function fetchPage(service: string, offset: number) {
  const url = new URL(`https://gis.earthdata.nasa.gov/gis05/rest/services/Landslides/${service}/FeatureServer/0/query`);
  url.searchParams.set('where', '1=1');
  url.searchParams.set('outFields', '*');
  url.searchParams.set('returnGeometry', 'true');
  url.searchParams.set('outSR', '4326');
  url.searchParams.set('f', 'geojson');
  url.searchParams.set('orderByFields', 'objectid');
  url.searchParams.set('resultOffset', String(offset));
  url.searchParams.set('resultRecordCount', String(pageSize));

  const payload = await fetchJson<ArcGisFeatureCollection & { error?: unknown }>(url);
  if (payload.error || !Array.isArray(payload.features)) {
    throw new Error(`Unable to read ${service} at offset ${offset}: ${JSON.stringify(payload).slice(0, 500)}`);
  }

  return payload;
}

async function fetchJson<T>(url: URL, attempt = 1): Promise<T> {
  try {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    return (await response.json()) as T;
  } catch (error) {
    if (attempt >= 3) {
      throw error;
    }
    await new Promise((resolve) => setTimeout(resolve, 1000 * attempt));
    return fetchJson<T>(url, attempt + 1);
  }
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizePath(value: string) {
  return value.replace(/\\/g, '/');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
