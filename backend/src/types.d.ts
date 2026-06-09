import 'fastify';
import '@fastify/jwt';
import Database from 'better-sqlite3';

declare module 'fastify' {
  interface FastifyInstance {
    db: Database.Database;
    appConfig: {
      appMode: 'demo' | 'production';
      port: number;
      host: string;
      sqliteJournalMode: 'wal' | 'delete';
      trustProxy: boolean;
      corsOrigins: string[];
      jwtSecret: string;
      exposeDemoAccounts: boolean;
      initialAdminUsername?: string;
      initialAdminPassword?: string;
      initialAdminDisplayName?: string;
      oidcEnabled: boolean;
      oidcIssuer?: string;
      oidcClientId?: string;
      oidcRedirectUri?: string;
      aiInferenceBaseUrl?: string;
      aiLandslideEndpoint: string;
      aiInferenceTimeoutMs: number;
      visionProvider: 'disabled' | 'doubao' | 'openai-compatible' | 'deepseek';
      visionApiKey?: string;
      visionBaseUrl?: string;
      visionModel?: string;
      visionChatEndpoint: string;
      visionTimeoutMs: number;
      postgisDatabaseUrl?: string;
      geohazardsPreferPostgis: boolean;
      postgisConnectionTimeoutMs: number;
      healthCheckTimeoutMs: number;
      rateLimitWindowMs: number;
      authRateLimitMax: number;
      publicRateLimitMax: number;
      analysisRateLimitMax: number;
      remoteSensingSyncEnabled: boolean;
      remoteSensingSyncOnStart: boolean;
      remoteSensingSyncIntervalHours: number;
      remoteSensingLagDays: number;
      remoteSensingMaxImageWidth: number;
      remoteSensingRequestTimeoutMs: number;
      remoteSensingGibsEndpoint: string;
      remoteSensingProducts: string[];
      remoteSensingRegions: string[];
      geeEnabled: boolean;
      geeTileUrlTemplate?: string;
      geeLayerTitle: string;
      geeAttribution: string;
      geeOpacity: number;
      geeMinZoom: number;
      geeMaxZoom: number;
    };
  }
}

declare module '@fastify/jwt' {
  interface FastifyJWT {
    payload: {
      sub: number;
      username: string;
      role: string;
      name: string;
    };
    user: {
      sub: number;
      username: string;
      role: string;
      name: string;
    };
  }
}
