// Banco local em um único arquivo SQLite. O node:sqlite já vem com o Node 24:
// nada para instalar, nada na nuvem.
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

// SCANIA_DATA_DIR permite aos testes usarem uma pasta temporária.
export const DATA_DIR = process.env.SCANIA_DATA_DIR
  ? path.resolve(process.env.SCANIA_DATA_DIR)
  : path.resolve(import.meta.dirname, '..', 'data');
export const UPLOADS_DIR = path.join(DATA_DIR, 'uploads');

mkdirSync(UPLOADS_DIR, { recursive: true });

export const db = new DatabaseSync(path.join(DATA_DIR, 'scania.db'));

// Sem isto o SQLite ignora "on delete cascade".
db.exec('PRAGMA foreign_keys = ON;');
db.exec('PRAGMA journal_mode = WAL;');

db.exec(`
  create table if not exists users (
    id text primary key,
    name text not null,
    email text not null unique,
    password_hash text not null,
    created_at text not null default (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
  );

  -- Guardamos só o hash do token: se alguém copiar o banco, não consegue entrar.
  create table if not exists sessions (
    token_hash text primary key,
    user_id text not null references users (id) on delete cascade,
    created_at text not null default (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
  );

  create table if not exists receipts (
    id text primary key,
    user_id text not null references users (id) on delete cascade,
    image_path text not null,
    status text not null default 'pending'
      check (status in ('pending', 'done', 'error')),
    merchant text,
    purchase_date text,
    total real check (total is null or total > 0),
    category text,
    payment_method text,
    error_message text,
    created_at text not null default (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
  );

  create table if not exists receipt_items (
    id text primary key,
    receipt_id text not null references receipts (id) on delete cascade,
    description text not null,
    quantity real not null default 1,
    unit_price real,
    total_price real not null
  );

  create index if not exists receipts_user_created_idx
    on receipts (user_id, created_at desc);
  create index if not exists receipt_items_receipt_idx
    on receipt_items (receipt_id);
`);
