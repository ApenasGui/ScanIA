// Onde o servidor guarda tudo: banco, fotos e o segredo dos links de imagem.
import { mkdirSync } from 'node:fs';
import path from 'node:path';

// Padrão: server/data (este arquivo fica em server/src/infra, por isso sobe dois níveis).
// SCANIA_DATA_DIR permite aos testes usarem uma pasta temporária.
export const DATA_DIR = process.env.SCANIA_DATA_DIR
  ? path.resolve(process.env.SCANIA_DATA_DIR)
  : path.resolve(import.meta.dirname, '..', '..', 'data');
export const UPLOADS_DIR = path.join(DATA_DIR, 'uploads');

mkdirSync(UPLOADS_DIR, { recursive: true });
