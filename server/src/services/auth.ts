// Cadastro, login e sessão. Senha com scrypt (vem no Node), token aleatório.
// Só regras: o SQL fica em repositories/users.ts.
import {
  createHash,
  randomBytes,
  randomUUID,
  scryptSync,
  timingSafeEqual,
} from 'node:crypto';
import { HttpError } from '../domain/errors.ts';
import {
  deleteSession,
  findUserByEmail,
  findUserBySession,
  insertSession,
  insertUser,
} from '../repositories/users.ts';
import type { PublicUser } from '../repositories/users.ts';

export type { PublicUser };

const MAX_NAME = 80;
const MAX_EMAIL = 254;
const MAX_PASSWORD = 200;
const SESSION_DAYS = 30;

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

// Guardamos só o hash do token: se alguém copiar o banco, não consegue entrar.
const sha256 = (text: string) => createHash('sha256').update(text).digest('hex');

function createSession(userId: string): string {
  const token = randomBytes(32).toString('hex');
  insertSession(sha256(token), userId);
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

  if (findUserByEmail(email)) throw new HttpError(409, 'Este e-mail já está cadastrado.');

  const user: PublicUser = { id: randomUUID(), name, email };
  insertUser(user, hashPassword(password));
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

  const row = findUserByEmail(email);

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
  deleteSession(sha256(token));
}

// Devolve o dono do token, ou null.
// Sessão mais velha que 30 dias não vale mais: o usuário entra de novo.
export function userFromToken(token: string | null): PublicUser | null {
  if (!token) return null;
  const oldest = new Date(Date.now() - SESSION_DAYS * 24 * 60 * 60 * 1000).toISOString();
  return findUserBySession(sha256(token), oldest) ?? null;
}
