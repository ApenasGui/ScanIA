// Fotos das notas no disco. Cada usuário tem a própria pasta, como no Storage do guia:
// uploads/<user_id>/<arquivo>.jpg. O banco guarda só o caminho relativo.
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { UPLOADS_DIR } from './paths.ts';

export function saveImage(userId: string, bytes: Buffer): string {
  mkdirSync(path.join(UPLOADS_DIR, userId), { recursive: true });
  const suffix = Math.random().toString(36).slice(2, 8);
  const imagePath = `${userId}/${Date.now()}-${suffix}.jpg`;
  writeFileSync(path.join(UPLOADS_DIR, imagePath), bytes);
  return imagePath;
}

export function readImage(imagePath: string): Buffer {
  return readFileSync(path.join(UPLOADS_DIR, imagePath));
}

export function removeImage(imagePath: string): void {
  rmSync(path.join(UPLOADS_DIR, imagePath), { force: true });
}
