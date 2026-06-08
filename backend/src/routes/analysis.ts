import { FastifyInstance } from 'fastify';
import { writeAuditLog } from '../audit';
import { emitDomainEvent } from '../events';
import { authenticate, requireRoles } from '../guards';
import { createRateLimiter } from '../rate-limit';
import { analyzeMobileImageUpload, analyzeUpload, listAnalysisRuns } from '../services/hazard-analysis';
import type { HazardPrediction } from '../services/hazard-analysis';

export async function analysisRoutes(fastify: FastifyInstance) {
  const analysisRateLimit = createRateLimiter({
    keyPrefix: 'analysis-run',
    windowMs: fastify.appConfig.rateLimitWindowMs,
    max: fastify.appConfig.analysisRateLimitMax,
    message: '识别任务提交过于频繁，请稍后再试。'
  });

  fastify.get('/api/analysis/models', { preHandler: authenticate }, async () => {
    const items = fastify.db
      .prepare(`
        SELECT id, name, category, version, accuracy, status, last_run_at AS lastRunAt, summary
        FROM analysis_models
        WHERE category <> '冰川识别' AND name <> 'GlacierSAR-Net'
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

  fastify.post('/api/analysis/landslide', { preHandler: [authenticate, requireRoles('admin', 'operator', 'expert'), analysisRateLimit] }, async (request, reply) => {
    const file = await request.file();
    if (!file) {
      return reply.code(400).send({ message: '请上传待识别的滑坡照片。', requestId: request.id });
    }

    const result = await analyzeUpload(fastify, 'landslide', file);
    recordAnalysisCompleted(fastify, request, result);
    return reply.code(201).send(result);
  });

  fastify.post('/api/analysis/mobile-image', { preHandler: [authenticate, requireRoles('admin', 'operator', 'expert'), analysisRateLimit] }, async (request, reply) => {
    const file = await request.file();
    if (!file) {
      return reply.code(400).send({ message: '请上传移动端巡查图片。', requestId: request.id });
    }

    const result = await analyzeMobileImageUpload(fastify, 'landslide', file);
    recordAnalysisCompleted(fastify, request, result);
    return reply.code(201).send(result);
  });

  fastify.post('/api/analysis/glacier', { preHandler: [authenticate, requireRoles('admin', 'operator', 'expert')] }, async (request, reply) => {
    return reply.code(410).send({ message: '冰川识别功能已取消。', requestId: request.id });
  });
}

function recordAnalysisCompleted(
  fastify: FastifyInstance,
  request: Parameters<typeof writeAuditLog>[1],
  result: HazardPrediction
) {
  writeAuditLog(fastify, request, {
    action: 'analysis.completed',
    entityType: 'analysis_run',
    entityId: result.id,
    summary: '滑坡识别任务完成。',
    metadata: {
      taskType: result.taskType,
      provider: result.provider,
      modelName: result.modelName,
      confidence: result.confidence,
      sourceName: result.sourceName
    }
  });
  emitDomainEvent(fastify, request, {
    eventType: 'analysis.completed',
    aggregateType: 'analysis_run',
    aggregateId: result.id ?? '',
    payload: {
      taskType: result.taskType,
      provider: result.provider,
      modelName: result.modelName,
      confidence: result.confidence,
      sourceName: result.sourceName
    }
  });
}
