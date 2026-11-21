import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// Carrega o .env da raiz do projeto (sem dependências externas).
const envFile = path.join(ROOT_DIR, ".env");
if (fs.existsSync(envFile)) {
  const parsed = {};
  for (const line of fs.readFileSync(envFile, "utf8").replace(/^\uFEFF/, "").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/i);
    if (!m || line.trim().startsWith("#")) continue;
    parsed[m[1]] = m[2].replace(/^(['"])(.*)\1$/, "$2").trim(); // linha repetida: vale a última
  }
  for (const [k, v] of Object.entries(parsed)) if (process.env[k] === undefined) process.env[k] = v;
}

/**
 * Descobre o endereço da API pelo formato do token:
 * "IG..." = login do Instagram (graph.instagram.com); "EAA..." = login do Facebook/unificado (graph.facebook.com).
 */
export function igHostFor(token, configured) {
  if (/^IG/.test(token)) return "graph.instagram.com";
  if (/^EA/.test(token)) return "graph.facebook.com";
  return configured || "graph.instagram.com";
}

export const DATA_DIR = path.resolve(ROOT_DIR, process.env.DATA_DIR || "./data");
fs.mkdirSync(DATA_DIR, { recursive: true });

const TOKENS_FILE = path.join(DATA_DIR, "tokens.json");

/** Tokens renovados ficam em data/tokens.json e têm prioridade sobre o .env. */
export function readTokens() {
  try {
    return JSON.parse(fs.readFileSync(TOKENS_FILE, "utf8"));
  } catch {
    return {};
  }
}

export function saveTokens(patch) {
  const next = { ...readTokens(), ...patch, updated_at: new Date().toISOString() };
  fs.writeFileSync(TOKENS_FILE, JSON.stringify(next, null, 2), { mode: 0o600 });
  return next;
}

export function getConfig() {
  const t = readTokens();
  return {
    instagram: {
      accessToken: t.ig_access_token || process.env.IG_ACCESS_TOKEN || "",
      userId: process.env.IG_USER_ID || "",
      host: igHostFor(t.ig_access_token || process.env.IG_ACCESS_TOKEN || "", process.env.IG_GRAPH_HOST),
      version: process.env.IG_API_VERSION || "v23.0",
    },
    tiktok: {
      clientKey: process.env.TIKTOK_CLIENT_KEY || "",
      clientSecret: process.env.TIKTOK_CLIENT_SECRET || "",
      redirectUri: process.env.TIKTOK_REDIRECT_URI || "",
      accessToken: t.tiktok_access_token || process.env.TIKTOK_ACCESS_TOKEN || "",
      refreshToken: t.tiktok_refresh_token || process.env.TIKTOK_REFRESH_TOKEN || "",
    },
    schedulerIntervalSeconds: Number(process.env.SCHEDULER_INTERVAL_SECONDS || 60),
  };
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
