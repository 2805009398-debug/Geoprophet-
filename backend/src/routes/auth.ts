import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { writeAuditLog } from '../audit';
import { notFound } from '../errors';
import { authenticate } from '../guards';
import { verifyPassword } from '../password';
import { createRateLimiter } from '../rate-limit';

const loginSchema = z.object({
  username: z.string().trim().min(1),
  password: z.string().min(1)
});

function mapUser(row: any) {
  return {
    id: row.id,
    username: row.username,
    role: row.role,
    name: row.display_name
  };
}

export async function authRoutes(fastify: FastifyInstance) {
  const loginRateLimit = createRateLimiter({
    keyPrefix: 'auth-login',
    windowMs: fastify.appConfig.rateLimitWindowMs,
    max: fastify.appConfig.authRateLimitMax,
    message: '登录尝试过于频繁，请稍后再试。'
  });

  fastify.get('/api/auth/providers', async () => ({
    providers: {
      local: true,
      oidc: {
        enabled: fastify.appConfig.oidcEnabled,
        issuer: fastify.appConfig.oidcIssuer,
        clientId: fastify.appConfig.oidcClientId,
        redirectUri: fastify.appConfig.oidcRedirectUri
      }
    },
    demoAccounts: fastify.appConfig.exposeDemoAccounts
      ? [
          { username: 'admin', password: 'admin123', role: 'admin' },
          { username: 'operator', password: 'operator123', role: 'operator' },
          { username: 'expert', password: 'expert123', role: 'expert' }
        ]
      : []
  }));

  fastify.post('/api/auth/login', { preHandler: loginRateLimit }, async (request, reply) => {
    const parsed = loginSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ message: '账号或密码格式不正确。', requestId: request.id });
    }

    const user = fastify.db.prepare('SELECT * FROM users WHERE username = ?').get(parsed.data.username) as any;
    if (!user || !verifyPassword(parsed.data.password, user.password_salt, user.password_hash)) {
      writeAuditLog(fastify, request, {
        action: 'auth.login_failed',
        entityType: 'user',
        entityId: parsed.data.username,
        summary: '账号密码登录失败。',
        metadata: { username: parsed.data.username }
      });
      return reply.code(401).send({ message: '用户名或密码错误。', requestId: request.id });
    }

    const mappedUser = mapUser(user);
    const token = fastify.jwt.sign({
      sub: mappedUser.id,
      username: mappedUser.username,
      role: mappedUser.role,
      name: mappedUser.name
    });

    writeAuditLog(fastify, request, {
      action: 'auth.login_succeeded',
      entityType: 'user',
      entityId: mappedUser.id,
      summary: '账号密码登录成功。',
      metadata: { username: mappedUser.username, role: mappedUser.role }
    });

    return { token, user: mappedUser };
  });

  fastify.get('/api/auth/me', { preHandler: authenticate }, async (request) => {
    const user = fastify.db.prepare('SELECT * FROM users WHERE id = ?').get(request.user.sub) as any;
    if (!user) {
      throw notFound('当前用户不存在，请重新登录。');
    }
    return { user: mapUser(user) };
  });
}
