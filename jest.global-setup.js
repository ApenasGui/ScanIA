// Todos os testes rodam no fuso de Brasília, em qualquer máquina.
// Assim os bugs de fuso horário (UTC x horário local) aparecem sempre do mesmo jeito.
module.exports = () => {
  process.env.TZ = 'America/Sao_Paulo';
};
