// SQL de usuários e sessões. Só consulta e grava: as regras ficam em services/auth.ts.
import { db } from '../infra/db.ts';

export interface PublicUser {
  id: string;
  name: string;
  email: string;
}

export interface UserRow extends PublicUser {
  password_hash: string;
}

export function findUserByEmail(email: string): UserRow | undefined {
  return db
    .prepare('select id, name, email, password_hash from users where email = ?')
    .get(email) as UserRow | undefined;
}

export function insertUser(user: PublicUser, passwordHash: string): void {
  db.prepare(
    'insert into users (id, name, email, password_hash) values (?, ?, ?, ?)',
  ).run(user.id, user.name, user.email, passwordHash);
}

export function insertSession(tokenHash: string, userId: string): void {
  db.prepare('insert into sessions (token_hash, user_id) values (?, ?)').run(
    tokenHash,
    userId,
  );
}

export function deleteSession(tokenHash: string): void {
  db.prepare('delete from sessions where token_hash = ?').run(tokenHash);
}

// Dono da sessão, se ela existe e foi criada depois de `createdAfter` (ISO).
export function findUserBySession(
  tokenHash: string,
  createdAfter: string,
): PublicUser | undefined {
  return db
    .prepare(
      `select u.id, u.name, u.email from sessions s
       join users u on u.id = s.user_id
       where s.token_hash = ? and s.created_at > ?`,
    )
    .get(tokenHash, createdAfter) as PublicUser | undefined;
}
