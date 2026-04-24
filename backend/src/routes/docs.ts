import { FastifyInstance } from 'fastify';
import { apiCatalog, requirementsSummary } from '../docs';

export async function docsRoutes(fastify: FastifyInstance) {
  fastify.get('/api/docs', async () => apiCatalog);
  fastify.get('/api/requirements', async () => ({ items: requirementsSummary }));
}

