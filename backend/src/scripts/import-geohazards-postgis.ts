import fs from 'node:fs/promises';
import path from 'node:path';
import { Pool, type PoolClient } from 'pg';
import { runtimePaths } from '../config';
import { geohazardLayerDefinitions } from '../geohazards/layers';

type CsvRow = Record<string, string>;
type GeoJsonFeature = {
  type: 'Feature';
  geometry: unknown;
  properties?: Record<string, unknown>;
};
type GeoJsonFeatureCollection = {
  type: 'FeatureCollection';
  features: GeoJsonFeature[];
};

const databaseUrl =
  process.env.POSTGIS_DATABASE_URL?.trim() ??
  process.env.DATABASE_URL?.trim() ??
  'postgres://geoprophet:geoprophet@127.0.0.1:5432/geoprophet';

async function main() {
  const pool = new Pool({ connectionString: databaseUrl });
  const client = await pool.connect();

  try {
    await client.query('BEGIN');
    await client.query(await fs.readFile(path.join(runtimePaths.appRoot, 'db', 'postgis.sql'), 'utf-8'));
    await client.query(`
      TRUNCATE
        geohazard.features,
        geohazard.layers,
        geohazard.raster_assets,
        geohazard.data_assets,
        geohazard.regions,
        geohazard.datasets
      RESTART IDENTITY CASCADE
    `);

    const catalog = await readCsvFile('hicool_geohazard_data_catalog.csv');
    const manifest = await readCsvFile('download_manifest.csv');
    const regions = await readJsonFile<{
      regions: Array<{ id: string; name: string; bbox: number[]; description: string }>;
    }>('hicool_regions.json');

    for (const dataset of catalog) {
      await client.query(
        `
          INSERT INTO geohazard.datasets (
            id, theme, product_short_name, source, platform, resolution,
            temporal_coverage, recommended_region, project_use, priority, access_url, notes
          )
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
        `,
        [
          dataset.dataset_id,
          dataset.theme,
          dataset.product_short_name,
          dataset.source,
          dataset.platform,
          dataset.resolution,
          dataset.temporal_coverage,
          dataset.recommended_region,
          dataset.project_use,
          dataset.priority,
          dataset.access_url,
          dataset.notes
        ]
      );
    }

    for (const region of regions.regions) {
      const [west, south, east, north] = region.bbox;
      await client.query(
        `
          INSERT INTO geohazard.regions (id, name, description, bbox)
          VALUES ($1, $2, $3, ST_MakeEnvelope($4, $5, $6, $7, 4326))
        `,
        [region.id, region.name, region.description, west, south, east, north]
      );
    }

    for (const asset of manifest) {
      await client.query(
        `
          INSERT INTO geohazard.data_assets (
            dataset_id, region_id, path, file_type, bytes, record_count,
            width, height, bands, crs, notes
          )
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
        `,
        [
          inferDatasetId(asset.path),
          inferRegionId(asset.path),
          normalizePath(asset.path),
          asset.type || path.extname(asset.path).replace('.', ''),
          toInteger(asset.bytes) ?? 0,
          toInteger(asset.record_count),
          toInteger(asset.width),
          toInteger(asset.height),
          toInteger(asset.bands),
          emptyToNull(asset.crs),
          emptyToNull(asset.notes)
        ]
      );

      if (asset.type === 'tif') {
        const regionId = inferRegionId(asset.path);
        await client.query(
          `
            INSERT INTO geohazard.raster_assets (
              dataset_name, region_id, time_slice, path, bytes, width, height, bands, crs, bbox
            )
            VALUES (
              $1,$2,$3,$4,$5,$6,$7,$8,$9,
              CASE WHEN $10::text IS NULL THEN NULL ELSE (SELECT bbox FROM geohazard.regions WHERE id = $10) END
            )
          `,
          [
            inferRasterDataset(asset.path),
            regionId,
            inferTimeSlice(asset.path),
            normalizePath(asset.path),
            toInteger(asset.bytes) ?? 0,
            toInteger(asset.width),
            toInteger(asset.height),
            toInteger(asset.bands),
            emptyToNull(asset.crs),
            regionId
          ]
        );
      }
    }

    for (const layer of geohazardLayerDefinitions) {
      const asset = manifest.find((row) => normalizePath(row.path).endsWith(normalizePath(layer.path)));
      await client.query(
        `
          INSERT INTO geohazard.layers (
            id, dataset_id, title, source, theme, region, geometry_type,
            path, color, description, record_count, bytes, available
          )
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
        `,
        [
          layer.id,
          layer.datasetId,
          layer.title,
          layer.source,
          layer.theme,
          layer.region,
          layer.geometryType,
          normalizePath(layer.path),
          layer.color,
          layer.description,
          toInteger(asset?.record_count) ?? 0,
          toInteger(asset?.bytes) ?? 0,
          Boolean(asset)
        ]
      );

      if (asset) {
        await importLayerFeatures(client, layer.id, layer.region, layer.path);
      }
    }

    await client.query('COMMIT');

    const counts = await client.query(`
      SELECT
        (SELECT COUNT(*)::int FROM geohazard.datasets) AS datasets,
        (SELECT COUNT(*)::int FROM geohazard.data_assets) AS assets,
        (SELECT COUNT(*)::int FROM geohazard.layers) AS layers,
        (SELECT COUNT(*)::int FROM geohazard.features) AS features,
        (SELECT COUNT(*)::int FROM geohazard.raster_assets) AS rasters
    `);

    console.log(JSON.stringify(counts.rows[0], null, 2));
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

async function importLayerFeatures(client: PoolClient, layerId: string, region: string, layerPath: string) {
  const collection = await readJsonFile<GeoJsonFeatureCollection>(layerPath);

  for (const feature of collection.features) {
    if (!feature.geometry) {
      continue;
    }

    const properties = feature.properties ?? {};
    await client.query(
      `
        INSERT INTO geohazard.features (
          layer_id, source_feature_id, event_id, event_date, title, category, trigger,
          region, admin_name, source_name, source_link, properties, geom
        )
        VALUES (
          $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb,
          ST_SetSRID(ST_GeomFromGeoJSON($13), 4326)
        )
      `,
      [
        layerId,
        toText(properties.objectid ?? properties.OBJECTID),
        toText(properties.event_id),
        normalizeDate(properties.event_date),
        toText(properties.event_title ?? properties.name_2 ?? properties.admin_name),
        toText(properties.landslide_category),
        toText(properties.landslide_trigger),
        region,
        toText(properties.admin_division_name ?? properties.name_2 ?? properties.admin_name),
        toText(properties.source_name),
        toText(properties.source_link),
        JSON.stringify(properties),
        JSON.stringify(feature.geometry)
      ]
    );
  }
}

async function readCsvFile(relativePath: string) {
  const content = await fs.readFile(resolveDataPath(relativePath), 'utf-8');
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

async function readJsonFile<T>(relativePath: string) {
  const content = await fs.readFile(resolveDataPath(relativePath), 'utf-8');
  return JSON.parse(content) as T;
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

function resolveDataPath(relativePath: string) {
  const normalized = normalizePath(relativePath).replace(/^data\/geohazards\/?/, '');
  return path.resolve(runtimePaths.geohazardsDataDir, normalized);
}

function inferDatasetId(filePath: string) {
  const normalized = normalizePath(filePath);
  if (normalized.includes('/coolr/') || normalized.includes('nasa_coolr')) return 'NASA_COOLR_EVENTS';
  if (normalized.includes('/lhasa_hazard/') || normalized.includes('/lhasa/')) return 'NASA_LHASA';
  if (normalized.includes('/susceptibility/')) return 'NASA_GLOBAL_SUSC';
  if (normalized.includes('/landsat/')) return 'USGS_LANDSAT_C2_L2';
  return null;
}

function inferRasterDataset(filePath: string) {
  const normalized = normalizePath(filePath);
  if (normalized.includes('/lhasa_hazard/')) return 'NASA LHASA Hazard';
  if (normalized.includes('/susceptibility/')) return 'NASA Global Landslide Susceptibility';
  return 'Raster Asset';
}

function inferRegionId(filePath: string) {
  const normalized = normalizePath(filePath);
  if (normalized.includes('southwest_core')) return 'china_southwest_core';
  if (normalized.includes('southwest_extended')) return 'china_southwest_extended';
  if (normalized.includes('northeast')) return 'china_northeast';
  return null;
}

function inferTimeSlice(filePath: string) {
  const normalized = normalizePath(filePath);
  if (normalized.includes('_yesterday_')) return 'yesterday';
  if (normalized.includes('_today_')) return 'today';
  if (normalized.includes('_tomorrow_')) return 'tomorrow';
  if (normalized.includes('susceptibility')) return 'static';
  return null;
}

function normalizeDate(value: unknown) {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return new Date(value).toISOString().slice(0, 10);
  }

  if (typeof value === 'string' && value.trim()) {
    const numeric = Number(value);
    if (Number.isFinite(numeric) && numeric > 10_000) {
      return new Date(numeric).toISOString().slice(0, 10);
    }

    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) {
      return parsed.toISOString().slice(0, 10);
    }
  }

  return null;
}

function toInteger(value: unknown) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.trunc(numeric) : null;
}

function toText(value: unknown) {
  if (value == null) {
    return null;
  }

  const text = String(value).trim();
  return text || null;
}

function emptyToNull(value: unknown) {
  return toText(value);
}

function normalizePath(value: string) {
  return value.replace(/\\/g, '/');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
