CREATE EXTENSION IF NOT EXISTS postgis;

CREATE SCHEMA IF NOT EXISTS geohazard;

CREATE TABLE IF NOT EXISTS geohazard.datasets (
  id TEXT PRIMARY KEY,
  theme TEXT NOT NULL,
  product_short_name TEXT,
  source TEXT NOT NULL,
  platform TEXT,
  resolution TEXT,
  temporal_coverage TEXT,
  recommended_region TEXT,
  project_use TEXT,
  priority TEXT,
  access_url TEXT,
  notes TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS geohazard.regions (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT NOT NULL,
  bbox GEOMETRY(POLYGON, 4326) NOT NULL
);

CREATE TABLE IF NOT EXISTS geohazard.data_assets (
  id BIGSERIAL PRIMARY KEY,
  dataset_id TEXT,
  region_id TEXT,
  path TEXT NOT NULL UNIQUE,
  file_type TEXT NOT NULL,
  bytes BIGINT NOT NULL DEFAULT 0,
  record_count INTEGER,
  width INTEGER,
  height INTEGER,
  bands INTEGER,
  crs TEXT,
  notes TEXT,
  imported_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  FOREIGN KEY(dataset_id) REFERENCES geohazard.datasets(id) ON DELETE SET NULL,
  FOREIGN KEY(region_id) REFERENCES geohazard.regions(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS geohazard.layers (
  id TEXT PRIMARY KEY,
  dataset_id TEXT,
  title TEXT NOT NULL,
  source TEXT NOT NULL,
  theme TEXT NOT NULL,
  region TEXT NOT NULL,
  geometry_type TEXT NOT NULL CHECK (geometry_type IN ('point', 'polygon')),
  path TEXT NOT NULL,
  color TEXT NOT NULL,
  description TEXT NOT NULL,
  record_count INTEGER NOT NULL DEFAULT 0,
  bytes BIGINT NOT NULL DEFAULT 0,
  available BOOLEAN NOT NULL DEFAULT true,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  FOREIGN KEY(dataset_id) REFERENCES geohazard.datasets(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS geohazard.features (
  id BIGSERIAL PRIMARY KEY,
  layer_id TEXT NOT NULL REFERENCES geohazard.layers(id) ON DELETE CASCADE,
  source_feature_id TEXT,
  event_id TEXT,
  event_date DATE,
  title TEXT,
  category TEXT,
  trigger TEXT,
  region TEXT,
  admin_name TEXT,
  source_name TEXT,
  source_link TEXT,
  properties JSONB NOT NULL DEFAULT '{}'::jsonb,
  geom GEOMETRY(GEOMETRY, 4326) NOT NULL,
  centroid GEOMETRY(POINT, 4326) GENERATED ALWAYS AS (ST_PointOnSurface(geom)) STORED
);

CREATE TABLE IF NOT EXISTS geohazard.raster_assets (
  id BIGSERIAL PRIMARY KEY,
  dataset_name TEXT NOT NULL,
  region_id TEXT,
  time_slice TEXT,
  path TEXT NOT NULL UNIQUE,
  bytes BIGINT NOT NULL DEFAULT 0,
  width INTEGER,
  height INTEGER,
  bands INTEGER,
  crs TEXT,
  bbox GEOMETRY(POLYGON, 4326),
  imported_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  FOREIGN KEY(region_id) REFERENCES geohazard.regions(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_geohazard_features_geom ON geohazard.features USING GIST (geom);
CREATE INDEX IF NOT EXISTS idx_geohazard_features_centroid ON geohazard.features USING GIST (centroid);
CREATE INDEX IF NOT EXISTS idx_geohazard_features_layer ON geohazard.features(layer_id);
CREATE INDEX IF NOT EXISTS idx_geohazard_features_event_date ON geohazard.features(event_date);
CREATE INDEX IF NOT EXISTS idx_geohazard_features_properties ON geohazard.features USING GIN (properties);
CREATE INDEX IF NOT EXISTS idx_geohazard_raster_assets_bbox ON geohazard.raster_assets USING GIST (bbox);
