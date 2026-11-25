// Servidor local do ScanIA. Faz o papel que o Supabase fazia no guia:
// login, banco (SQLite), guarda das fotos e a "Edge Function" que chama a IA.
//
// Camadas (cada uma só chama a de baixo):
//   http/          rotas: HTTP <-> serviços
//   services/      regras (login, leitura com IA, validação, conflitos)
//   repositories/  SQL
//   infra/         banco, IA, disco e assinatura de links
//   domain/        regras puras e erros (sem Node, testadas também no Jest)
import { createServer } from 'node:http';
import { networkInterfaces } from 'node:os';
import { handleRequest } from './http/routes.ts';
import { isMockMode } from './infra/ai.ts';

const PORT = Number(process.env.PORT ?? 3333);

createServer(handleRequest).listen(PORT, '0.0.0.0', () => {
  console.log(
    `ScanIA server na porta ${PORT} | IA: ${isMockMode() ? 'SIMULADA (MOCK_AI)' : 'REAL'}`,
  );
  for (const list of Object.values(networkInterfaces())) {
    for (const net of list ?? []) {
      if (net.family === 'IPv4' && !net.internal) {
        console.log(`  na rede local: http://${net.address}:${PORT}`);
      }
    }
  }
});
