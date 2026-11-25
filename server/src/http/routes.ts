// Rotas: só traduzem HTTP <-> serviços. Nenhuma regra e nenhum SQL aqui.
import type { IncomingMessage, ServerResponse } from 'node:http';
import { HttpError } from '../domain/errors.ts';
import { isMockMode } from '../infra/ai.ts';
import { login, logout, register, userFromToken } from '../services/auth.ts';
import type { PublicUser } from '../services/auth.ts';
import * as receipts from '../services/receipts.ts';
import { CORS, bearerToken, readJson, sendJpeg, sendJson } from './helpers.ts';

function requireUser(req: IncomingMessage): PublicUser {
  const user = userFromToken(bearerToken(req));
  if (!user) throw new HttpError(401, 'Sessão expirada. Entre novamente.');
  return user;
}

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
    const expires = Number(url.searchParams.get('expires'));
    const signature = url.searchParams.get('signature') ?? '';
    return sendJpeg(res, receipts.openSignedImage(parts[1], expires, signature));
  }

  // --- Notas (tudo daqui para baixo exige login) ---
  if (parts[0] !== 'receipts') throw new HttpError(404, 'Rota não encontrada.');
  const user = requireUser(req);
  const id = parts[1];

  if (method === 'GET' && parts.length === 1) {
    return sendJson(res, 200, receipts.listReceipts(user));
  }
  if (method === 'POST' && parts.length === 1) {
    return sendJson(res, 201, receipts.createReceipt(user, await readJson(req)));
  }
  if (method === 'GET' && parts.length === 2) {
    return sendJson(res, 200, receipts.getReceipt(user, id));
  }
  if (method === 'PATCH' && parts.length === 2) {
    receipts.updateReceipt(user, id, await readJson(req));
    return sendJson(res, 200, { ok: true });
  }
  if (method === 'DELETE' && parts.length === 2) {
    receipts.deleteReceipt(user, id);
    return sendJson(res, 200, { ok: true });
  }
  if (method === 'POST' && parts.length === 3 && parts[2] === 'scan') {
    return sendJson(res, 200, await receipts.scanReceipt(user, id));
  }
  if (method === 'GET' && parts.length === 3 && parts[2] === 'image-url') {
    return sendJson(res, 200, receipts.createImageLink(user, id, url.origin));
  }

  throw new HttpError(404, 'Rota não encontrada.');
}

// Atende uma requisição: erros conhecidos viram JSON com o status certo,
// o resto vira 500 com detalhe só no log. Toda requisição é registrada.
export async function handleRequest(req: IncomingMessage, res: ServerResponse) {
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
    const cleanPath = (req.url ?? '').split('?')[0];
    console.log(
      `${req.method} ${cleanPath} -> ${res.statusCode} (${Date.now() - started} ms)`,
    );
  }
}
