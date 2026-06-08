import type { FastifyReply, FastifyRequest } from 'fastify';

type RateLimitOptions = {
  keyPrefix: string;
  windowMs: number;
  max: number;
  message: string;
};

type Bucket = {
  count: number;
  resetAt: number;
};

const buckets = new Map<string, Bucket>();

export function createRateLimiter(options: RateLimitOptions) {
  return async function rateLimit(request: FastifyRequest, reply: FastifyReply) {
    if (options.max <= 0 || options.windowMs <= 0) {
      return;
    }

    const now = Date.now();
    const key = `${options.keyPrefix}:${request.ip}`;
    const existingBucket = buckets.get(key);
    const bucket = existingBucket && existingBucket.resetAt > now
      ? existingBucket
      : { count: 0, resetAt: now + options.windowMs };

    bucket.count += 1;
    buckets.set(key, bucket);

    const secondsToReset = Math.max(1, Math.ceil((bucket.resetAt - now) / 1000));
    const remaining = Math.max(0, options.max - bucket.count);
    reply.header('x-ratelimit-limit', String(options.max));
    reply.header('x-ratelimit-remaining', String(remaining));
    reply.header('x-ratelimit-reset', String(Math.ceil(bucket.resetAt / 1000)));

    cleanupExpiredBuckets(now);

    if (bucket.count > options.max) {
      reply.header('retry-after', String(secondsToReset));
      return reply.code(429).send({
        message: options.message,
        requestId: request.id
      });
    }
  };
}

function cleanupExpiredBuckets(now: number) {
  if (buckets.size < 1000) {
    return;
  }

  for (const [key, bucket] of buckets.entries()) {
    if (bucket.resetAt <= now) {
      buckets.delete(key);
    }
  }
}
