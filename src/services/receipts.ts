// Conversa com o servidor local sobre notas. Cada função = uma rota do server/src/index.ts.
import { api } from '@/lib/api';
import type { Receipt, ReceiptUpdate } from '@/types';

export function listReceipts(): Promise<Receipt[]> {
  return api<Receipt[]>('/receipts');
}

export function getReceipt(id: string): Promise<Receipt> {
  return api<Receipt>(`/receipts/${id}`);
}

// Envia a foto (JPEG em base64). O servidor guarda na pasta do usuário e cria a nota "pending".
export async function uploadReceipt(base64: string): Promise<string> {
  const { id } = await api<{ id: string }>('/receipts', {
    method: 'POST',
    body: { image_base64: base64 },
  });
  return id;
}

// A IA no servidor desiste em ~90 s no pior caso (server/src/ai.ts). Esperamos mais que
// isso: se o app desistir antes, a nota fica "não lida" e o usuário paga duas leituras.
const READ_TIMEOUT_MS = 150_000;

// Pede ao servidor para ler a nota com IA. Em caso de falha, a mensagem vem do servidor.
export async function analyzeReceipt(receiptId: string): Promise<void> {
  await api(`/receipts/${receiptId}/scan`, {
    method: 'POST',
    timeoutMs: READ_TIMEOUT_MS,
  });
}

export async function updateReceipt(id: string, input: ReceiptUpdate): Promise<void> {
  await api(`/receipts/${id}`, { method: 'PATCH', body: input });
}

// Apaga a foto e a nota (os itens vão junto).
export async function deleteReceipt(receipt: Pick<Receipt, 'id'>): Promise<void> {
  await api(`/receipts/${receipt.id}`, { method: 'DELETE' });
}

// A foto não é pública: o servidor devolve um link assinado que vale 1 hora.
export async function getImageUrl(receiptId: string): Promise<string> {
  const { url } = await api<{ url: string }>(`/receipts/${receiptId}/image-url`);
  return url;
}
