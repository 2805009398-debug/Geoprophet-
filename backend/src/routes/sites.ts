import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { authenticate } from '../guards';

const querySchema = z.object({
  riskLevel: z.string().optional(),
  status: z.string().optional(),
  keyword: z.string().optional()
});

export async function siteRoutes(fastify: FastifyInstance) {
  fastify.get('/api/sites', { preHandler: authenticate }, async (request) => {
    const parsed = querySchema.parse(request.query ?? {});
    const conditions: string[] = [];
    const params: unknown[] = [];

    if (parsed.riskLevel) {
      conditions.push('s.risk_level = ?');
      params.push(parsed.riskLevel);
    }
    if (parsed.status) {
      conditions.push('s.status = ?');
      params.push(parsed.status);
    }
    if (parsed.keyword) {
      conditions.push('(s.name LIKE ? OR s.district LIKE ? OR s.hazard_type LIKE ?)');
      params.push(`%${parsed.keyword}%`, `%${parsed.keyword}%`, `%${parsed.keyword}%`);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const rows = fastify.db
      .prepare(`
        SELECT
          s.id,
          s.code,
          s.name,
          s.district,
          s.hazard_type AS hazardType,
          s.risk_level AS riskLevel,
          s.status,
          s.lat,
          s.lng,
          s.last_inspection_at AS lastInspectionAt,
          s.description,
          COUNT(DISTINCT sn.id) AS sensorCount,
          COUNT(DISTINCT CASE WHEN a.status = 'active' THEN a.id END) AS activeAlerts
        FROM sites s
        LEFT JOIN sensors sn ON sn.site_id = s.id
        LEFT JOIN alerts a ON a.site_id = s.id
        ${whereClause}
        GROUP BY s.id
        ORDER BY
          CASE s.risk_level
            WHEN 'critical' THEN 4
            WHEN 'high' THEN 3
            WHEN 'medium' THEN 2
            ELSE 1
          END DESC,
          s.name
      `)
      .all(...params);

    return { items: rows };
  });

  fastify.get('/api/sites/:id', { preHandler: authenticate }, async (request, reply) => {
    const params = z.object({ id: z.coerce.number() }).parse(request.params);
    const site = fastify.db
      .prepare(`
        SELECT
          id,
          code,
          name,
          district,
          hazard_type AS hazardType,
          risk_level AS riskLevel,
          status,
          lat,
          lng,
          last_inspection_at AS lastInspectionAt,
          description
        FROM sites
        WHERE id = ?
      `)
      .get(params.id);

    if (!site) {
      return reply.code(404).send({ message: '未找到对应监测点。' });
    }

    const sensors = fastify.db
      .prepare(`
        SELECT
          id,
          name,
          sensor_type AS sensorType,
          unit,
          status,
          last_value AS lastValue,
          last_collected_at AS lastCollectedAt
        FROM sensors
        WHERE site_id = ?
        ORDER BY sensor_type, name
      `)
      .all(params.id);

    const observations = fastify.db
      .prepare(`
        SELECT
          o.id,
          o.observed_at AS observedAt,
          o.value,
          o.quality,
          o.anomaly_level AS anomalyLevel,
          sn.name AS sensorName,
          sn.sensor_type AS sensorType,
          sn.unit
        FROM observations o
        JOIN sensors sn ON sn.id = o.sensor_id
        WHERE sn.site_id = ?
        ORDER BY o.observed_at DESC
        LIMIT 24
      `)
      .all(params.id);

    const assessment = fastify.db
      .prepare(`
        SELECT
          id,
          level,
          population_affected AS populationAffected,
          economic_loss AS economicLoss,
          road_impact AS roadImpact,
          summary,
          created_at AS createdAt
        FROM assessments
        WHERE site_id = ?
        ORDER BY created_at DESC
        LIMIT 1
      `)
      .get(params.id);

    return { site, sensors, observations, assessment };
  });
}

