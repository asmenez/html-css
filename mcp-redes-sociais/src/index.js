#!/usr/bin/env node
// Servidor MCP (stdio) para publicar e agendar posts no Instagram e no TikTok.
// Use com Claude Desktop, Claude Code ou qualquer cliente MCP.
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { getConfig } from "./config.js";
import { actions, runAction } from "./actions.js";
import * as ig from "./instagram.js";
import * as tt from "./tiktok.js";
import * as agenda from "./agendador.js";
import * as carrosseis from "./carrosseis.js";

const server = new McpServer({ name: "mcp-redes-sociais", version: "1.0.0" });

const ok = (data) => ({ content: [{ type: "text", text: JSON.stringify(data, null, 2) }] });
const fail = (err) => ({ content: [{ type: "text", text: `Erro: ${err.message}` }], isError: true });
const wrap = (fn) => async (args) => {
  try {
    return ok(await fn(args));
  } catch (err) {
    return fail(err);
  }
};

// Ferramentas de publicação imediata
for (const [name, action] of Object.entries(actions)) {
  server.registerTool(
    name,
    { description: action.description, inputSchema: action.schema, annotations: { destructiveHint: false, openWorldHint: true } },
    wrap((args) => runAction(name, args)),
  );
}

// Consultas
server.registerTool(
  "status_contas",
  { description: "Verifica se as contas do Instagram e TikTok estão configuradas e retorna dados básicos e limites.", inputSchema: {} },
  wrap(async () => {
    const [igInfo, igLimit, ttInfo] = await Promise.allSettled([ig.accountInfo(), ig.publishingLimit(), tt.creatorInfo()]);
    const v = (r) => (r.status === "fulfilled" ? r.value : { erro: r.reason.message });
    return { instagram: { conta: v(igInfo), limite_24h: v(igLimit) }, tiktok: v(ttInfo) };
  }),
);

server.registerTool(
  "tiktok_status",
  { description: "Consulta o status de uma publicação do TikTok pelo publish_id.", inputSchema: { publish_id: z.string() } },
  wrap(({ publish_id }) => tt.publishStatus(publish_id)),
);

server.registerTool(
  "renovar_tokens",
  { description: "Renova os tokens de acesso (TikTok expira em 24h; Instagram em 60 dias).", inputSchema: {} },
  wrap(async () => {
    const [i, t] = await Promise.allSettled([ig.refreshToken(), tt.refreshToken()]);
    const v = (r) => (r.status === "fulfilled" ? r.value : { erro: r.reason.message });
    return { instagram: v(i), tiktok: v(t) };
  }),
);

server.registerTool(
  "instagram_metricas",
  {
    description:
      "Métricas do Instagram. Sem media_id: lista os posts recentes com curtidas e comentários. " +
      "Com media_id: traz visualizações, alcance, salvamentos e compartilhamentos daquele post.",
    inputSchema: {
      media_id: z.string().optional(),
      limit: z.number().int().min(1).max(50).optional(),
    },
  },
  wrap((args) => ig.metrics(args)),
);

server.registerTool(
  "tiktok_metricas",
  {
    description: "Vídeos recentes do TikTok com visualizações, curtidas, comentários e compartilhamentos (escopo video.list).",
    inputSchema: { limit: z.number().int().min(1).max(20).optional() },
  },
  wrap((args) => tt.metrics(args)),
);

server.registerTool(
  "listar_carrosseis",
  {
    description: "Lista as pastas de carrossel em CARROSSEIS_DIR (mais recentes primeiro), com número de imagens e se têm legenda.txt.",
    inputSchema: {},
  },
  wrap(() => carrosseis.listCarousels()),
);

// Agendamento
server.registerTool(
  "agendar_post",
  {
    description:
      "Agenda uma publicação para uma data/hora futura. 'action' é o nome de uma ferramenta de publicação " +
      `(${Object.keys(actions).join(", ")}) e 'args' são os mesmos argumentos dela. ` +
      "Os posts saem enquanto este servidor (ou `npm run agendador`) estiver rodando.",
    inputSchema: {
      action: z.enum(Object.keys(actions)),
      args: z.record(z.string(), z.any()),
      run_at: z.string().describe("Data/hora ISO 8601 com fuso, ex. 2026-12-01T18:00:00-03:00"),
      note: z.string().optional().describe("Anotação livre"),
    },
  },
  wrap(({ action, args, run_at, note }) => {
    z.object(actions[action].schema).parse(args); // valida já no agendamento
    return agenda.schedule({ action, args, run_at, note });
  }),
);

server.registerTool(
  "listar_agendados",
  {
    description: "Lista os posts agendados (e o histórico de executados).",
    inputSchema: { status: z.enum(["pending", "running", "done", "failed", "cancelled"]).optional() },
  },
  wrap(({ status }) => agenda.list({ status })),
);

server.registerTool(
  "cancelar_agendado",
  { description: "Cancela um post agendado pendente.", inputSchema: { id: z.string() } },
  wrap(({ id }) => agenda.cancel(id)),
);

const log = (msg) => console.error(`[mcp-redes-sociais] ${msg}`); // stdout é do protocolo MCP
const tick = async () => {
  await ig.maybeRefreshToken({ log });
  await agenda.runDue(log);
};
tick().catch((e) => log(e.message));
setInterval(() => tick().catch((e) => log(e.message)), getConfig().schedulerIntervalSeconds * 1000).unref();

await server.connect(new StdioServerTransport());
log("servidor iniciado");
