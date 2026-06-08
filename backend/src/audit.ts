import type { FastifyInstance, FastifyRequest } from 'fastify';

type AuditEntry = {
  action: string;
  entityType: string;
  entityId?: string | number | null;
  summary: string;
  metadata?: Record<string, unknown>;
};

type RequestWithOptionalUser = FastifyRequest & {
  user?: {
    sub: number;
    username: string;
    role: string;
    name: string;
  };
};

export function writeAuditLog(
  fastify: FastifyInstance,
  request: FastifyRequest,
  entry: AuditEntry
) {
  const requestWithUser = request as RequestWithOptionalUser;
  const actor = requestWithUser.user;
  const now = new Date().toISOString().slice(0, 19).replace('T', ' ');

  fastify.db
    .prepare(
      `
        INSERT INTO audit_logs (
          actor_id, actor_name, actor_role, action, entity_type, entity_id,
          summary, metadata_json, request_id, ip, user_agent, created_at
        )
        VALUES (
          @actorId, @actorName, @actorRole, @action, @entityType, @entityId,
          @summary, @metadataJson, @requestId, @ip, @userAgent, @createdAt
        )
      `
    )
    .run({
      actorId: actor?.sub ?? null,
      actorName: actor?.username ?? null,
      actorRole: actor?.role ?? null,
      action: entry.action,
      entityType: entry.entityType,
      entityId: entry.entityId == null ? null : String(entry.entityId),
      summary: entry.summary,
      metadataJson: entry.metadata ? JSON.stringify(entry.metadata) : null,
      requestId: request.id,
      ip: request.ip,
      userAgent: request.headers['user-agent'] ?? null,
      createdAt: now
    });
}
