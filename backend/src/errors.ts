import { ZodError } from 'zod';

export class HttpError extends Error {
  statusCode: number;

  constructor(statusCode: number, message: string) {
    super(message);
    this.statusCode = statusCode;
  }
}

export function badRequest(message: string) {
  return new HttpError(400, message);
}

export function notFound(message: string) {
  return new HttpError(404, message);
}

export function forbidden(message: string) {
  return new HttpError(403, message);
}

export function upstreamTimeout(message: string) {
  return new HttpError(504, message);
}

export function upstreamFailure(message: string) {
  return new HttpError(502, message);
}

export function isZodError(error: unknown): error is ZodError {
  return error instanceof ZodError;
}
