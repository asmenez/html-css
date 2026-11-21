#!/usr/bin/env node
// Executa a fila de posts agendados sem precisar do cliente MCP aberto.
//   npm run agendador            -> fica rodando e verifica a cada SCHEDULER_INTERVAL_SECONDS
//   npm run agendador -- --once  -> processa o que venceu e sai (ideal para cron)
//   npm run agendador -- --list  -> mostra a fila
import { getConfig, sleep } from "./config.js";
import * as agenda from "./agendador.js";

const log = (msg) => console.log(`[${new Date().toLocaleString("pt-BR")}] ${msg}`);

if (process.argv.includes("--list")) {
  console.table(agenda.list().map(({ id, action, run_at, status, note }) => ({ id, action, run_at, status, note })));
} else if (process.argv.includes("--once")) {
  const r = await agenda.runDue(log);
  log(`${r.length} post(s) processado(s).`);
} else {
  const interval = getConfig().schedulerIntervalSeconds * 1000;
  log(`Agendador rodando (verifica a cada ${interval / 1000}s). Ctrl+C para sair.`);
  for (;;) {
    await agenda.runDue(log).catch((e) => log(`Erro: ${e.message}`));
    await sleep(interval);
  }
}
