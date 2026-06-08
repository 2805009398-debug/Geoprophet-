import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { writeAuditLog } from '../audit';
import { badRequest } from '../errors';
import { emitDomainEvent } from '../events';
import { authenticate, requireRoles } from '../guards';

const createAlertSchema = z.object({
  siteId: z.coerce.number(),
  title: z.string().trim().min(2),
  severity: z.enum(['low', 'medium', 'high', 'critical']),
  source: z.string().trim().min(2),
  description: z.string().trim().min(4),
  recommendedAction: z.string().trim().min(4)
});

export async function alertRoutes(fastify: FastifyInstance) {
  fastify.get('/api/alerts', { preHandler: authenticate }, async (request) => {
    const query = z.object({ severity: z.string().optional(), status: z.string().optional() }).parse(request.query ?? {});
    const conditions: string[] = [];
    const params: unknown[] = [];

    if (query.severity) {
      conditions.push('a.severity = ?');
      params.push(query.severity);
    }
    if (query.status) {
      conditions.push('a.status = ?');
      params.push(query.status);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const rows = fastify.db
      .prepare(`
        SELECT
          a.id,
          a.title,
          a.severity,
          a.status,
          a.source,
          a.description,
          a.recommended_action AS recommendedAction,
          a.created_at AS createdAt,
          a.acknowledged_at AS acknowledgedAt,
          s.name AS siteName,
          s.district
        FROM alerts a
        JOIN sites s ON s.id = a.site_id
        ${whereClause}
        ORDER BY a.created_at DESC
      `)
      .all(...params);

    return { items: rows };
  });

  fastify.post('/api/alerts', { preHandler: [authenticate, requireRoles('admin', 'operator', 'expert')] }, async (request, reply) => {
    const parsed = createAlertSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ message: '预警参数不完整。', requestId: request.id });
    }

    const site = fastify.db.prepare('SELECT id FROM sites WHERE id = ?').get(parsed.data.siteId);
    if (!site) {
      throw badRequest('监测点不存在，不能创建预警。');
    }

    const now = new Date().toISOString().slice(0, 19).replace('T', ' ');
    const result = fastify.db
      .prepare(`
        INSERT INTO alerts (site_id, title, severity, status, source, description, created_at, recommended_action)
        VALUES (@siteId, @title, @severity, 'active', @source, @description, @createdAt, @recommendedAction)
      `)
      .run({ ...parsed.data, createdAt: now });

    writeAuditLog(fastify, request, {
      action: 'alert.created',
      entityType: 'alert',
      entityId: String(result.lastInsertRowid),
      summary: `新增预警：${parsed.data.title}`,
      metadata: {
        siteId: parsed.data.siteId,
        severity: parsed.data.severity,
        source: parsed.data.source
      }
    });
    emitDomainEvent(fastify, request, {
      eventType: 'alert.created',
      aggregateType: 'alert',
      aggregateId: String(result.lastInsertRowid),
      payload: {
        siteId: parsed.data.siteId,
        title: parsed.data.title,
        severity: parsed.data.severity,
        status: 'active'
      }
    });

    return reply.code(201).send({ id: result.lastInsertRowid });
  });

  fastify.patch('/api/alerts/:id/ack', { preHandler: [authenticate, requireRoles('admin', 'operator', 'expert')] }, async (request, reply) => {
    const params = z.object({ id: z.coerce.number() }).parse(request.params);
    const now = new Date().toISOString().slice(0, 19).replace('T', ' ');
    const result = fastify.db
      .prepare(`UPDATE alerts SET status = 'acknowledged', acknowledged_at = ? WHERE id = ?`)
      .run(now, params.id);

    if (result.changes === 0) {
      return reply.code(404).send({ message: '预警不存在。', requestId: request.id });
    }

    writeAuditLog(fastify, request, {
      action: 'alert.acknowledged',
      entityType: 'alert',
      entityId: params.id,
      summary: '确认预警。',
      metadata: { acknowledgedAt: now }
    });
    emitDomainEvent(fastify, request, {
      eventType: 'alert.acknowledged',
      aggregateType: 'alert',
      aggregateId: params.id,
      payload: { acknowledgedAt: now }
    });

    return { success: true };
  });
}
