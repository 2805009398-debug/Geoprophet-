import path from 'node:path';
import type { MultipartFile } from '@fastify/multipart';
import { badRequest } from './errors';

type UploadPolicy = {
  allowedMimeTypes: string[];
  allowedExtensions: string[];
  fallbackExtension: string;
};

type DetectedImageFormat = {
  extensions: string[];
  mimeTypes: string[];
  preferredExtension: string;
  preferredMimeType: string;
};

export const reportImagePolicy: UploadPolicy = {
  allowedMimeTypes: ['image/jpeg', 'image/png', 'image/webp'],
  allowedExtensions: ['.jpg', '.jpeg', '.png', '.webp'],
  fallbackExtension: '.jpg'
};

export const analysisImagePolicy: UploadPolicy = {
  allowedMimeTypes: ['image/jpeg', 'image/png', 'image/webp', 'image/tiff', 'image/tif'],
  allowedExtensions: ['.jpg', '.jpeg', '.png', '.webp', '.tif', '.tiff'],
  fallbackExtension: '.jpg'
};

export function getValidatedUploadExtension(file: MultipartFile, policy: UploadPolicy) {
  const originalName = file.filename?.trim() || 'uploaded-file';
  const extension = path.extname(originalName).toLowerCase() || '';
  const mimeType = normalizeMimeType(file.mimetype);

  if (extension && !policy.allowedExtensions.includes(extension)) {
    throw badRequest('文件扩展名不在允许范围内。');
  }

  if (mimeType && !policy.allowedMimeTypes.includes(mimeType)) {
    throw badRequest('文件类型不在允许范围内。');
  }

  return extension || null;
}

export async function readValidatedUpload(file: MultipartFile, policy: UploadPolicy) {
  const originalName = file.filename?.trim() || 'uploaded-file';
  const declaredExtension = getValidatedUploadExtension(file, policy);
  const mimeType = normalizeMimeType(file.mimetype) || 'application/octet-stream';
  const chunks: Buffer[] = [];

  for await (const chunk of file.file) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }

  const buffer = Buffer.concat(chunks);
  const detectedFormat = detectImageFormat(buffer);
  if (!detectedFormat) {
    throw badRequest('文件内容与声明的图片格式不一致。');
  }

  const actualExtensionAllowed = detectedFormat.extensions.some((extension) =>
    policy.allowedExtensions.includes(extension)
  );
  const actualMimeAllowed = detectedFormat.mimeTypes.some((detectedMimeType) =>
    policy.allowedMimeTypes.includes(detectedMimeType)
  );
  if (!actualExtensionAllowed || !actualMimeAllowed) {
    throw badRequest('文件类型不在允许范围内。');
  }

  if (!detectedFormat.mimeTypes.includes(mimeType) && mimeType !== 'application/octet-stream') {
    throw badRequest('文件内容与声明的图片格式不一致。');
  }

  if (declaredExtension && !detectedFormat.extensions.includes(declaredExtension)) {
    throw badRequest('文件内容与声明的图片格式不一致。');
  }

  const extension = declaredExtension ?? pickSafeExtension(detectedFormat, policy);

  return {
    originalName,
    extension,
    mimeType: mimeType === 'application/octet-stream' ? detectedFormat.preferredMimeType : mimeType,
    buffer
  };
}

function normalizeMimeType(mimeType?: string) {
  if (!mimeType) {
    return '';
  }

  const normalized = mimeType.toLowerCase().split(';', 1)[0].trim();
  if (normalized === 'application/octet-stream') {
    return '';
  }

  return normalized === 'image/jpg' ? 'image/jpeg' : normalized;
}

function detectImageFormat(buffer: Buffer): DetectedImageFormat | null {
  if (buffer.length === 0) {
    throw badRequest('上传文件不能为空。');
  }

  const isJpeg = buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
  const isPng =
    buffer.length >= 8 &&
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47 &&
    buffer[4] === 0x0d &&
    buffer[5] === 0x0a &&
    buffer[6] === 0x1a &&
    buffer[7] === 0x0a;
  const isWebp =
    buffer.length >= 12 &&
    buffer.subarray(0, 4).toString('ascii') === 'RIFF' &&
    buffer.subarray(8, 12).toString('ascii') === 'WEBP';
  const isTiff =
    buffer.length >= 4 &&
    ((buffer[0] === 0x49 && buffer[1] === 0x49 && buffer[2] === 0x2a && buffer[3] === 0x00) ||
      (buffer[0] === 0x4d && buffer[1] === 0x4d && buffer[2] === 0x00 && buffer[3] === 0x2a));

  if (isJpeg) {
    return {
      extensions: ['.jpg', '.jpeg'],
      mimeTypes: ['image/jpeg'],
      preferredExtension: '.jpg',
      preferredMimeType: 'image/jpeg'
    };
  }

  if (isPng) {
    return {
      extensions: ['.png'],
      mimeTypes: ['image/png'],
      preferredExtension: '.png',
      preferredMimeType: 'image/png'
    };
  }

  if (isWebp) {
    return {
      extensions: ['.webp'],
      mimeTypes: ['image/webp'],
      preferredExtension: '.webp',
      preferredMimeType: 'image/webp'
    };
  }

  if (isTiff) {
    return {
      extensions: ['.tif', '.tiff'],
      mimeTypes: ['image/tiff', 'image/tif'],
      preferredExtension: '.tif',
      preferredMimeType: 'image/tiff'
    };
  }

  return null;
}

function pickSafeExtension(format: DetectedImageFormat, policy: UploadPolicy) {
  if (policy.allowedExtensions.includes(format.preferredExtension)) {
    return format.preferredExtension;
  }

  const allowedExtension = format.extensions.find((extension) => policy.allowedExtensions.includes(extension));
  return allowedExtension ?? policy.fallbackExtension;
}
