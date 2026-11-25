// Cadastro, login e sessão. Senha com scrypt (vem no Node), token aleatório.
import {
  createHash,
  randomBytes,
  randomUUID,
  scryptSync,
  timingSafeEqual,
} from 'node:crypto';
import { db } from './db.ts';

export interface PublicUser {
  id: string;
  name: string;
  email: string;
}

const MAX_NAME = 80;
const MAX_EMAIL = 254;
const MAX_PASSWORD = 200;
const SESSION_DAYS = 30;

interface UserRow extends PublicUser {
  password_hash: string;
}

// Erro com status HTTP: a mensagem pode ir para o usuário.
export class HttpError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

function hashPassword(password: string): string {
  const salt = randomBytes(16).toString('hex');
  const hash = scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

function checkPassword(password: string, stored: string): boolean {
  const [salt, hash] = stored.split(':');
  const expected = Buffer.from(hash, 'hex');
  const actual = scryptSync(password, salt, 64);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

const sha256 = (text: string) => createHash('sha256').update(text).digest('hex');

function createSession(userId: string): string {
  const token = randomBytes(32).toString('hex');
  db.prepare('insert into sessions (token_hash, user_id) values (?, ?)').run(
    sha256(token),
    userId,
  );
  return token;
}

function normalizeEmail(email: unknown): string {
  return typeof email === 'string' ? email.trim().toLowerCase() : '';
}

export function register(body: Record<string, unknown>) {
  const name = typeof body.name === 'string' ? body.name.trim() : '';
  const email = normalizeEmail(body.email);
  const password = typeof body.password === 'string' ? body.password : '';

  // O app já valida, mas o servidor nunca confia no app.
  if (name.length < 2) throw new HttpError(400, 'Informe seu nome.');
  if (name.length > MAX_NAME) throw new HttpError(400, 'Nome muito longo.');
  if (email.length > MAX_EMAIL || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
    throw new HttpError(400, 'E-mail inválido.');
  if (password.length < 6 || !/\S/.test(password))
    throw new HttpError(400, 'Use pelo menos 6 caracteres na senha.');
  if (password.length > MAX_PASSWORD) throw new HttpError(400, 'Senha muito longa.');

  const exists = db.prepare('select id from users where email = ?').get(email);
  if (exists) throw new HttpError(409, 'Este e-mail já está cadastrado.');

  const user: PublicUser = { id: randomUUID(), name, email };
  db.prepare(
    'insert into users (id, name, email, password_hash) values (?, ?, ?, ?)',
  ).run(user.id, user.name, user.email, hashPassword(password));
  return { token: createSession(user.id), user };
}

// Trava simples contra quem tenta adivinhar senha: 5 erros seguidos no mesmo e-mail
// bloqueiam o login dele por 15 minutos. Fica na memória (zera se o servidor reiniciar).
const MAX_FAILS = 5;
const LOCK_MS = 15 * 60 * 1000;
const failedLogins = new Map<string, { count: number; since: number }>();

export function login(body: Record<string, unknown>) {
  const email = normalizeEmail(body.email);
  const password = typeof body.password === 'string' ? body.password : '';

  const fails = failedLogins.get(email);
  if (fails && Date.now() - fails.since > LOCK_MS) failedLogins.delete(email);
  else if (fails && fails.count >= MAX_FAILS) {
    console.warn(`[auth] login bloqueado por excesso de tentativas: ${email}`);
    throw new HttpError(429, 'Muitas tentativas. Espere 15 minutos e tente de novo.');
  }

  const row = db
    .prepare('select id, name, email, password_hash from users where email = ?')
    .get(email) as UserRow | undefined;

  // Mesma mensagem para e-mail inexistente e senha errada: não revela quem tem conta.
  if (
    !row ||
    password.length > MAX_PASSWORD ||
    !checkPassword(password, row.password_hash)
  ) {
    const current = failedLogins.get(email) ?? { count: 0, since: Date.now() };
    failedLogins.set(email, { ...current, count: current.count + 1 });
    throw new HttpError(401, 'E-mail ou senha incorretos.');
  }
  failedLogins.delete(email);
  const user: PublicUser = { id: row.id, name: row.name, email: row.email };
  return { token: createSession(user.id), user };
}

export function logout(token: string) {
  db.prepare('delete from sessions where token_hash = ?').run(sha256(token));
}

// Lê "Authorization: Bearer <token>" e devolve o usuário, ou null.
// Sessão mais velha que 30 dias não vale mais: o usuário entra de novo.
export function userFromToken(token: string | null): PublicUser | null {
  if (!token) return null;
  const oldest = new Date(Date.now() - SESSION_DAYS * 24 * 60 * 60 * 1000).toISOString();
  const row = db
    .prepare(
      `select u.id, u.name, u.email from sessions s
       join users u on u.id = s.user_id
       where s.token_hash = ? and s.created_at > ?`,
    )
    .get(sha256(token), oldest) as PublicUser | undefined;
  return row ?? null;
}
