import path from 'node:path';

const appRoot = path.resolve(__dirname, '..');
const projectRoot = path.resolve(appRoot, '..');
const appMode = parseAppMode(process.env.APP_MODE);
const fallbackJwtSecret = 'geoprophet-demo-secret';
const jwtSecret = process.env.JWT_SECRET ?? (appMode === 'demo' ? fallbackJwtSecret : '');
const corsOrigins = listFromEnv(process.env.CORS_ORIGINS);
const aiInferenceBaseUrl = process.env.AI_INFERENCE_BASE_URL?.trim();
const visionProvider = parseVisionProvider(process.env.VISION_PROVIDER);
const visionApiKey = resolveVisionApiKey(visionProvider);
const visionBaseUrl = resolveVisionBaseUrl(visionProvider);
const visionModel = process.env.VISION_MODEL?.trim();
const visionChatEndpoint = process.env.VISION_CHAT_ENDPOINT?.trim() || 'chat/completions';
const postgisDatabaseUrl = process.env.POSTGIS_DATABASE_URL?.trim() || process.env.DATABASE_URL?.trim();
const sqliteJournalMode = parseSqliteJournalMode(process.env.SQLITE_JOURNAL_MODE);
const remoteSensingProducts = listFromEnv(process.env.REMOTE_SENSING_PRODUCTS);
const remoteSensingRegions = listFromEnv(process.env.REMOTE_SENSING_REGIONS);
const geeTileUrlTemplate = process.env.GEE_TILE_URL_TEMPLATE?.trim();
const geeLayerTitle = process.env.GEE_LAYER_TITLE?.trim() || 'Google Earth Engine 影像图层';
const geeAttribution = process.env.GEE_ATTRIBUTION?.trim() || 'Google Earth Engine';
const unsafeJwtSecrets = new Set([
  fallbackJwtSecret,
  'change-this-to-a-long-random-secret',
  'replace-with-at-least-32-random-characters'
]);

function parseAppMode(value: string | undefined): 'demo' | 'production' {
  if (!value || !value.trim()) {
    return 'demo';
  }

  const normalized = value.trim().toLowerCase();
  if (normalized === 'demo' || normalized === 'production') {
    return normalized;
  }

  throw new Error('APP_MODE 只能配置为 demo 或 production。');
}

function parseSqliteJournalMode(value: string | undefined): 'wal' | 'delete' {
  if (!value || !value.trim()) {
    return 'wal';
  }

  const normalized = value.trim().toLowerCase();
  if (normalized === 'wal' || normalized === 'delete') {
    return normalized;
  }

  throw new Error('SQLITE_JOURNAL_MODE 只能配置为 wal 或 delete。');
}

function parseVisionProvider(value: string | undefined): 'disabled' | 'doubao' | 'openai-compatible' | 'deepseek' {
  if (!value || !value.trim()) {
    return 'disabled';
  }

  const normalized = value.trim().toLowerCase();
  if (
    normalized === 'disabled' ||
    normalized === 'doubao' ||
    normalized === 'openai-compatible' ||
    normalized === 'deepseek'
  ) {
    return normalized;
  }

  throw new Error('VISION_PROVIDER 只能配置为 disabled、doubao、openai-compatible 或 deepseek。');
}

function resolveVisionApiKey(provider: 'disabled' | 'doubao' | 'openai-compatible' | 'deepseek') {
  if (provider === 'disabled') {
    return undefined;
  }

  if (provider === 'doubao') {
    return process.env.VISION_API_KEY?.trim() || process.env.ARK_API_KEY?.trim() || process.env.DOUBAO_API_KEY?.trim();
  }

  if (provider === 'deepseek') {
    return process.env.VISION_API_KEY?.trim() || process.env.DEEPSEEK_API_KEY?.trim();
  }

  return process.env.VISION_API_KEY?.trim();
}

function resolveVisionBaseUrl(provider: 'disabled' | 'doubao' | 'openai-compatible' | 'deepseek') {
  const configured = process.env.VISION_BASE_URL?.trim();
  if (configured) {
    return configured;
  }

  if (provider === 'doubao') {
    return 'https://ark.cn-beijing.volces.com/api/v3';
  }

  if (provider === 'deepseek') {
    return 'https://api.deepseek.com';
  }

  return undefined;
}

if (appMode === 'production') {
  if (!jwtSecret || jwtSecret.length < 32 || unsafeJwtSecrets.has(jwtSecret)) {
    throw new Error('生产模式必须配置至少 32 位的安全 JWT_SECRET，不能使用演示密钥或模板占位值。');
  }

  if (corsOrigins.length === 0) {
    throw new Error('生产模式必须配置 CORS_ORIGINS 白名单，例如 https://example.com。');
  }

  if (!aiInferenceBaseUrl) {
    throw new Error('生产模式必须配置 AI_INFERENCE_BASE_URL，禁止使用 mock AI 识别结果。');
  }
}

if (visionProvider !== 'disabled' && visionProvider !== 'deepseek') {
  if (!visionApiKey) {
    throw new Error('启用视觉大模型时必须配置 VISION_API_KEY，或配置对应供应商的 API Key 环境变量。');
  }

  if (!visionBaseUrl) {
    throw new Error('启用视觉大模型时必须配置 VISION_BASE_URL。');
  }

  if (!visionModel) {
    throw new Error('启用视觉大模型时必须配置 VISION_MODEL。');
  }
}

function numberFromEnv(value: string | undefined, fallback: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function integerFromEnv(value: string | undefined, fallback: number, min = 0) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }

  const integer = Math.trunc(parsed);
  return integer >= min ? integer : fallback;
}

function booleanFromEnv(value: string | undefined, fallback: boolean) {
  if (value == null) {
    return fallback;
  }

  return ['1', 'true', 'yes', 'on'].includes(value.trim().toLowerCase());
}

function listFromEnv(value: string | undefined) {
  return value
    ? value.split(',').map((item) => item.trim()).filter(Boolean)
    : [];
}

export const runtimePaths = {
  appRoot,
  projectRoot,
  dbPath: process.env.DATABASE_PATH
    ? path.resolve(process.env.DATABASE_PATH)
    : path.join(appRoot, 'data', 'geoprophet.db'),
  initSqlPath: path.join(appRoot, 'db', 'init.sql'),
  uploadsDir: path.join(appRoot, 'uploads'),
  analysisUploadsDir: path.join(appRoot, 'uploads', 'analysis'),
  geohazardsDataDir: process.env.GEOHAZARDS_DATA_DIR
    ? path.resolve(process.env.GEOHAZARDS_DATA_DIR)
    : path.join(projectRoot, 'data', 'geohazards')
};

export const appConfig = {
  appMode,
  port: Number(process.env.PORT ?? 3000),
  host: process.env.HOST ?? '0.0.0.0',
  sqliteJournalMode,
  trustProxy: booleanFromEnv(process.env.TRUST_PROXY, false),
  corsOrigins,
  jwtSecret,
  exposeDemoAccounts: appMode === 'demo',
  initialAdminUsername: process.env.INITIAL_ADMIN_USERNAME?.trim(),
  initialAdminPassword: process.env.INITIAL_ADMIN_PASSWORD,
  initialAdminDisplayName: process.env.INITIAL_ADMIN_DISPLAY_NAME?.trim(),
  oidcEnabled: Boolean(process.env.OIDC_ISSUER && process.env.OIDC_CLIENT_ID),
  oidcIssuer: process.env.OIDC_ISSUER,
  oidcClientId: process.env.OIDC_CLIENT_ID,
  oidcRedirectUri: process.env.OIDC_REDIRECT_URI,
  aiInferenceBaseUrl,
  aiLandslideEndpoint: process.env.AI_LANDSLIDE_ENDPOINT ?? '/predict/landslide',
  aiInferenceTimeoutMs: numberFromEnv(process.env.AI_INFERENCE_TIMEOUT_MS, 30_000),
  visionProvider,
  visionApiKey,
  visionBaseUrl,
  visionModel,
  visionChatEndpoint,
  visionTimeoutMs: numberFromEnv(process.env.VISION_TIMEOUT_MS, 90_000),
  postgisDatabaseUrl,
  geohazardsPreferPostgis: booleanFromEnv(process.env.GEOHAZARDS_PREFER_POSTGIS, Boolean(postgisDatabaseUrl)),
  postgisConnectionTimeoutMs: numberFromEnv(process.env.POSTGIS_CONNECTION_TIMEOUT_MS, 2_000),
  healthCheckTimeoutMs: numberFromEnv(process.env.HEALTH_CHECK_TIMEOUT_MS, 2_000),
  rateLimitWindowMs: numberFromEnv(process.env.RATE_LIMIT_WINDOW_MS, 5 * 60 * 1000),
  authRateLimitMax: numberFromEnv(process.env.AUTH_RATE_LIMIT_MAX, 20),
  publicRateLimitMax: numberFromEnv(process.env.PUBLIC_RATE_LIMIT_MAX, 60),
  analysisRateLimitMax: numberFromEnv(process.env.ANALYSIS_RATE_LIMIT_MAX, 20),
  remoteSensingSyncEnabled: booleanFromEnv(process.env.REMOTE_SENSING_SYNC_ENABLED, true),
  remoteSensingSyncOnStart: booleanFromEnv(process.env.REMOTE_SENSING_SYNC_ON_START, true),
  remoteSensingSyncIntervalHours: numberFromEnv(process.env.REMOTE_SENSING_SYNC_INTERVAL_HOURS, 24),
  remoteSensingLagDays: integerFromEnv(process.env.REMOTE_SENSING_LAG_DAYS, 1),
  remoteSensingMaxImageWidth: integerFromEnv(process.env.REMOTE_SENSING_MAX_IMAGE_WIDTH, 1280, 256),
  remoteSensingRequestTimeoutMs: numberFromEnv(process.env.REMOTE_SENSING_REQUEST_TIMEOUT_MS, 45_000),
  remoteSensingGibsEndpoint:
    process.env.REMOTE_SENSING_GIBS_ENDPOINT?.trim() ||
    'https://gibs.earthdata.nasa.gov/wms/epsg4326/best/wms.cgi',
  remoteSensingProducts,
  remoteSensingRegions,
  geeEnabled: booleanFromEnv(process.env.GEE_ENABLED, Boolean(geeTileUrlTemplate)),
  geeTileUrlTemplate,
  geeLayerTitle,
  geeAttribution,
  geeOpacity: Math.min(Math.max(Number(process.env.GEE_OPACITY ?? 0.72), 0.05), 1),
  geeMinZoom: integerFromEnv(process.env.GEE_MIN_ZOOM, 3, 0),
  geeMaxZoom: integerFromEnv(process.env.GEE_MAX_ZOOM, 14, 1)
};
