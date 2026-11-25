import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  analyzeReceipt,
  deleteReceipt,
  getImageUrl,
  getReceipt,
  listReceipts,
  updateReceipt,
  uploadReceipt,
} from '@/services/receipts';
import type { Receipt, ReceiptUpdate } from '@/types';
import { friendlyError } from '@/utils/errors';

export function useReceipts() {
  return useQuery({ queryKey: ['receipts', 'list'], queryFn: listReceipts });
}

export function useReceipt(id: string | undefined) {
  return useQuery({
    queryKey: ['receipts', 'detail', id],
    queryFn: () => getReceipt(id as string),
    enabled: Boolean(id),
  });
}

// O link assinado vale 1 hora; guardamos em cache por 50 minutos.
export function useReceiptImageUrl(receiptId: string | undefined) {
  return useQuery({
    queryKey: ['receipts', 'image', receiptId],
    queryFn: () => getImageUrl(receiptId as string),
    enabled: Boolean(receiptId),
    staleTime: 50 * 60 * 1000,
  });
}

export type ScanStep = 'upload' | 'analyze';

interface ScanVariables {
  base64: string;
  onStep: (step: ScanStep) => void;
}

export interface ScanResult {
  id: string;
  error: string | null; // preenchido se a IA falhou (a nota fica salva para tentar de novo)
}

export function useScanReceipt() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ base64, onStep }: ScanVariables): Promise<ScanResult> => {
      onStep('upload');
      const id = await uploadReceipt(base64);

      onStep('analyze');
      try {
        await analyzeReceipt(id);
        return { id, error: null };
      } catch (error) {
        return { id, error: friendlyError(error) };
      }
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: ['receipts'] }),
  });
}

export function useReanalyzeReceipt() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => analyzeReceipt(id),
    onSettled: () => queryClient.invalidateQueries({ queryKey: ['receipts'] }),
  });
}

export function useUpdateReceipt() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: ReceiptUpdate }) =>
      updateReceipt(id, input),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['receipts'] }),
  });
}

export function useDeleteReceipt() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (receipt: Pick<Receipt, 'id'>) => deleteReceipt(receipt),
    // Só a lista é recarregada. O detalhe NÃO: a nota não existe mais e
    // pedir de novo daria "Nota não encontrada" antes de a tela fechar.
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['receipts', 'list'] }),
  });
}
