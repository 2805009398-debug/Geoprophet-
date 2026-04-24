import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { authenticate } from '../guards';

export async function systemRoutes(fastify: FastifyInstance) {
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
}

