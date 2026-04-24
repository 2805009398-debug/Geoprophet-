import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { authenticate } from '../guards';
import { verifyPassword } from '../password';

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
    demoAccounts: [
      { username: 'admin', password: 'admin123', role: 'admin' },
      { username: 'operator', password: 'operator123', role: 'operator' },
      { username: 'expert', password: 'expert123', role: 'expert' }
    ]
  }));

  fastify.post('/api/auth/login', async (request, reply) => {
    const parsed = loginSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ message: '账号或密码格式不正确。' });
    }

    const user = fastify.db.prepare('SELECT * FROM users WHERE username = ?').get(parsed.data.username) as any;
    if (!user || !verifyPassword(parsed.data.password, user.password_salt, user.password_hash)) {
      return reply.code(401).send({ message: '用户名或密码错误。' });
    }

    const mappedUser = mapUser(user);
    const token = fastify.jwt.sign({
      sub: mappedUser.id,
      username: mappedUser.username,
      role: mappedUser.role,
      name: mappedUser.name
    });

    return { token, user: mappedUser };
  });

  fastify.get('/api/auth/me', { preHandler: authenticate }, async (request) => {
    const user = fastify.db.prepare('SELECT * FROM users WHERE id = ?').get(request.user.sub) as any;
    return { user: mapUser(user) };
  });
}

