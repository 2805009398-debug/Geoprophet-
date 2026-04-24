import { FastifyInstance } from 'fastify';
import { authenticate } from '../guards';

function getDailySeries(db: FastifyInstance['db'], table: 'alerts' | 'crowd_reports') {
  const end = new Date('2026-04-24T00:00:00');
  const labels: string[] = [];
  const series: number[] = [];
  const query = db.prepare(`
    SELECT substr(created_at, 1, 10) AS day, COUNT(*) AS total
    FROM ${table}
    WHERE substr(created_at, 1, 10) = ?
    GROUP BY substr(created_at, 1, 10)
  `);

  for (let i = 6; i >= 0; i -= 1) {
    const current = new Date(end);
    current.setDate(end.getDate() - i);
    const day = current.toISOString().slice(0, 10);
    labels.push(day.slice(5));
    const row = query.get(day) as { total?: number } | undefined;
    series.push(row?.total ?? 0);
  }

  return { labels, series };
}

export async function dashboardRoutes(fastify: FastifyInstance) {
  fastify.get('/api/dashboard/overview', { preHandler: authenticate }, async () => {
    const siteCount = (fastify.db.prepare('SELECT COUNT(*) AS total FROM sites').get() as any).total;
    const sensorOnline = (
      fastify.db.prepare("SELECT COUNT(*) AS total FROM sensors WHERE status = 'online'").get() as any
    ).total;
    const activeAlerts = (
      fastify.db.prepare("SELECT COUNT(*) AS total FROM alerts WHERE status = 'active'").get() as any
    ).total;
    const pendingReports = (
      fastify.db.prepare("SELECT COUNT(*) AS total FROM crowd_reports WHERE status = 'pending'").get() as any
    ).total;

    const riskDistribution = fastify.db
      .prepare(`
        SELECT risk_level AS riskLevel, COUNT(*) AS total
        FROM sites
        GROUP BY risk_level
        ORDER BY total DESC
      `)
      .all();

    const severityDistribution = fastify.db
      .prepare(`
        SELECT severity, COUNT(*) AS total
        FROM alerts
        GROUP BY severity
        ORDER BY total DESC
      `)
      .all();

    const siteMap = fastify.db
      .prepare(`
        SELECT
          s.id,
          s.name,
          s.hazard_type AS hazardType,
          s.risk_level AS riskLevel,
          s.status,
          s.lat,
          s.lng,
          COALESCE(SUM(CASE WHEN a.status = 'active' THEN 1 ELSE 0 END), 0) AS activeAlerts
        FROM sites s
        LEFT JOIN alerts a ON a.site_id = s.id
        GROUP BY s.id
        ORDER BY activeAlerts DESC, s.risk_level DESC
      `)
      .all();

    const recentAlerts = fastify.db
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
        ORDER BY a.created_at DESC
        LIMIT 6
      `)
      .all();

    const recentFeed = fastify.db
      .prepare(`
        SELECT id, category, level, message, created_at AS createdAt
        FROM system_logs
        ORDER BY created_at DESC
        LIMIT 8
      `)
      .all();

    return {
      stats: [
        { label: '监测点位', value: siteCount, suffix: '个', tone: 'primary', hint: '覆盖白山市重点隐患区' },
        { label: '在线传感器', value: sensorOnline, suffix: '台', tone: 'success', hint: '含雨量、位移、裂缝计' },
        { label: '活动预警', value: activeAlerts, suffix: '条', tone: 'danger', hint: '需值班人员持续跟踪' },
        { label: '待审核上报', value: pendingReports, suffix: '条', tone: 'warning', hint: '群众上报待AI初审' }
      ],
      riskDistribution,
      severityDistribution,
      alertTrend: getDailySeries(fastify.db, 'alerts'),
      reportTrend: getDailySeries(fastify.db, 'crowd_reports'),
      siteMap,
      recentAlerts,
      recentFeed,
      ingestionStatus: {
        channelCount: 4,
        avgLatencyMs: 327,
        transmissionErrors: (
          fastify.db
            .prepare("SELECT COUNT(*) AS total FROM system_logs WHERE category = 'ingestion' AND level = 'error'")
            .get() as any
        ).total,
        successRate: 98.6
      }
    };
  });
}

