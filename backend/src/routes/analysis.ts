import { FastifyInstance } from 'fastify';
import { authenticate } from '../guards';

export async function analysisRoutes(fastify: FastifyInstance) {
  fastify.get('/api/analysis/models', { preHandler: authenticate }, async () => {
    const items = fastify.db
      .prepare(`
        SELECT id, name, category, version, accuracy, status, last_run_at AS lastRunAt, summary
        FROM analysis_models
        ORDER BY accuracy DESC, name
      `)
      .all();

    return { items };
  });

  fastify.get('/api/analysis/assessments', { preHandler: authenticate }, async () => {
    const items = fastify.db
      .prepare(`
        SELECT
          a.id,
          s.name AS siteName,
          s.district,
          a.level,
          a.population_affected AS populationAffected,
          a.economic_loss AS economicLoss,
          a.road_impact AS roadImpact,
          a.summary,
          a.created_at AS createdAt
        FROM assessments a
        JOIN sites s ON s.id = a.site_id
        ORDER BY a.created_at DESC
      `)
      .all();

    return { items };
  });
}

