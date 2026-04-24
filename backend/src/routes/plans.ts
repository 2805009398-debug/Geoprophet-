import { FastifyInstance } from 'fastify';
import { authenticate } from '../guards';

export async function planRoutes(fastify: FastifyInstance) {
  fastify.get('/api/plans', { preHandler: authenticate }, async () => {
    const items = fastify.db
      .prepare(`
        SELECT
          id,
          title,
          level,
          status,
          leader,
          summary,
          resource_summary AS resourceSummary,
          updated_at AS updatedAt
        FROM emergency_plans
        ORDER BY
          CASE level
            WHEN 'I级' THEN 1
            WHEN 'II级' THEN 2
            WHEN 'III级' THEN 3
            ELSE 4
          END,
          updated_at DESC
      `)
      .all();

    return { items };
  });
}

