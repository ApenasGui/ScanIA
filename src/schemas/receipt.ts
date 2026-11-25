import { z } from 'zod';
import { CATEGORY_NAMES } from '@/constants/categories';
import { brToISO, todayISO } from '@/utils/date';
import { parseMoney, roundMoney } from '@/utils/money';

export const receiptSchema = z.object({
  merchant: z
    .string()
    .trim()
    .min(2, 'Informe o estabelecimento')
    .max(80, 'Máximo de 80 caracteres'),
  date: z
    .string()
    .refine((v) => v === '' || brToISO(v) !== null, 'Data inválida (DD/MM/AAAA)')
    .refine((v) => {
      const iso = brToISO(v);
      return iso === null || iso >= '2000-01-01';
    }, 'Use uma data a partir de 2000')
    .refine((v) => {
      const iso = brToISO(v);
      return iso === null || iso <= todayISO();
    }, 'A data não pode estar no futuro'),
  total: z
    .string()
    .min(1, 'Informe o valor total')
    // Confere o valor JÁ arredondado em centavos: "0,001" vira 0 e não pode passar.
    .refine((v) => {
      const n = parseMoney(v);
      return !Number.isNaN(n) && roundMoney(n) >= 0.01;
    }, 'Valor inválido (mínimo R$ 0,01)')
    .refine((v) => parseMoney(v) <= 9_999_999, 'Valor muito alto'),
  category: z.enum(CATEGORY_NAMES, 'Escolha uma categoria'),
});

export type ReceiptFormData = z.infer<typeof receiptSchema>;
