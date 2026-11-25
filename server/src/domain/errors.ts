// Erro com status HTTP: a mensagem pode ir para o usuário.
// Os serviços lançam este erro; a camada http só transforma em JSON.
export class HttpError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}
