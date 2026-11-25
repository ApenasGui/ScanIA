// SQL de notas e itens. Só consulta e grava: as regras ficam em services/receipts.ts.
// Regra de ouro no lugar do RLS do guia: TODA consulta feita a pedido de um usuário
// filtra por user_id.
import { randomUUID } from 'node:crypto';
import type { ExtractedReceipt } from '../domain/parse.ts';
import { db } from '../infra/db.ts';

export interface ReceiptRow {
  id: string;
  user_id: string;
  image_path: string;
  status: 'pending' | 'done' | 'error';
  merchant: string | null;
  purchase_date: string | null;
  total: number | null;
  category: string | null;
  payment_method: string | null;
  error_message: string | null;
  created_at: string;
}

export interface ManualUpdate {
  merchant: string;
  purchase_date: string | null;
  total: number;
  category: string;
}

export function findForUser(userId: string, id: string): ReceiptRow | undefined {
  return db
    .prepare('select * from receipts where id = ? and user_id = ?')
    .get(id, userId) as ReceiptRow | undefined;
}

// Mais recentes primeiro pela data da COMPRA; sem data, vale a do envio.
export function listForUser(userId: string): ReceiptRow[] {
  return db
    .prepare(
      `select * from receipts where user_id = ?
       order by coalesce(purchase_date, substr(created_at, 1, 10)) desc, created_at desc`,
    )
    .all(userId) as unknown as ReceiptRow[];
}

export function listItems(receiptId: string) {
  return db
    .prepare('select * from receipt_items where receipt_id = ? order by rowid')
    .all(receiptId);
}

export function insert(userId: string, imagePath: string): string {
  const id = randomUUID();
  db.prepare('insert into receipts (id, user_id, image_path) values (?, ?, ?)').run(
    id,
    userId,
    imagePath,
  );
  return id;
}

// Correção feita pelo usuário: a nota passa a valer como lida.
export function updateManual(userId: string, id: string, data: ManualUpdate): void {
  db.prepare(
    `update receipts set merchant = ?, purchase_date = ?, total = ?, category = ?,
     status = 'done', error_message = null where id = ? and user_id = ?`,
  ).run(data.merchant, data.purchase_date, data.total, data.category, id, userId);
}

export function remove(userId: string, id: string): void {
  // Os itens vão junto (on delete cascade).
  db.prepare('delete from receipts where id = ? and user_id = ?').run(id, userId);
}

// Usado pelo link assinado da imagem, que não tem login (a assinatura já é a prova).
export function findImagePath(id: string): string | undefined {
  const row = db.prepare('select image_path from receipts where id = ?').get(id) as
    { image_path: string } | undefined;
  return row?.image_path;
}

// ---------- Leitura com IA ----------

export function markPending(id: string): void {
  db.prepare(
    `update receipts set status = 'pending', error_message = null where id = ?`,
  ).run(id);
}

// Grava o que a IA leu, mas só se a nota AINDA está esperando a leitura. Se o usuário
// salvou a correção (vira 'done') ou excluiu a nota enquanto a IA lia, nada é gravado
// e a função devolve false.
export function saveScanResult(id: string, r: ExtractedReceipt): boolean {
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

// Marca a falha da leitura, com a mesma regra: só se a nota ainda espera a leitura.
export function markErrorIfPending(id: string, message: string): boolean {
  const { changes } = db
    .prepare(
      `update receipts set status = 'error', error_message = ?
       where id = ? and status = 'pending'`,
    )
    .run(message, id);
  return changes > 0;
}
