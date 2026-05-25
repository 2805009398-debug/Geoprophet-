import { FastifyInstance } from 'fastify';
import { authenticate } from '../guards';
import { analyzeUpload, listAnalysisRuns } from '../services/hazard-analysis';

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

  fastify.get('/api/analysis/runs', { preHandler: authenticate }, async (request) => {
    const query = request.query as { limit?: string | number };
    const limitValue = Number(query.limit ?? 10);
    const limit = Number.isFinite(limitValue) ? Math.max(1, Math.min(20, Math.trunc(limitValue))) : 10;
    return { items: listAnalysisRuns(fastify, limit) };
  });

  fastify.post('/api/analysis/landslide', { preHandler: authenticate }, async (request, reply) => {
    const file = await request.file();
    if (!file) {
      return reply.code(400).send({ message: '请上传待识别的滑坡照片。' });
    }

    const result = await analyzeUpload(fastify, 'landslide', file);
    return reply.code(201).send(result);
  });

  fastify.post('/api/analysis/glacier', { preHandler: authenticate }, async (request, reply) => {
    const file = await request.file();
    if (!file) {
      return reply.code(400).send({ message: '请上传 InSAR 冰川影像。' });
    }

    const result = await analyzeUpload(fastify, 'glacier', file);
    return reply.code(201).send(result);
  });
}
