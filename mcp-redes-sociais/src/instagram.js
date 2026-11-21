// Instagram Content Publishing API (Meta Graph API).
// Fluxo: 1) cria um "container" de mídia  2) espera processar  3) publica.
// Imagens precisam estar numa URL PÚBLICA (https). Vídeos podem vir de URL pública
// ou de um arquivo local (upload resumível em rupload.facebook.com).
import fs from "node:fs";
import { getConfig, readTokens, saveTokens, sleep } from "./config.js";

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

/** Cria um container de vídeo a partir de video_url OU de um arquivo local (file_path). */
async function createVideoContainer({ video_url, file_path, ...params }) {
  if (!video_url === !file_path) throw new Error("Informe video_url OU file_path para o vídeo.");
  if (video_url) return createContainer({ ...params, video_url });
  const size = fs.statSync(file_path).size;
  const id = await createContainer({ ...params, upload_type: "resumable" });
  const c = cfg();
  const res = await fetch(`https://rupload.facebook.com/ig-api-upload/${c.version}/${id}`, {
    method: "POST",
    headers: { Authorization: `OAuth ${c.accessToken}`, offset: "0", file_size: String(size) },
    body: await fs.openAsBlob(file_path), // envia do disco sem carregar tudo na memória
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || json.success === false) {
    throw new Error(`Falha no upload do vídeo para o Instagram: HTTP ${res.status} ${json.debug_info?.message || json.error?.message || ""}`.trim());
  }
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

export async function publishReel({ video_url, file_path, caption, cover_url, thumb_offset, share_to_feed = true }) {
  const id = await createVideoContainer({
    media_type: "REELS", video_url, file_path, caption, cover_url, thumb_offset, share_to_feed,
  });
  return publishContainer(id);
}

export async function publishStory({ image_url, video_url, file_path }) {
  if ([image_url, video_url, file_path].filter(Boolean).length !== 1) {
    throw new Error("Informe apenas um: image_url, video_url ou file_path (vídeo local) para o story.");
  }
  const id = image_url
    ? await createContainer({ media_type: "STORIES", image_url })
    : await createVideoContainer({ media_type: "STORIES", video_url, file_path });
  return publishContainer(id);
}

/** items: [{ type: "image"|"video", url?, file_path? }] — 2 a 10 itens (file_path só para vídeo). */
export async function publishCarousel({ items, caption }) {
  if (items.length < 2 || items.length > 10) throw new Error("O carrossel precisa ter de 2 a 10 itens.");
  const children = [];
  for (const it of items) {
    if (it.type === "image" && !it.url) throw new Error("Itens de imagem do carrossel precisam de url pública.");
    children.push(it.type === "video"
      ? await createVideoContainer({ media_type: "VIDEO", video_url: it.url, file_path: it.file_path, is_carousel_item: true })
      : await createContainer({ image_url: it.url, is_carousel_item: true }));
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
  saveTokens({ ig_access_token: json.access_token, ig_token_refreshed_at: new Date().toISOString() });
  return { expires_in_days: Math.round(json.expires_in / 86400) };
}

/**
 * Renova o token sozinho se a última renovação tem mais de `maxAgeDays` dias,
 * para que ele nunca chegue a vencer (vence em 60 dias). Chamado pelo servidor e pelo agendador.
 */
export async function maybeRefreshToken({ maxAgeDays = 7, log = () => {} } = {}) {
  const c = getConfig().instagram;
  if (!c.accessToken || c.host !== "graph.instagram.com") return null;
  const { ig_token_refreshed_at: last, ig_token_refresh_tried_at: tried } = readTokens();
  const ageMs = (iso) => (iso ? Date.now() - new Date(iso).getTime() : Infinity);
  if (ageMs(last) < maxAgeDays * 86400_000) return null;
  if (ageMs(tried) < 86400_000) return null; // no máximo uma tentativa por dia
  saveTokens({ ig_token_refresh_tried_at: new Date().toISOString() });
  try {
    const r = await refreshToken();
    log(`Token do Instagram renovado (vale mais ${r.expires_in_days} dias).`);
    return r;
  } catch (err) {
    // Ex.: tokens com menos de 24h ainda não podem ser renovados. Tenta de novo amanhã.
    log(`Não foi possível renovar o token do Instagram: ${err.message}`);
    return null;
  }
}

// Métricas válidas na Graph API v22+ (impressions/plays foram substituídas por views).
const INSIGHT_METRICS = {
  FEED: "views,reach,likes,comments,shares,saved,total_interactions",
  REELS: "views,reach,likes,comments,shares,saved,total_interactions",
  STORY: "views,reach,replies,shares,total_interactions",
};

/** Lista os posts recentes com curtidas/comentários; com media_id, traz os insights daquele post. */
export async function metrics({ media_id, limit = 10 } = {}) {
  if (!media_id) {
    const { data } = await graph("GET", `${cfg().userId}/media`, {
      fields: "id,caption,media_type,media_product_type,permalink,timestamp,like_count,comments_count",
      limit,
    });
    return data;
  }
  const media = await graph("GET", media_id, {
    fields: "id,caption,media_type,media_product_type,permalink,timestamp,like_count,comments_count",
  });
  const metric = INSIGHT_METRICS[media.media_product_type] || INSIGHT_METRICS.FEED;
  try {
    const { data } = await graph("GET", `${media_id}/insights`, { metric });
    media.insights = Object.fromEntries(data.map((m) => [m.name, m.values?.[0]?.value ?? m.total_value?.value]));
  } catch (err) {
    media.insights_erro = err.message;
  }
  return media;
}
