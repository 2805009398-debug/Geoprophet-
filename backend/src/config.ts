import path from 'node:path';

const appRoot = path.resolve(__dirname, '..');

export const runtimePaths = {
  appRoot,
  dbPath: path.join(appRoot, 'data', 'geoprophet.db'),
  initSqlPath: path.join(appRoot, 'db', 'init.sql'),
  uploadsDir: path.join(appRoot, 'uploads')
};

export const appConfig = {
  port: Number(process.env.PORT ?? 3000),
  host: process.env.HOST ?? '0.0.0.0',
  jwtSecret: process.env.JWT_SECRET ?? 'geoprophet-demo-secret',
  oidcEnabled: Boolean(process.env.OIDC_ISSUER && process.env.OIDC_CLIENT_ID),
  oidcIssuer: process.env.OIDC_ISSUER,
  oidcClientId: process.env.OIDC_CLIENT_ID,
  oidcRedirectUri: process.env.OIDC_REDIRECT_URI
};

