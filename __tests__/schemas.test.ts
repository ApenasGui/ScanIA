// Regressões do QA nos formulários (bugs 3, 8 e 14): o app precisa barrar
// o que o servidor vai recusar, para o usuário ver o erro no próprio campo.
import { registerSchema } from '@/schemas/auth';
import { receiptSchema } from '@/schemas/receipt';
import { addDaysISO, isoToBr, todayISO } from '@/utils/date';

const receipt = {
  merchant: 'Padaria',
  date: '18/11/2026',
  total: '10,00',
  category: 'Lazer',
};

function receiptErrors(change: Partial<typeof receipt>): string[] {
  const result = receiptSchema.safeParse({ ...receipt, ...change });
  return result.success ? [] : result.error.issues.map((i) => i.message);
}

describe('formulário da nota', () => {
  it('aceita uma nota normal', () => {
    expect(receiptErrors({})).toEqual([]);
  });

  it('recusa valor que arredonda para zero', () => {
    expect(receiptErrors({ total: '0,001' })).toContain(
      'Valor inválido (mínimo R$ 0,01)',
    );
    expect(receiptErrors({ total: '0,01' })).toEqual([]);
  });

  it('recusa data no futuro e data antes de 2000', () => {
    const tomorrow = isoToBr(addDaysISO(todayISO(), 1));
    expect(receiptErrors({ date: tomorrow })).toContain(
      'A data não pode estar no futuro',
    );
    expect(receiptErrors({ date: isoToBr(todayISO()) })).toEqual([]);
    expect(receiptErrors({ date: '31/12/1999' })).toContain(
      'Use uma data a partir de 2000',
    );
  });
});

describe('formulário de cadastro', () => {
  const ok = {
    name: 'Ana',
    email: 'ana@scania.test',
    password: 'segredo',
    confirm: 'segredo',
  };

  it('recusa senha só com espaços', () => {
    const result = registerSchema.safeParse({
      ...ok,
      password: '      ',
      confirm: '      ',
    });
    expect(result.success).toBe(false);
  });

  it('recusa nome gigante', () => {
    expect(registerSchema.safeParse({ ...ok, name: 'A'.repeat(81) }).success).toBe(false);
    expect(registerSchema.safeParse(ok).success).toBe(true);
  });
});
