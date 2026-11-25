// Servidor local do ScanIA. Faz o papel que o Supabase fazia no guia:
// login, banco (SQLite), guarda das fotos e a "Edge Function" que chama a IA.
//
// Regra de ouro no lugar do RLS: TODA consulta de nota filtra por user_id.
import { createHmac, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { networkInterfaces } from 'node:os';
import path from 'node:path';
import { isMockMode, readReceiptImage } from './ai.ts';
import { HttpError, login, logout, register, userFromToken } from './auth.ts';
import type { PublicUser } from './auth.ts';
import { DATA_DIR, UPLOADS_DIR, db } from './db.ts';
import {
  ReceiptReadError,
  isCategory,
  isValidPurchaseDate,
  looksLikeJpeg,
  validTotal,
} from './parse.ts';
import type { ExtractedReceipt } from './parse.ts';

const PORT = Number(process.env.PORT ?? 3333);
const MAX_BODY_BYTES = 8_000_000; // foto em base64 cresce ~33%
const MAX_UPLOAD_BYTES = 5_242_880; // 5 MB, igual ao bucket do guia
const IMAGE_LINK_SECONDS = 3600;

// ---------- Segredo para assinar links de imagem (criado uma vez, fica em data/) ----------
const secretFile = path.join(DATA_DIR, '.image-secret');
if (!existsSync(secretFile)) writeFileSync(secretFile, randomBytes(32).toString('hex'));
const IMAGE_SECRET = readFileSync(secretFile, 'utf8').trim();

const sign = (receiptId: string, expires: number) =>
  createHmac('sha256', IMAGE_SECRET).update(`${receiptId}.${expires}`).digest('hex');

function validSignature(receiptId: string, expires: number, signature: string): boolean {
  if (!Number.isFinite(expires) || expires < Date.now() / 1000) return false;
  // Buffer.from(hex) ignora letras inválidas no fim; por isso conferimos o formato antes.
  if (!/^[0-9a-f]{64}$/.test(signature)) return false;
  const expected = Buffer.from(sign(receiptId, expires), 'hex');
  const actual = Buffer.from(signature, 'hex');
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

// ---------- Ajudantes de HTTP ----------
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, content-type',
  'Access-Control-Allow-Methods': 'GET, POST, PATCH, DELETE, OPTIONS',
};

function sendJson(res: ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { ...CORS, 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(body));
}

async function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
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

function bearerToken(req: IncomingMessage): string | null {
  const header = req.headers.authorization ?? '';
  return header.startsWith('Bearer ') ? header.slice(7) : null;
}

function requireUser(req: IncomingMessage): PublicUser {
  const user = userFromToken(bearerToken(req));
  if (!user) throw new HttpError(401, 'Sessão expirada. Entre novamente.');
  return user;
}

// ---------- Notas ----------
interface ReceiptRow {
  id: string;
  user_id: string;
  image_path: string;
  status: string;
  merchant: string | null;
  purchase_date: string | null;
  total: number | null;
  category: string | null;
  payment_method: string | null;
  error_message: string | null;
  created_at: string;
}

function findReceipt(userId: string, id: string): ReceiptRow {
  const row = db
    .prepare('select * from receipts where id = ? and user_id = ?')
    .get(id, userId) as ReceiptRow | undefined;
  if (!row) throw new HttpError(404, 'Nota não encontrada.');
  return row;
}

// Grava o que a IA leu. Só grava se a nota AINDA está esperando a leitura:
// se o usuário salvou a correção (vira 'done') ou excluiu a nota enquanto a IA lia,
// a correção dele vale e o resultado da IA é descartado. Devolve false nesse caso.
function saveResult(id: string, r: ExtractedReceipt): boolean {
  // Transação: ou grava tudo (nota + itens), ou nada.
  db.exec('begin');
  try {
    const { changes } = db
      .prepare(
        `update receipts set status = 'done', error_message = null, merchant = ?,
         purchase_date = ?, total = ?, category = ?, payment_method = ?
         where id = ? and status = 'pending'`,
      )
      .run(r.merchant, r.purchase_date, r.total, r.category, r.payment_method, id);
    if (changes === 0) {
      db.exec('rollback');
      return false;
    }
    db.prepare('delete from receipt_items where receipt_id = ?').run(id); // nova tentativa
    const insertItem = db.prepare(
      `insert into receipt_items (id, receipt_id, description, quantity, unit_price, total_price)
       values (?, ?, ?, ?, ?, ?)`,
    );
    for (const item of r.items) {
      insertItem.run(
        randomUUID(),
        id,
        item.description,
        item.quantity,
        item.unit_price,
        item.total_price,
      );
    }
    db.exec('commit');
    return true;
  } catch (error) {
    db.exec('rollback');
    throw error;
  }
}

// A nota mudou enquanto a IA lia: foi excluída (404) ou o usuário salvou à mão (409).
function scanSkipped(res: ServerResponse, userId: string, id: string) {
  const exists = db
    .prepare('select 1 from receipts where id = ? and user_id = ?')
    .get(id, userId);
  console.log(`[scan] nota ${id} mudou durante a leitura; resultado da IA descartado`);
  if (!exists) return sendJson(res, 404, { error: 'Nota não encontrada.' });
  return sendJson(res, 409, {
    error: 'Você salvou a nota enquanto a IA lia. Seus dados foram mantidos.',
  });
}

async function scanReceipt(res: ServerResponse, user: PublicUser, id: string) {
  const receipt = findReceipt(user.id, id);
  // Marca "esperando a leitura". Se o usuário salvar no meio, vira 'done' e a IA não grava.
  db.prepare(
    `update receipts set status = 'pending', error_message = null where id = ?`,
  ).run(receipt.id);
  try {
    const bytes = readFileSync(path.join(UPLOADS_DIR, receipt.image_path));
    const extracted = await readReceiptImage(bytes);
    if (!saveResult(receipt.id, extracted)) return scanSkipped(res, user.id, receipt.id);
    sendJson(res, 200, { ok: true, receipt_id: receipt.id });
  } catch (err) {
    const expected = err instanceof ReceiptReadError;
    const message = expected
      ? err.message
      : 'Falha ao processar a nota. Tente novamente.';
    const { changes } = db
      .prepare(
        `update receipts set status = 'error', error_message = ?
         where id = ? and status = 'pending'`,
      )
      .run(message, receipt.id);
    if (changes === 0) return scanSkipped(res, user.id, receipt.id);
    if (!expected) console.error('[scan] falha interna:', err);
    sendJson(res, expected ? 422 : 500, { error: message });
  }
}

function createReceipt(user: PublicUser, body: Record<string, unknown>) {
  if (typeof body.image_base64 !== 'string' || body.image_base64.length === 0) {
    throw new HttpError(400, 'image_base64 é obrigatório.');
  }
  const bytes = Buffer.from(body.image_base64, 'base64');
  if (bytes.length > MAX_UPLOAD_BYTES)
    throw new HttpError(413, 'A imagem é grande demais.');
  if (!looksLikeJpeg(bytes)) throw new HttpError(415, 'Envie uma imagem JPEG.');

  // Cada usuário tem a própria pasta, como no Storage do guia: uploads/<user_id>/arquivo.jpg
  mkdirSync(path.join(UPLOADS_DIR, user.id), { recursive: true });
  const suffix = Math.random().toString(36).slice(2, 8);
  const imagePath = `${user.id}/${Date.now()}-${suffix}.jpg`;
  writeFileSync(path.join(UPLOADS_DIR, imagePath), bytes);

  const id = randomUUID();
  db.prepare('insert into receipts (id, user_id, image_path) values (?, ?, ?)').run(
    id,
    user.id,
    imagePath,
  );
  return { id };
}

function updateReceipt(user: PublicUser, id: string, body: Record<string, unknown>) {
  findReceipt(user.id, id);

  const merchant =
    typeof body.merchant === 'string' ? body.merchant.trim().slice(0, 80) : '';
  const date = body.purchase_date;
  const total = validTotal(body.total);
  const category = body.category ?? 'Outros';

  // O app já valida tudo isto, mas o servidor nunca confia no app.
  if (merchant.length < 2) throw new HttpError(400, 'Informe o estabelecimento.');
  if (date !== null && !isValidPurchaseDate(date)) {
    throw new HttpError(400, 'Data inválida.');
  }
  if (total === null) throw new HttpError(400, 'Valor inválido.');
  if (!isCategory(category)) throw new HttpError(400, 'Categoria inválida.');

  db.prepare(
    `update receipts set merchant = ?, purchase_date = ?, total = ?, category = ?,
     status = 'done', error_message = null where id = ? and user_id = ?`,
  ).run(merchant, date, total, category, id, user.id);
}

function deleteReceipt(user: PublicUser, id: string) {
  const receipt = findReceipt(user.id, id);
  rmSync(path.join(UPLOADS_DIR, receipt.image_path), { force: true });
  db.prepare('delete from receipts where id = ? and user_id = ?').run(id, user.id); // itens vão junto
}

// ---------- Rotas ----------
async function route(req: IncomingMessage, res: ServerResponse) {
  const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
  const method = req.method ?? 'GET';
  const parts = url.pathname.split('/').filter(Boolean); // ex.: ['receipts', '<id>', 'scan']

  if (method === 'OPTIONS') {
    res.writeHead(204, CORS);
    res.end();
    return;
  }

  if (method === 'GET' && url.pathname === '/health') {
    return sendJson(res, 200, { ok: true, mock_ai: isMockMode() });
  }

  // --- Autenticação ---
  if (method === 'POST' && url.pathname === '/auth/register') {
    return sendJson(res, 201, register(await readJson(req)));
  }
  if (method === 'POST' && url.pathname === '/auth/login') {
    return sendJson(res, 200, login(await readJson(req)));
  }
  if (method === 'POST' && url.pathname === '/auth/logout') {
    const token = bearerToken(req);
    if (token) logout(token);
    return sendJson(res, 200, { ok: true });
  }
  if (method === 'GET' && url.pathname === '/auth/me') {
    return sendJson(res, 200, { user: requireUser(req) });
  }

  // --- Imagem por link assinado (sem login: o link expira em 1 hora) ---
  if (method === 'GET' && parts[0] === 'images' && parts.length === 2) {
    const id = parts[1];
    const expires = Number(url.searchParams.get('expires'));
    const signature = url.searchParams.get('signature') ?? '';
    if (!validSignature(id, expires, signature)) {
      throw new HttpError(403, 'Link da imagem inválido ou expirado.');
    }
    const row = db.prepare('select image_path from receipts where id = ?').get(id) as
      { image_path: string } | undefined;
    if (!row) throw new HttpError(404, 'Imagem não encontrada.');
    res.writeHead(200, {
      ...CORS,
      'Content-Type': 'image/jpeg',
      'Cache-Control': 'private',
    });
    res.end(readFileSync(path.join(UPLOADS_DIR, row.image_path)));
    return;
  }

  // --- Notas (tudo daqui para baixo exige login) ---
  if (parts[0] !== 'receipts') throw new HttpError(404, 'Rota não encontrada.');
  const user = requireUser(req);
  const id = parts[1];

  if (method === 'GET' && parts.length === 1) {
    const list = db
      // Mais recentes primeiro pela data da COMPRA; sem data, vale a do envio.
      .prepare(
        `select * from receipts where user_id = ?
         order by coalesce(purchase_date, substr(created_at, 1, 10)) desc, created_at desc`,
      )
      .all(user.id);
    return sendJson(res, 200, list);
  }
  if (method === 'POST' && parts.length === 1) {
    return sendJson(res, 201, createReceipt(user, await readJson(req)));
  }
  if (method === 'GET' && parts.length === 2) {
    const receipt = findReceipt(user.id, id);
    const items = db
      .prepare('select * from receipt_items where receipt_id = ? order by rowid')
      .all(receipt.id);
    return sendJson(res, 200, { ...receipt, items });
  }
  if (method === 'PATCH' && parts.length === 2) {
    updateReceipt(user, id, await readJson(req));
    return sendJson(res, 200, { ok: true });
  }
  if (method === 'DELETE' && parts.length === 2) {
    deleteReceipt(user, id);
    return sendJson(res, 200, { ok: true });
  }
  if (method === 'POST' && parts.length === 3 && parts[2] === 'scan') {
    return scanReceipt(res, user, id);
  }
  if (method === 'GET' && parts.length === 3 && parts[2] === 'image-url') {
    findReceipt(user.id, id);
    const expires = Math.floor(Date.now() / 1000) + IMAGE_LINK_SECONDS;
    const link = `${url.origin}/images/${id}?expires=${expires}&signature=${sign(id, expires)}`;
    return sendJson(res, 200, { url: link });
  }

  throw new HttpError(404, 'Rota não encontrada.');
}

const server = createServer(async (req, res) => {
  const started = Date.now();
  try {
    await route(req, res);
  } catch (err) {
    if (err instanceof HttpError) {
      sendJson(res, err.status, { error: err.message });
    } else {
      console.error('[erro]', err);
      sendJson(res, 500, { error: 'Erro interno do servidor.' });
    }
  } finally {
    // Log de toda requisição: grug gosta de ver o que acontece.
    const cleanPath = (req.url ?? '').split('?')[0];
    console.log(
      `${req.method} ${cleanPath} -> ${res.statusCode} (${Date.now() - started} ms)`,
    );
  }
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(
    `ScanIA server na porta ${PORT} | IA: ${isMockMode() ? 'SIMULADA (MOCK_AI)' : 'REAL'}`,
  );
  for (const list of Object.values(networkInterfaces())) {
    for (const net of list ?? []) {
      if (net.family === 'IPv4' && !net.internal) {
        console.log(`  na rede local: http://${net.address}:${PORT}`);
      }
    }
  }
});
