// Transforma qualquer erro em uma frase em português para mostrar ao usuário.
// As mensagens do nosso servidor já vêm em português; aqui tratamos as da rede.
export function friendlyError(error: unknown): string {
  const message =
    typeof error === 'object' && error !== null && 'message' in error
      ? String((error as { message: unknown }).message)
      : String(error);

  if (/network request failed|failed to fetch|load failed/i.test(message)) {
    return 'Sem conexão com o servidor. Confira se ele está ligado (npm run server) e se o celular está na mesma rede Wi-Fi.';
  }
  if (/aborted|timeout/i.test(message)) {
    return 'O servidor demorou demais para responder. Tente de novo.';
  }
  return message;
}
