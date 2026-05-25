import path from 'node:path';

const appRoot = path.resolve(__dirname, '..');

export const runtimePaths = {
  appRoot,
  dbPath: path.join(appRoot, 'data', 'geoprophet.db'),
  initSqlPath: path.join(appRoot, 'db', 'init.sql'),
  uploadsDir: path.join(appRoot, 'uploads'),
  analysisUploadsDir: path.join(appRoot, 'uploads', 'analysis')
};

export const appConfig = {
  port: Number(process.env.PORT ?? 3000),
  host: process.env.HOST ?? '0.0.0.0',
  jwtSecret: process.env.JWT_SECRET ?? 'geoprophet-demo-secret',
  oidcEnabled: Boolean(process.env.OIDC_ISSUER && process.env.OIDC_CLIENT_ID),
  oidcIssuer: process.env.OIDC_ISSUER,
  oidcClientId: process.env.OIDC_CLIENT_ID,
  oidcRedirectUri: process.env.OIDC_REDIRECT_URI,
  aiInferenceBaseUrl: process.env.AI_INFERENCE_BASE_URL,
  aiLandslideEndpoint: process.env.AI_LANDSLIDE_ENDPOINT ?? '/predict/landslide',
  aiGlacierEndpoint: process.env.AI_GLACIER_ENDPOINT ?? '/predict/glacier'
};
