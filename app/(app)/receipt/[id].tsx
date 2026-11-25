import { useLocalSearchParams, useRouter } from 'expo-router';
import { ActivityIndicator, Image, StyleSheet, Text, View } from 'react-native';
import { Button } from '@/components/Button';
import { Card } from '@/components/Card';
import { ReceiptForm } from '@/components/ReceiptForm';
import { Screen } from '@/components/Screen';
import { ErrorState, LoadingView } from '@/components/StateViews';
import { StatusBadge } from '@/components/StatusBadge';
import {
  useDeleteReceipt,
  useReanalyzeReceipt,
  useReceipt,
  useReceiptImageUrl,
  useUpdateReceipt,
} from '@/hooks/useReceipts';
import { colors, radius, spacing } from '@/theme';
import { confirmAction, showMessage } from '@/utils/dialogs';
import { friendlyError } from '@/utils/errors';
import { formatMoney } from '@/utils/money';

export default function ReceiptDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { data: receipt, isLoading, isError, error, refetch } = useReceipt(id);
  const { data: imageUrl } = useReceiptImageUrl(receipt?.id);
  const update = useUpdateReceipt();
  const remove = useDeleteReceipt();
  const reanalyze = useReanalyzeReceipt();

  if (isLoading) return <LoadingView />;
  if (isError || !receipt) {
    return <ErrorState message={friendlyError(error)} onRetry={refetch} />;
  }

  // Cópia com tipo certo para usar dentro das funções abaixo.
  const current = receipt;

  function confirmDelete() {
    confirmAction(
      'Excluir nota',
      'A nota e a foto serão apagadas. Não dá para desfazer.',
      'Excluir',
      () =>
        remove.mutate(current, {
          // Sem tela anterior (link aberto direto), "voltar" não existe: vai para a lista.
          onSuccess: () => (router.canGoBack() ? router.back() : router.replace('/')),
          onError: (e) => showMessage('Erro ao excluir', friendlyError(e)),
        }),
    );
  }

  function retry() {
    reanalyze.mutate(current.id, {
      onError: (e) => showMessage('A leitura falhou', friendlyError(e)),
    });
  }

  const failed = current.status === 'error';
  const pending = current.status === 'pending';
  const items = current.items ?? [];

  return (
    <Screen scroll edges={['bottom', 'left', 'right']}>
      <View style={styles.imageBox}>
        {imageUrl ? (
          <Image source={{ uri: imageUrl }} style={styles.image} resizeMode="contain" />
        ) : (
          <ActivityIndicator color={colors.primary} />
        )}
      </View>

      <View style={styles.statusRow}>
        <StatusBadge status={current.status} />
      </View>

      {failed || pending ? (
        <Card>
          <Text style={styles.problemTitle}>
            {failed ? 'Não foi possível ler a nota' : 'Esta nota ainda não foi lida'}
          </Text>
          {current.error_message ? (
            <Text style={styles.problemText}>{current.error_message}</Text>
          ) : null}
          <Button
            title="Analisar novamente"
            onPress={retry}
            loading={reanalyze.isPending}
            style={styles.retry}
          />
          <Text style={styles.problemHint}>
            Ou preencha os dados abaixo manualmente e salve.
          </Text>
        </Card>
      ) : null}

      <ReceiptForm
        key={`${current.id}-${current.status}-${current.total}`}
        receipt={current}
        submitting={update.isPending}
        onSubmit={(input) =>
          update.mutate(
            { id: current.id, input },
            {
              onSuccess: () =>
                showMessage('Salvo', 'Os dados da nota foram atualizados.'),
              onError: (e) => showMessage('Não foi possível salvar', friendlyError(e)),
            },
          )
        }
      />

      {items.length > 0 ? (
        <Card style={styles.items}>
          <Text style={styles.itemsTitle}>Itens da nota</Text>
          {items.map((item) => (
            <View key={item.id} style={styles.itemRow}>
              <View style={styles.itemInfo}>
                <Text style={styles.itemName}>{item.description}</Text>
                <Text style={styles.itemMeta}>
                  {item.quantity} ×{' '}
                  {item.unit_price !== null ? formatMoney(item.unit_price) : '—'}
                </Text>
              </View>
              <Text style={styles.itemTotal}>{formatMoney(item.total_price)}</Text>
            </View>
          ))}
        </Card>
      ) : null}

      <Button
        title="Excluir nota"
        variant="danger"
        onPress={confirmDelete}
        loading={remove.isPending}
        style={styles.delete}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  imageBox: {
    height: 260,
    backgroundColor: colors.border,
    borderRadius: radius.lg,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.md,
  },
  image: { width: '100%', height: '100%' },
  statusRow: { marginBottom: spacing.md },
  problemTitle: { fontSize: 16, fontWeight: '700', color: colors.text },
  problemText: { fontSize: 14, color: colors.danger, marginTop: 4 },
  problemHint: { fontSize: 13, color: colors.muted, marginTop: spacing.sm },
  retry: { marginTop: spacing.md },
  items: { marginTop: spacing.lg },
  itemsTitle: {
    fontSize: 17,
    fontWeight: '700',
    color: colors.text,
    marginBottom: spacing.sm,
  },
  itemRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 8,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  itemInfo: { flex: 1 },
  itemName: { fontSize: 15, color: colors.text },
  itemMeta: { fontSize: 12, color: colors.muted, marginTop: 2 },
  itemTotal: { fontSize: 15, fontWeight: '700', color: colors.text },
  delete: { marginTop: spacing.sm },
});
