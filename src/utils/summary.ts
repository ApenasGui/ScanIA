import { categoryInfo } from '@/constants/categories';
import type { Receipt } from '@/types';
import { monthRange, toISO } from './date';
import type { YearMonth } from './date';

export interface CategoryTotal {
  category: string;
  color: string;
  icon: string;
  total: number;
  count: number;
  percent: number; // 0 a 100
}

export interface ReceiptSummary {
  total: number;
  count: number;
  average: number;
  byCategory: CategoryTotal[];
}

// Data usada nos relatórios: a da compra, ou a do envio se a IA não a encontrou.
// created_at vem em UTC: converte para o dia NO FUSO DO CELULAR. Sem isso, uma nota
// enviada em 30/11 às 22:30 (horário de Brasília) caía em dezembro.
export function receiptDate(receipt: Receipt): string {
  return receipt.purchase_date ?? toISO(new Date(receipt.created_at));
}

// Porcentagem para mostrar: categoria com valor nunca aparece como "0%".
export function formatPercent(percent: number): string {
  if (percent > 0 && percent < 0.5) return '<1%';
  return `${Math.round(percent)}%`;
}

export function filterByMonth(list: Receipt[], month: YearMonth): Receipt[] {
  const { start, endExclusive } = monthRange(month);
  return list.filter((r) => {
    const date = receiptDate(r);
    return date >= start && date < endExclusive;
  });
}

// Só notas lidas com sucesso entram na conta. Soma em centavos (sem erro de float).
export function summarizeReceipts(list: Receipt[]): ReceiptSummary {
  const totals = new Map<string, { cents: number; count: number }>();
  let all = 0;
  let count = 0;

  for (const r of list) {
    if (r.status !== 'done' || r.total === null) continue;
    const cents = Math.round(r.total * 100);
    const key = categoryInfo(r.category).name;
    const current = totals.get(key) ?? { cents: 0, count: 0 };
    current.cents += cents;
    current.count += 1;
    totals.set(key, current);
    all += cents;
    count += 1;
  }

  const byCategory = Array.from(totals, ([category, { cents, count: n }]) => {
    const info = categoryInfo(category);
    return {
      category,
      color: info.color,
      icon: info.icon,
      total: cents / 100,
      count: n,
      percent: all > 0 ? (cents / all) * 100 : 0,
    };
  }).sort((a, b) => b.total - a.total);

  return {
    total: all / 100,
    count,
    average: count > 0 ? Math.round(all / count) / 100 : 0,
    byCategory,
  };
}
