import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { listDomainEvents } from '../events';
import { authenticate, requireRoles } from '../guards';
import { listRuntimeMigrations } from '../migrations';

export async function systemRoutes(fastify: FastifyInstance) {
  fastify.get('/api/system/vision-config', { preHandler: authenticate }, async () => ({
    provider: fastify.appConfig.visionProvider,
    enabled: fastify.appConfig.visionProvider !== 'disabled' && fastify.appConfig.visionProvider !== 'deepseek',
    configured: Boolean(
      fastify.appConfig.visionProvider !== 'disabled' &&
        fastify.appConfig.visionProvider !== 'deepseek' &&
        fastify.appConfig.visionApiKey &&
        fastify.appConfig.visionBaseUrl &&
        fastify.appConfig.visionModel
    ),
    model: fastify.appConfig.visionModel ?? null,
    baseUrl: fastify.appConfig.visionBaseUrl ?? null,
    timeoutMs: fastify.appConfig.visionTimeoutMs
  }));

  fastify.get('/api/system/logs', { preHandler: authenticate }, async (request) => {
    const query = z.object({ category: z.string().optional() }).parse(request.query ?? {});
    const rows = query.category
      ? fastify.db
          .prepare(`
            SELECT id, category, level, message, created_at AS createdAt
            FROM system_logs
            WHERE category = ?
            ORDER BY created_at DESC
          `)
          .all(query.category)
      : fastify.db
          .prepare(`
            SELECT id, category, level, message, created_at AS createdAt
            FROM system_logs
            ORDER BY created_at DESC
          `)
          .all();

    return { items: rows };
  });

  fastify.get('/api/system/audit-logs', { preHandler: [authenticate, requireRoles('admin')] }, async (request) => {
    const query = z.object({ limit: z.coerce.number().optional() }).parse(request.query ?? {});
    const limit = Math.max(1, Math.min(100, Math.trunc(query.limit ?? 50)));
    const rows = fastify.db
      .prepare(`
        SELECT
          id,
          actor_id AS actorId,
          actor_name AS actorName,
          actor_role AS actorRole,
          action,
          entity_type AS entityType,
          entity_id AS entityId,
          summary,
          metadata_json AS metadataJson,
          request_id AS requestId,
          ip,
          user_agent AS userAgent,
          created_at AS createdAt
        FROM audit_logs
        ORDER BY created_at DESC, id DESC
        LIMIT ?
      `)
      .all(limit);

    return { items: rows };
  });

  fastify.get('/api/system/migrations', { preHandler: [authenticate, requireRoles('admin')] }, async () => ({
    items: listRuntimeMigrations(fastify.db)
  }));

  fastify.get('/api/system/domain-events', { preHandler: [authenticate, requireRoles('admin')] }, async (request) => {
    const query = z.object({ limit: z.coerce.number().optional() }).parse(request.query ?? {});
    const limit = Math.max(1, Math.min(100, Math.trunc(query.limit ?? 50)));
    return { items: listDomainEvents(fastify, limit) };
  });
}
