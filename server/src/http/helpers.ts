// Ajudantes de HTTP: CORS, ler o corpo JSON, responder JSON e pegar o token.
import type { IncomingMessage, ServerResponse } from 'node:http';
import { HttpError } from '../domain/errors.ts';

const MAX_BODY_BYTES = 8_000_000; // foto em base64 cresce ~33%

export const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, content-type',
  'Access-Control-Allow-Methods': 'GET, POST, PATCH, DELETE, OPTIONS',
};

export function sendJson(res: ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { ...CORS, 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(body));
}

export function sendJpeg(res: ServerResponse, bytes: Buffer) {
  res.writeHead(200, {
    ...CORS,
    'Content-Type': 'image/jpeg',
    'Cache-Control': 'private',
  });
  res.end(bytes);
}

export async function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > MAX_BODY_BYTES) throw new HttpError(413, 'A imagem é grande demais.');
    chunks.push(chunk as Buffer);
  }
  if (size === 0) return {};
  try {
    const parsed: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      throw new Error('not an object');
    }
    return parsed as Record<string, unknown>;
  } catch {
    throw new HttpError(400, 'Corpo da requisição inválido.');
  }
}

// Lê "Authorization: Bearer <token>".
export function bearerToken(req: IncomingMessage): string | null {
  const header = req.headers.authorization ?? '';
  return header.startsWith('Bearer ') ? header.slice(7) : null;
}
