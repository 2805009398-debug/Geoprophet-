import type { FastifyInstance } from 'fastify';

type DependencyStatus = {
  status: 'ok' | 'degraded' | 'skipped';
  latencyMs?: number;
  message?: string;
};

export async function getHealthSnapshot(fastify: FastifyInstance) {
  const database = checkDatabase(fastify);
  const modelService = await checkModelService(fastify);
  const dependencyValues = [database, modelService];
  const status = dependencyValues.every((item) => item.status === 'ok' || item.status === 'skipped')
    ? 'ok'
    : 'degraded';

  return {
    status,
    service: 'geoprophet-api',
    mode: fastify.appConfig.appMode,
    checkedAt: new Date().toISOString(),
    dependencies: {
      database,
      modelService
    }
  };
}

function checkDatabase(fastify: FastifyInstance): DependencyStatus {
  const startedAt = Date.now();

  try {
    fastify.db.prepare('SELECT 1').get();
    return { status: 'ok', latencyMs: Date.now() - startedAt };
  } catch (error) {
    return {
      status: 'degraded',
      latencyMs: Date.now() - startedAt,
      message: error instanceof Error ? error.message : 'database-check-failed'
    };
  }
}

async function checkModelService(fastify: FastifyInstance): Promise<DependencyStatus> {
  if (!fastify.appConfig.aiInferenceBaseUrl) {
    return { status: 'skipped', message: 'AI_INFERENCE_BASE_URL 未配置。' };
  }

  const startedAt = Date.now();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), fastify.appConfig.healthCheckTimeoutMs);

  try {
    const response = await fetch(new URL('/health', fastify.appConfig.aiInferenceBaseUrl).toString(), {
      signal: controller.signal
    });

    if (!response.ok) {
      return {
        status: 'degraded',
        latencyMs: Date.now() - startedAt,
        message: `model-health-status-${response.status}`
      };
    }

    const payload = await parseModelHealthPayload(response);
    if (payload.status !== 'ok') {
      return {
        status: 'degraded',
        latencyMs: Date.now() - startedAt,
        message: payload.message ?? `model-health-${payload.status}`
      };
    }

    return {
      status: 'ok',
      latencyMs: Date.now() - startedAt
    };
  } catch (error) {
    return {
      status: 'degraded',
      latencyMs: Date.now() - startedAt,
      message: error instanceof Error && error.name === 'AbortError'
        ? 'model-health-timeout'
        : 'model-health-unreachable'
    };
  } finally {
    clearTimeout(timeout);
  }
}

async function parseModelHealthPayload(response: Response): Promise<{ status: string; message?: string }> {
  try {
    const payload = (await response.json()) as Record<string, unknown>;
    const status = typeof payload.status === 'string' ? payload.status : 'unknown';
    const warnings = Array.isArray(payload.warnings)
      ? payload.warnings.filter((item): item is string => typeof item === 'string')
      : [];

    return {
      status,
      message: warnings[0]
    };
  } catch {
    return { status: 'invalid-json', message: 'model-health-invalid-json' };
  }
}
