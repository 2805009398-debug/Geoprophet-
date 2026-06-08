import { FastifyReply, FastifyRequest } from 'fastify';
import { forbidden } from './errors';

export async function authenticate(request: FastifyRequest, reply: FastifyReply) {
  try {
    await request.jwtVerify();
  } catch {
    return reply.code(401).send({ message: '登录已过期，请重新登录。', requestId: request.id });
  }
}

export function requireRoles(...allowedRoles: string[]) {
  return async function roleGuard(request: FastifyRequest) {
    if (!allowedRoles.includes(request.user.role)) {
      throw forbidden('当前账号没有执行该操作的权限。');
    }
  };
}
