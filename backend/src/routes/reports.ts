import fs from 'node:fs';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { runtimePaths } from '../config';
import { authenticate } from '../guards';

const createReportSchema = z.object({
  siteId: z.coerce.number().optional(),
  reporterName: z.string().trim().min(2),
  phone: z.string().trim().min(6),
  title: z.string().trim().min(2),
  reportType: z.enum(['滑坡', '泥石流', '崩塌', '沉陷', '裂缝']),
  description: z.string().trim().min(4),
  imageUrl: z.string().optional(),
  lat: z.coerce.number(),
  lng: z.coerce.number()
});

export async function reportRoutes(fastify: FastifyInstance) {
  fastify.get('/api/reports', { preHandler: authenticate }, async () => {
    const rows = fastify.db
      .prepare(`
        SELECT
          r.id,
          r.reporter_name AS reporterName,
          r.phone,
          r.title,
          r.report_type AS reportType,
          r.description,
          r.image_url AS imageUrl,
          r.lat,
          r.lng,
          r.confidence_score AS confidenceScore,
          r.status,
          r.created_at AS createdAt,
          s.name AS siteName
        FROM crowd_reports r
        LEFT JOIN sites s ON s.id = r.site_id
        ORDER BY r.created_at DESC
      `)
      .all();

    return { items: rows };
  });

  fastify.post('/api/reports', async (request, reply) => {
    const parsed = createReportSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ message: '上报信息不完整。' });
    }

    const now = new Date().toISOString().slice(0, 19).replace('T', ' ');
    const confidence = Number((0.55 + Math.random() * 0.35).toFixed(2));
    const result = fastify.db
      .prepare(`
        INSERT INTO crowd_reports (
          site_id, reporter_name, phone, title, report_type, description,
          image_url, lat, lng, confidence_score, status, created_at
        )
        VALUES (
          @siteId, @reporterName, @phone, @title, @reportType, @description,
          @imageUrl, @lat, @lng, @confidence, 'pending', @createdAt
        )
      `)
      .run({ ...parsed.data, confidence, createdAt: now });

    return reply.code(201).send({ id: result.lastInsertRowid });
  });

  fastify.post('/api/uploads', async (request, reply) => {
    const file = await request.file();
    if (!file) {
      return reply.code(400).send({ message: '请选择要上传的图片。' });
    }

    const ext = path.extname(file.filename ?? '').toLowerCase() || '.jpg';
    const fileName = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}${ext}`;
    const outputPath = path.join(runtimePaths.uploadsDir, fileName);
    await pipeline(file.file, fs.createWriteStream(outputPath));

    return { url: `/uploads/${fileName}` };
  });
}

