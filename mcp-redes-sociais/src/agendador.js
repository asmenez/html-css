// Fila simples de posts agendados, salva em data/fila.json.
// As APIs do Instagram e TikTok não têm agendamento nativo, então guardamos o post
// e executamos na hora marcada (pelo servidor MCP em execução ou pelo `npm run agendador`).
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { DATA_DIR } from "./config.js";
import { actions, runAction } from "./actions.js";

const QUEUE_FILE = path.join(DATA_DIR, "fila.json");
const LOCK_FILE = path.join(DATA_DIR, "fila.lock");

function load() {
  try {
    return JSON.parse(fs.readFileSync(QUEUE_FILE, "utf8"));
  } catch {
    return [];
  }
}

function save(jobs) {
  const tmp = `${QUEUE_FILE}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(jobs, null, 2));
  fs.renameSync(tmp, QUEUE_FILE);
}

export function schedule({ action, args, run_at, note }) {
  if (!actions[action]) throw new Error(`Ação desconhecida: ${action}. Opções: ${Object.keys(actions).join(", ")}`);
  const when = new Date(run_at);
  if (Number.isNaN(when.getTime())) throw new Error(`Data inválida: ${run_at} (use ISO 8601, ex. 2026-12-01T18:00:00-03:00)`);
  const job = {
    id: crypto.randomUUID().slice(0, 8), action, args, run_at: when.toISOString(), note,
    status: "pending", created_at: new Date().toISOString(),
  };
  save([...load(), job]);
  return job;
}

export function list({ status } = {}) {
  return load().filter((j) => !status || j.status === status).sort((a, b) => a.run_at.localeCompare(b.run_at));
}

export function cancel(id) {
  const jobs = load();
  const job = jobs.find((j) => j.id === id);
  if (!job) throw new Error(`Agendamento ${id} não encontrado.`);
  if (job.status !== "pending") throw new Error(`Agendamento ${id} já está "${job.status}".`);
  job.status = "cancelled";
  save(jobs);
  return job;
}

/** Trava entre processos para que o servidor e o CLI nunca publiquem o mesmo post duas vezes. */
function withLock(fn) {
  let fd;
  try {
    fd = fs.openSync(LOCK_FILE, "wx");
  } catch {
    try {
      const age = Date.now() - fs.statSync(LOCK_FILE).mtimeMs;
      if (age < 30 * 60_000) return null; // outro processo está rodando
      fs.rmSync(LOCK_FILE, { force: true }); // trava abandonada
      fd = fs.openSync(LOCK_FILE, "wx");
    } catch {
      return null;
    }
  }
  return Promise.resolve()
    .then(fn)
    .finally(() => {
      fs.closeSync(fd);
      fs.rmSync(LOCK_FILE, { force: true });
    });
}

/** Executa todos os posts com horário vencido. Retorna o que foi processado. */
export async function runDue(log = () => {}) {
  return (await withLock(async () => {
    const done = [];
    for (const due of load().filter((j) => j.status === "pending" && new Date(j.run_at) <= new Date())) {
      const update = (patch) => {
        const jobs = load();
        Object.assign(jobs.find((j) => j.id === due.id), patch);
        save(jobs);
      };
      update({ status: "running", started_at: new Date().toISOString() });
      log(`Publicando ${due.id} (${due.action})...`);
      try {
        const result = await runAction(due.action, due.args);
        update({ status: "done", result, finished_at: new Date().toISOString() });
        done.push({ id: due.id, status: "done", result });
      } catch (err) {
        update({ status: "failed", error: err.message, finished_at: new Date().toISOString() });
        done.push({ id: due.id, status: "failed", error: err.message });
      }
      log(`→ ${due.id}: ${done.at(-1).status}`);
    }
    return done;
  })) ?? [];
}
