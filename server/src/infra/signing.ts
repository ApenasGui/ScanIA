// Assinatura dos links de imagem (HMAC). O segredo é criado uma vez e fica em data/.
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { DATA_DIR } from './paths.ts';

const secretFile = path.join(DATA_DIR, '.image-secret');
if (!existsSync(secretFile)) writeFileSync(secretFile, randomBytes(32).toString('hex'));
const SECRET = readFileSync(secretFile, 'utf8').trim();

export function sign(receiptId: string, expires: number): string {
  return createHmac('sha256', SECRET).update(`${receiptId}.${expires}`).digest('hex');
}

export function validSignature(
  receiptId: string,
  expires: number,
  signature: string,
): boolean {
  if (!Number.isFinite(expires) || expires < Date.now() / 1000) return false;
  // Buffer.from(hex) ignora letras inválidas no fim; por isso conferimos o formato antes.
  if (!/^[0-9a-f]{64}$/.test(signature)) return false;
  const expected = Buffer.from(sign(receiptId, expires), 'hex');
  const actual = Buffer.from(signature, 'hex');
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}
