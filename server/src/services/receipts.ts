// Regras das notas: enviar foto, ler com IA, corrigir, excluir e link da imagem.
// Não sabe nada de HTTP (só lança HttpError) nem de SQL (usa repositories/receipts.ts).
import { HttpError } from '../domain/errors.ts';
import {
  ReceiptReadError,
  isCategory,
  isValidPurchaseDate,
  looksLikeJpeg,
  validTotal,
} from '../domain/parse.ts';
import { readReceiptImage } from '../infra/ai.ts';
import { sign, validSignature } from '../infra/signing.ts';
import { readImage, removeImage, saveImage } from '../infra/storage.ts';
import * as receipts from '../repositories/receipts.ts';
import type { ReceiptRow } from '../repositories/receipts.ts';
import type { PublicUser } from '../repositories/users.ts';

const MAX_UPLOAD_BYTES = 5_242_880; // 5 MB, igual ao bucket do guia
const IMAGE_LINK_SECONDS = 3600;

function findOrFail(user: PublicUser, id: string): ReceiptRow {
  const row = receipts.findForUser(user.id, id);
  if (!row) throw new HttpError(404, 'Nota não encontrada.');
  return row;
}

export function listReceipts(user: PublicUser) {
  return receipts.listForUser(user.id);
}

export function getReceipt(user: PublicUser, id: string) {
  const receipt = findOrFail(user, id);
  return { ...receipt, items: receipts.listItems(receipt.id) };
}

export function createReceipt(user: PublicUser, body: Record<string, unknown>) {
  if (typeof body.image_base64 !== 'string' || body.image_base64.length === 0) {
    throw new HttpError(400, 'image_base64 é obrigatório.');
  }
  const bytes = Buffer.from(body.image_base64, 'base64');
  if (bytes.length > MAX_UPLOAD_BYTES)
    throw new HttpError(413, 'A imagem é grande demais.');
  if (!looksLikeJpeg(bytes)) throw new HttpError(415, 'Envie uma imagem JPEG.');

  const imagePath = saveImage(user.id, bytes);
  return { id: receipts.insert(user.id, imagePath) };
}

export function updateReceipt(
  user: PublicUser,
  id: string,
  body: Record<string, unknown>,
) {
  findOrFail(user, id);

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

  receipts.updateManual(user.id, id, { merchant, purchase_date: date, total, category });
}

export function deleteReceipt(user: PublicUser, id: string) {
  const receipt = findOrFail(user, id);
  removeImage(receipt.image_path);
  receipts.remove(user.id, id);
}

// A nota mudou enquanto a IA lia: foi excluída (404) ou o usuário salvou à mão (409).
function scanSkipped(user: PublicUser, id: string): never {
  console.log(`[scan] nota ${id} mudou durante a leitura; resultado da IA descartado`);
  if (!receipts.findForUser(user.id, id))
    throw new HttpError(404, 'Nota não encontrada.');
  throw new HttpError(
    409,
    'Você salvou a nota enquanto a IA lia. Seus dados foram mantidos.',
  );
}

export async function scanReceipt(user: PublicUser, id: string) {
  const receipt = findOrFail(user, id);
  // Marca "esperando a leitura". Se o usuário salvar no meio, vira 'done' e a IA não grava.
  receipts.markPending(receipt.id);
  try {
    const extracted = await readReceiptImage(readImage(receipt.image_path));
    if (!receipts.saveScanResult(receipt.id, extracted)) scanSkipped(user, receipt.id);
    return { ok: true, receipt_id: receipt.id };
  } catch (err) {
    if (err instanceof HttpError) throw err; // 404/409 de scanSkipped
    const expected = err instanceof ReceiptReadError;
    const message = expected
      ? err.message
      : 'Falha ao processar a nota. Tente novamente.';
    if (!receipts.markErrorIfPending(receipt.id, message)) scanSkipped(user, receipt.id);
    if (!expected) console.error('[scan] falha interna:', err);
    throw new HttpError(expected ? 422 : 500, message);
  }
}

// ---------- Foto da nota (não é pública: só por link assinado que vale 1 hora) ----------

export function createImageLink(user: PublicUser, id: string, origin: string) {
  findOrFail(user, id);
  const expires = Math.floor(Date.now() / 1000) + IMAGE_LINK_SECONDS;
  return {
    url: `${origin}/images/${id}?expires=${expires}&signature=${sign(id, expires)}`,
  };
}

export function openSignedImage(id: string, expires: number, signature: string): Buffer {
  if (!validSignature(id, expires, signature)) {
    throw new HttpError(403, 'Link da imagem inválido ou expirado.');
  }
  const imagePath = receipts.findImagePath(id);
  if (!imagePath) throw new HttpError(404, 'Imagem não encontrada.');
  return readImage(imagePath);
}
