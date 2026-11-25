// Teste de integração: liga o servidor de verdade (banco em pasta temporária,
// IA simulada) e conversa com ele por HTTP, como o app faz.
// Rodar: npm run test:server
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';

const PORT = 3399;
const BASE = `http://127.0.0.1:${PORT}`;
const dataDir = mkdtempSync(path.join(tmpdir(), 'scania-test-'));
let server: ChildProcess;

// Começo de um JPEG + bytes quaisquer: basta para o modo simulado.
const FAKE_JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4]).toString('base64');

async function call(
  method: string,
  route: string,
  token?: string,
  body?: unknown,
): Promise<{ status: number; data: any }> {
  const headers: Record<string, string> = {};
  if (token) headers.authorization = `Bearer ${token}`;
  if (body !== undefined) headers['content-type'] = 'application/json';
  const res = await fetch(`${BASE}${route}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  return { status: res.status, data: text ? JSON.parse(text) : null };
}

async function newUser(email: string): Promise<string> {
  const { status, data } = await call('POST', '/auth/register', undefined, {
    name: 'Pessoa Teste',
    email,
    password: 'segredo123',
  });
  assert.equal(status, 201);
  return data.token;
}

before(async () => {
  server = spawn(process.execPath, [path.join(import.meta.dirname, '..', 'src', 'index.ts')], {
    env: { ...process.env, PORT: String(PORT), SCANIA_DATA_DIR: dataDir, MOCK_AI: 'true' },
    stdio: 'ignore',
  });
  // Espera o servidor responder (até ~10 s).
  for (let i = 0; i < 50; i++) {
    try {
      const res = await fetch(`${BASE}/health`);
      if (res.ok) return;
    } catch {
      // ainda subindo
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error('servidor não subiu');
});

after(async () => {
  // No Windows o arquivo do banco fica travado até o processo terminar de verdade.
  const exited = once(server, 'exit');
  server.kill();
  await exited;
  rmSync(dataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
});

test('cadastro, login e senha errada', async () => {
  await newUser('ana@scania.test');

  const ok = await call('POST', '/auth/login', undefined, {
    email: 'ANA@scania.test',
    password: 'segredo123',
  });
  assert.equal(ok.status, 200);
  assert.equal(ok.data.user.email, 'ana@scania.test');

  const wrong = await call('POST', '/auth/login', undefined, {
    email: 'ana@scania.test',
    password: 'errada',
  });
  assert.equal(wrong.status, 401);
  assert.equal(wrong.data.error, 'E-mail ou senha incorretos.');

  const dup = await call('POST', '/auth/register', undefined, {
    name: 'Ana',
    email: 'ana@scania.test',
    password: 'segredo123',
  });
  assert.equal(dup.status, 409);
});

test('sem token não entra nas notas', async () => {
  const res = await call('GET', '/receipts');
  assert.equal(res.status, 401);
});

test('fluxo completo: enviar, ler com IA simulada, corrigir e excluir', async () => {
  const token = await newUser('bia@scania.test');

  const created = await call('POST', '/receipts', token, { image_base64: FAKE_JPEG });
  assert.equal(created.status, 201);
  const id = created.data.id;

  const pending = await call('GET', `/receipts/${id}`, token);
  assert.equal(pending.data.status, 'pending');

  const scanned = await call('POST', `/receipts/${id}/scan`, token);
  assert.equal(scanned.status, 200);

  const done = await call('GET', `/receipts/${id}`, token);
  assert.equal(done.data.status, 'done');
  assert.equal(done.data.total, 87.4);
  assert.equal(done.data.items.length, 4);

  // Ler de novo não duplica os itens.
  await call('POST', `/receipts/${id}/scan`, token);
  const again = await call('GET', `/receipts/${id}`, token);
  assert.equal(again.data.items.length, 4);

  const patched = await call('PATCH', `/receipts/${id}`, token, {
    merchant: 'Padaria',
    purchase_date: null,
    total: 12.5,
    category: 'Alimentação',
  });
  assert.equal(patched.status, 200);
  const edited = await call('GET', `/receipts/${id}`, token);
  assert.equal(edited.data.merchant, 'Padaria');
  assert.equal(edited.data.total, 12.5);

  const removed = await call('DELETE', `/receipts/${id}`, token);
  assert.equal(removed.status, 200);
  const list = await call('GET', '/receipts', token);
  assert.deepEqual(list.data, []);
});

test('um usuário não vê nem mexe na nota do outro', async () => {
  const owner = await newUser('caio@scania.test');
  const intruder = await newUser('davi@scania.test');
  const { data } = await call('POST', '/receipts', owner, { image_base64: FAKE_JPEG });

  assert.equal((await call('GET', `/receipts/${data.id}`, intruder)).status, 404);
  assert.equal((await call('POST', `/receipts/${data.id}/scan`, intruder)).status, 404);
  assert.equal((await call('DELETE', `/receipts/${data.id}`, intruder)).status, 404);
  assert.deepEqual((await call('GET', '/receipts', intruder)).data, []);
  assert.equal((await call('GET', `/receipts/${data.id}`, owner)).status, 200);
});

test('recusa arquivo que não é JPEG', async () => {
  const token = await newUser('eva@scania.test');
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47]).toString('base64');
  const res = await call('POST', '/receipts', token, { image_base64: png });
  assert.equal(res.status, 415);
});

// Regressão: Buffer.from(hex) ignorava letras inválidas no fim da assinatura.
test('link da imagem: abre com assinatura certa e recusa assinatura mexida', async () => {
  const token = await newUser('fabi@scania.test');
  const { data } = await call('POST', '/receipts', token, { image_base64: FAKE_JPEG });
  const { data: link } = await call('GET', `/receipts/${data.id}/image-url`, token);

  const good = await fetch(link.url);
  assert.equal(good.status, 200);
  assert.equal(good.headers.get('content-type'), 'image/jpeg');

  assert.equal((await fetch(`${link.url}x`)).status, 403);
  const zeroed = link.url.replace(/signature=[0-9a-f]+/, `signature=${'0'.repeat(64)}`);
  assert.equal((await fetch(zeroed)).status, 403);
});
