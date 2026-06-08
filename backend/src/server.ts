import { randomUUID } from 'node:crypto';
import cors from '@fastify/cors';
import jwt from '@fastify/jwt';
import multipart from '@fastify/multipart';
import fastifyStatic from '@fastify/static';
import Fastify from 'fastify';
import { appConfig, runtimePaths } from './config';
import { createDatabase } from './db';
import { HttpError, isZodError } from './errors';
import { getHealthSnapshot } from './health';
import { alertRoutes } from './routes/alerts';
import { analysisRoutes } from './routes/analysis';
import { authRoutes } from './routes/auth';
import { dashboardRoutes } from './routes/dashboard';
import { docsRoutes } from './routes/docs';
import { geohazardRoutes } from './routes/geohazards';
import { landslideSampleRoutes } from './routes/landslide-samples';
import { monitoringRoutes } from './routes/monitoring';
import { reportRoutes } from './routes/reports';
import { siteRoutes } from './routes/sites';
import { systemRoutes } from './routes/system';

async function bootstrap() {
  const server = Fastify({
    logger: true,
    trustProxy: appConfig.trustProxy,
    genReqId: (request) => {
      const requestId = request.headers['x-request-id'];
      return typeof requestId === 'string' && requestId.trim()
        ? requestId.slice(0, 128)
        : randomUUID();
    }
  });
  server.decorate('db', createDatabase());
  server.decorate('appConfig', appConfig);

  await server.register(cors, {
    origin: getCorsOrigins(),
    credentials: true
  });
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

  server.addHook('onRequest', async (request, reply) => {
    reply.header('x-request-id', request.id);
    reply.header('x-content-type-options', 'nosniff');
    reply.header('x-frame-options', 'DENY');
    reply.header('referrer-policy', 'no-referrer');
    reply.header('permissions-policy', 'camera=(self), microphone=(), geolocation=(self)');
  });

  server.get('/', async () => ({
    status: 'ok',
    service: 'geoprophet-api',
    message: 'HiCool backend is running.',
    health: '/api/health',
    docs: '/api/docs'
  }));

  server.get('/api', async () => ({
    status: 'ok',
    service: 'geoprophet-api',
    message: 'HiCool API is running.',
    health: '/api/health',
    docs: '/api/docs',
    frontend: 'http://127.0.0.1:5174'
  }));

  server.get('/api/health', async (_request, reply) => {
    const snapshot = await getHealthSnapshot(server);
    if (snapshot.status === 'degraded') {
      return reply.code(503).send(snapshot);
    }

    return snapshot;
  });

  await authRoutes(server);
  await dashboardRoutes(server);
  await siteRoutes(server);
  await alertRoutes(server);
  await reportRoutes(server);
  await analysisRoutes(server);
  await geohazardRoutes(server);
  await landslideSampleRoutes(server);
  await monitoringRoutes(server);
  await systemRoutes(server);
  await docsRoutes(server);

  server.setErrorHandler((error, request, reply) => {
    server.log.error(error);
    const errorCode =
      typeof error === 'object' && error !== null && 'code' in error
        ? (error as { code?: string }).code
        : undefined;
    const httpStatusCode =
      typeof error === 'object' && error !== null && 'statusCode' in error
        ? (error as { statusCode?: unknown }).statusCode
        : undefined;
    const errorMessage = error instanceof Error ? error.message : 'request-error';

    if (error instanceof HttpError) {
      return reply.code(error.statusCode).send({ message: error.message, requestId: request.id });
    }

    if (isZodError(error)) {
      return reply.code(400).send({ message: '请求参数格式不正确。', requestId: request.id });
    }

    if (errorCode === 'FST_REQ_FILE_TOO_LARGE') {
      return reply.code(413).send({ message: '上传文件不能超过 10MB。', requestId: request.id });
    }

    if (errorCode === 'SQLITE_CONSTRAINT_FOREIGNKEY') {
      return reply.code(400).send({ message: '关联数据不存在或已被删除。', requestId: request.id });
    }

    if (typeof httpStatusCode === 'number' && httpStatusCode >= 400 && httpStatusCode < 500) {
      return reply.code(httpStatusCode).send({
        message: httpStatusCode === 415 ? '请求 Content-Type 不受支持。' : errorMessage,
        requestId: request.id
      });
    }

    reply.code(500).send({ message: '服务端发生异常，请稍后重试。', requestId: request.id });
  });

  await server.listen({ port: appConfig.port, host: appConfig.host });
}

function getCorsOrigins() {
  if (appConfig.appMode !== 'production') {
    return true;
  }

  return appConfig.corsOrigins;
}

bootstrap().catch((error) => {
  console.error(error);
  process.exit(1);
});
