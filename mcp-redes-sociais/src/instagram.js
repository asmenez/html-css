// Instagram Content Publishing API (Meta Graph API).
// Fluxo: 1) cria um "container" de mídia  2) espera processar  3) publica.
// A Meta baixa a mídia de uma URL PÚBLICA (https) — arquivos locais não são aceitos.
import { getConfig, saveTokens, sleep } from "./config.js";

function cfg() {
  const c = getConfig().instagram;
  if (!c.accessToken || !c.userId) {
    throw new Error("Instagram não configurado: defina IG_ACCESS_TOKEN e IG_USER_ID no .env");
  }
  return c;
}

async function graph(method, pathname, params = {}) {
  const c = cfg();
  const url = new URL(`https://${c.host}/${c.version}/${pathname}`);
  const body = new URLSearchParams();
  for (const [k, v] of Object.entries({ ...params, access_token: c.accessToken })) {
    if (v === undefined || v === null) continue;
    (method === "GET" ? url.searchParams : body).set(k, String(v));
  }
  const res = await fetch(url, method === "GET" ? {} : { method, body });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || json.error) {
    const e = json.error || {};
    throw new Error(`Instagram API ${res.status}: ${e.message || res.statusText}` +
      (e.error_user_msg ? ` — ${e.error_user_msg}` : "") + (e.code ? ` (code ${e.code})` : ""));
  }
  return json;
}

async function createContainer(params) {
  const { id } = await graph("POST", `${cfg().userId}/media`, params);
  return id;
}

/** Aguarda o container ficar FINISHED (vídeos levam de segundos a minutos). */
export async function waitForContainer(containerId, { timeoutMs = 10 * 60_000, intervalMs = 5_000 } = {}) {
  const start = Date.now();
  for (;;) {
    const s = await graph("GET", containerId, { fields: "status_code,status" });
    if (s.status_code === "FINISHED" || s.status_code === "PUBLISHED") return s;
    if (s.status_code === "ERROR" || s.status_code === "EXPIRED") {
      throw new Error(`Container ${containerId} falhou: ${s.status_code} ${s.status || ""}`.trim());
    }
    if (Date.now() - start > timeoutMs) {
      throw new Error(`Tempo esgotado esperando o container ${containerId} (último status: ${s.status_code})`);
    }
    await sleep(intervalMs);
  }
}

async function publishContainer(containerId) {
  await waitForContainer(containerId);
  const { id } = await graph("POST", `${cfg().userId}/media_publish`, { creation_id: containerId });
  let permalink;
  try {
    ({ permalink } = await graph("GET", id, { fields: "permalink" }));
  } catch { /* stories não têm permalink */ }
  return { media_id: id, container_id: containerId, permalink };
}

export async function publishImage({ image_url, caption, alt_text }) {
  const id = await createContainer({ image_url, caption, alt_text });
  return publishContainer(id);
}

export async function publishReel({ video_url, caption, cover_url, thumb_offset, share_to_feed = true }) {
  const id = await createContainer({
    media_type: "REELS", video_url, caption, cover_url, thumb_offset, share_to_feed,
  });
  return publishContainer(id);
}

export async function publishStory({ image_url, video_url }) {
  if (!image_url === !video_url) throw new Error("Informe image_url OU video_url para o story.");
  const id = await createContainer({ media_type: "STORIES", image_url, video_url });
  return publishContainer(id);
}

/** items: [{ type: "image"|"video", url }] — 2 a 10 itens. */
export async function publishCarousel({ items, caption }) {
  if (items.length < 2 || items.length > 10) throw new Error("O carrossel precisa ter de 2 a 10 itens.");
  const children = [];
  for (const it of items) {
    children.push(await createContainer(
      it.type === "video"
        ? { media_type: "VIDEO", video_url: it.url, is_carousel_item: true }
        : { image_url: it.url, is_carousel_item: true },
    ));
  }
  for (const child of children) await waitForContainer(child);
  const id = await createContainer({ media_type: "CAROUSEL", children: children.join(","), caption });
  return publishContainer(id);
}

/** Quantos posts ainda cabem nas últimas 24h (limite da Meta: 100 posts via API). */
export async function publishingLimit() {
  return graph("GET", `${cfg().userId}/content_publishing_limit`, { fields: "quota_usage,config" });
}

export async function accountInfo() {
  return graph("GET", cfg().userId, { fields: "id,username,media_count" });
}

/** Renova o token de longa duração (só no modo graph.instagram.com). Válido por +60 dias. */
export async function refreshToken() {
  const c = cfg();
  if (c.host !== "graph.instagram.com") {
    throw new Error("A renovação automática só funciona com IG_GRAPH_HOST=graph.instagram.com.");
  }
  const url = new URL("https://graph.instagram.com/refresh_access_token");
  url.searchParams.set("grant_type", "ig_refresh_token");
  url.searchParams.set("access_token", c.accessToken);
  const res = await fetch(url);
  const json = await res.json();
  if (!res.ok || json.error) throw new Error(`Falha ao renovar token do Instagram: ${json.error?.message || res.status}`);
  saveTokens({ ig_access_token: json.access_token });
  return { expires_in_days: Math.round(json.expires_in / 86400) };
}
