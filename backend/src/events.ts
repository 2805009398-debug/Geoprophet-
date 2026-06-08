import type { FastifyInstance, FastifyRequest } from 'fastify';

type DomainEvent = {
  eventType: string;
  aggregateType: string;
  aggregateId: string | number;
  payload?: Record<string, unknown>;
};

export function emitDomainEvent(
  fastify: FastifyInstance,
  request: FastifyRequest,
  event: DomainEvent
) {
  const now = new Date().toISOString().slice(0, 19).replace('T', ' ');

  fastify.db
    .prepare(
      `
        INSERT INTO domain_events (
          event_type, aggregate_type, aggregate_id, payload_json,
          status, retry_count, request_id, created_at
        )
        VALUES (
          @eventType, @aggregateType, @aggregateId, @payloadJson,
          'pending', 0, @requestId, @createdAt
        )
      `
    )
    .run({
      eventType: event.eventType,
      aggregateType: event.aggregateType,
      aggregateId: String(event.aggregateId),
      payloadJson: event.payload ? JSON.stringify(event.payload) : null,
      requestId: request.id,
      createdAt: now
    });
}

export function listDomainEvents(fastify: FastifyInstance, limit = 50) {
  return fastify.db
    .prepare(
      `
        SELECT
          id,
          event_type AS eventType,
          aggregate_type AS aggregateType,
          aggregate_id AS aggregateId,
          payload_json AS payloadJson,
          status,
          retry_count AS retryCount,
          request_id AS requestId,
          created_at AS createdAt,
          published_at AS publishedAt
        FROM domain_events
        ORDER BY created_at DESC, id DESC
        LIMIT ?
      `
    )
    .all(limit);
}
