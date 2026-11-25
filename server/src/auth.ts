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
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
    throw new HttpError(400, 'E-mail inválido.');
  if (password.length < 6)
    throw new HttpError(400, 'Use pelo menos 6 caracteres na senha.');

  const exists = db.prepare('select id from users where email = ?').get(email);
  if (exists) throw new HttpError(409, 'Este e-mail já está cadastrado.');

  const user: PublicUser = { id: randomUUID(), name, email };
  db.prepare(
    'insert into users (id, name, email, password_hash) values (?, ?, ?, ?)',
  ).run(user.id, user.name, user.email, hashPassword(password));
  return { token: createSession(user.id), user };
}

export function login(body: Record<string, unknown>) {
  const email = normalizeEmail(body.email);
  const password = typeof body.password === 'string' ? body.password : '';

  const row = db
    .prepare('select id, name, email, password_hash from users where email = ?')
    .get(email) as UserRow | undefined;

  // Mesma mensagem para e-mail inexistente e senha errada: não revela quem tem conta.
  if (!row || !checkPassword(password, row.password_hash)) {
    throw new HttpError(401, 'E-mail ou senha incorretos.');
  }
  const user: PublicUser = { id: row.id, name: row.name, email: row.email };
  return { token: createSession(user.id), user };
}

export function logout(token: string) {
  db.prepare('delete from sessions where token_hash = ?').run(sha256(token));
}

// Lê "Authorization: Bearer <token>" e devolve o usuário, ou null.
export function userFromToken(token: string | null): PublicUser | null {
  if (!token) return null;
  const row = db
    .prepare(
      `select u.id, u.name, u.email from sessions s
       join users u on u.id = s.user_id
       where s.token_hash = ?`,
    )
    .get(sha256(token)) as PublicUser | undefined;
  return row ?? null;
}
