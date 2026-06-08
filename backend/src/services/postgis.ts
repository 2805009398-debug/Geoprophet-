import { Pool } from 'pg';
import { appConfig } from '../config';

let pool: Pool | null = null;

export function getPostgisPool() {
  if (!appConfig.postgisDatabaseUrl) {
    return null;
  }

  if (!pool) {
    pool = new Pool({
      connectionString: appConfig.postgisDatabaseUrl,
      max: 8,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: appConfig.postgisConnectionTimeoutMs
    });
  }

  return pool;
}
