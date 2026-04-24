import 'fastify';
import '@fastify/jwt';
import Database from 'better-sqlite3';

declare module 'fastify' {
  interface FastifyInstance {
    db: Database.Database;
    appConfig: {
      port: number;
      host: string;
      jwtSecret: string;
      oidcEnabled: boolean;
      oidcIssuer?: string;
      oidcClientId?: string;
      oidcRedirectUri?: string;
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

