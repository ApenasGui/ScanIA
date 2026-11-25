// Teste de integração: liga o servidor de verdade (banco em pasta temporária,
// IA simulada) e conversa com ele por HTTP, como o app faz.
// Rodar: npm run test:server
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import type { ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
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
  server = spawn(
    process.execPath,
    [path.join(import.meta.dirname, '..', 'src', 'index.ts')],
    {
      env: {
        ...process.env,
        PORT: String(PORT),
        SCANIA_DATA_DIR: dataDir,
        MOCK_AI: 'true',
      },
      stdio: 'ignore',
    },
  );
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

// ---------- Regressões do QA ----------

async function newReceipt(token: string): Promise<string> {
  const { data } = await call('POST', '/receipts', token, { image_base64: FAKE_JPEG });
  return data.id;
}

const goodPatch = {
  merchant: 'Loja QA',
  purchase_date: '2026-11-10',
  total: 10,
  category: 'Lazer',
};

// Bugs 3, 5, 6, 7 e 14: o servidor aceitava (ou quebrava com) dados ruins.
test('PATCH recusa valor, data e categoria inválidos com 400 (nunca 500)', async () => {
  const token = await newUser('gil@scania.test');
  const id = await newReceipt(token);
  const bad = [
    { total: 0.004 }, // arredondava para 0 e quebrava a regra do banco (500)
    { total: 1e300 },
    { purchase_date: '2026-02-31' },
    { purchase_date: '2026-13-45' },
    { purchase_date: '2099-01-01' },
    { category: 'Hackeado' },
    { category: 123 },
  ];
  for (const change of bad) {
    const res = await call('PATCH', `/receipts/${id}`, token, {
      ...goodPatch,
      ...change,
    });
    assert.equal(res.status, 400, `deveria recusar ${JSON.stringify(change)}`);
  }
  assert.equal((await call('PATCH', `/receipts/${id}`, token, goodPatch)).status, 200);
});

// Bugs 7 e 8: cadastro sem limite de tamanho e com senha só de espaços.
test('cadastro recusa nome/e-mail gigantes e senha só com espaços', async () => {
  const base = { name: 'Hugo', email: 'hugo@scania.test', password: 'segredo123' };
  const bad = [
    { name: 'A'.repeat(81) },
    { email: `${'a'.repeat(250)}@x.test` },
    { password: '      ' },
  ];
  for (const change of bad) {
    const res = await call('POST', '/auth/register', undefined, { ...base, ...change });
    assert.equal(
      res.status,
      400,
      `deveria recusar ${JSON.stringify(change).slice(0, 40)}`,
    );
  }
});

// Bug 1: a leitura da IA terminava depois e apagava a correção do usuário.
test('correção salva durante a leitura da IA não é apagada', async () => {
  const token = await newUser('iris@scania.test');
  const id = await newReceipt(token);
  const scanning = call('POST', `/receipts/${id}/scan`, token); // IA simulada leva 1,5 s
  await new Promise((r) => setTimeout(r, 300));
  const saved = await call('PATCH', `/receipts/${id}`, token, goodPatch);
  assert.equal(saved.status, 200);

  assert.equal((await scanning).status, 409);
  const { data } = await call('GET', `/receipts/${id}`, token);
  assert.equal(data.merchant, 'Loja QA');
  assert.equal(data.total, 10);
  assert.equal(data.status, 'done');
});

// Bug 9: excluir a nota durante a leitura dava erro 500.
test('excluir a nota durante a leitura responde 404, não 500', async () => {
  const token = await newUser('joao@scania.test');
  const id = await newReceipt(token);
  const scanning = call('POST', `/receipts/${id}/scan`, token);
  await new Promise((r) => setTimeout(r, 300));
  assert.equal((await call('DELETE', `/receipts/${id}`, token)).status, 200);
  assert.equal((await scanning).status, 404);
});

// Bug 10: dava para tentar senhas sem limite.
test('login trava depois de 5 senhas erradas', async () => {
  await newUser('lia@scania.test');
  for (let i = 0; i < 5; i++) {
    const res = await call('POST', '/auth/login', undefined, {
      email: 'lia@scania.test',
      password: `errada${i}`,
    });
    assert.equal(res.status, 401);
  }
  const locked = await call('POST', '/auth/login', undefined, {
    email: 'lia@scania.test',
    password: 'segredo123', // até a senha certa espera o bloqueio passar
  });
  assert.equal(locked.status, 429);
});

// Bug 10: sessões nunca expiravam.
test('sessão com mais de 30 dias não vale mais', async () => {
  const token = await newUser('marta@scania.test');
  assert.equal((await call('GET', '/auth/me', token)).status, 200);

  const db = new DatabaseSync(path.join(dataDir, 'scania.db'));
  const hash = createHash('sha256').update(token).digest('hex');
  db.prepare('update sessions set created_at = ? where token_hash = ?').run(
    new Date(Date.now() - 31 * 24 * 60 * 60 * 1000).toISOString(),
    hash,
  );
  db.close();
  assert.equal((await call('GET', '/auth/me', token)).status, 401);
});

// Bug 11: a lista vinha na ordem de envio, não na data da compra.
test('lista ordenada pela data da compra, mais recente primeiro', async () => {
  const token = await newUser('nina@scania.test');
  for (const [merchant, date] of [
    ['Mercado', '2026-11-18'],
    ['Posto', '2026-11-05'],
    ['Farmácia', '2026-11-12'],
  ]) {
    const id = await newReceipt(token);
    await call('PATCH', `/receipts/${id}`, token, {
      ...goodPatch,
      merchant,
      purchase_date: date,
    });
  }
  const { data } = await call('GET', '/receipts', token);
  assert.deepEqual(
    data.map((r: { merchant: string }) => r.merchant),
    ['Mercado', 'Farmácia', 'Posto'],
  );
});
