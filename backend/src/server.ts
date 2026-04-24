import cors from '@fastify/cors';
import jwt from '@fastify/jwt';
import multipart from '@fastify/multipart';
import fastifyStatic from '@fastify/static';
import Fastify from 'fastify';
import { appConfig, runtimePaths } from './config';
import { createDatabase } from './db';
import { alertRoutes } from './routes/alerts';
import { analysisRoutes } from './routes/analysis';
import { authRoutes } from './routes/auth';
import { dashboardRoutes } from './routes/dashboard';
import { docsRoutes } from './routes/docs';
import { planRoutes } from './routes/plans';
import { reportRoutes } from './routes/reports';
import { siteRoutes } from './routes/sites';
import { systemRoutes } from './routes/system';

async function bootstrap() {
  const server = Fastify({ logger: true });
  server.decorate('db', createDatabase());
  server.decorate('appConfig', appConfig);

  await server.register(cors, { origin: true, credentials: true });
  await server.register(jwt, { secret: appConfig.jwtSecret });
  await server.register(multipart, {
    limits: {
      fileSize: 10 * 1024 * 1024,
      files: 1
    }
  });
  await server.register(fastifyStatic, {
    root: runtimePaths.uploadsDir,
    prefix: '/uploads/'
  });

  server.get('/api/health', async () => ({ status: 'ok', service: 'geoprophet-api' }));

  await authRoutes(server);
  await dashboardRoutes(server);
  await siteRoutes(server);
  await alertRoutes(server);
  await reportRoutes(server);
  await analysisRoutes(server);
  await planRoutes(server);
  await systemRoutes(server);
  await docsRoutes(server);

  server.setErrorHandler((error, _request, reply) => {
    server.log.error(error);
    reply.code(500).send({ message: '服务端发生异常，请稍后重试。' });
  });

  await server.listen({ port: appConfig.port, host: appConfig.host });
}

bootstrap().catch((error) => {
  console.error(error);
  process.exit(1);
});

