// TikTok Content Posting API (https://developers.tiktok.com/doc/content-posting-api-get-started)
// - DIRECT_POST: publica direto no perfil (requer escopo video.publish).
// - Rascunho/inbox: envia para a caixa de entrada do app, o usuário finaliza no celular (escopo video.upload).
// IMPORTANTE: enquanto o app não passa pela auditoria do TikTok, posts diretos só podem
// ser SELF_ONLY (privados). PULL_FROM_URL exige que o domínio da URL esteja verificado no app.
import fs from "node:fs";
import { getConfig, saveTokens, sleep } from "./config.js";

const API = "https://open.tiktokapis.com";
const MB = 1024 * 1024;

function cfg() {
  const c = getConfig().tiktok;
  if (!c.accessToken) {
    throw new Error("TikTok não configurado: rode `npm run auth:tiktok` ou defina TIKTOK_ACCESS_TOKEN no .env");
  }
  return c;
}

async function api(pathname, body, { retried = false } = {}) {
  const res = await fetch(`${API}${pathname}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${cfg().accessToken}`, "Content-Type": "application/json; charset=UTF-8" },
    body: JSON.stringify(body ?? {}),
  });
  const json = await res.json().catch(() => ({}));
  const code = json.error?.code;
  if (!retried && (res.status === 401 || code === "access_token_invalid") && getConfig().tiktok.refreshToken) {
    await refreshToken();
    return api(pathname, body, { retried: true });
  }
  if (!res.ok || (code && code !== "ok")) {
    throw new Error(`TikTok API ${res.status}: ${code || ""} ${json.error?.message || res.statusText}`.trim());
  }
  return json.data;
}

/** Troca o refresh_token por um novo access_token (válido 24h) e salva em data/tokens.json. */
export async function refreshToken() {
  const c = getConfig().tiktok;
  if (!c.clientKey || !c.clientSecret || !c.refreshToken) {
    throw new Error("Para renovar defina TIKTOK_CLIENT_KEY, TIKTOK_CLIENT_SECRET e TIKTOK_REFRESH_TOKEN.");
  }
  const res = await fetch(`${API}/v2/oauth/token/`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_key: c.clientKey, client_secret: c.clientSecret,
      grant_type: "refresh_token", refresh_token: c.refreshToken,
    }),
  });
  const json = await res.json();
  if (!res.ok || json.error) throw new Error(`Falha ao renovar token do TikTok: ${json.error_description || json.error || res.status}`);
  saveTokens({ tiktok_access_token: json.access_token, tiktok_refresh_token: json.refresh_token });
  return { expires_in_hours: Math.round(json.expires_in / 3600) };
}

/** Obrigatório consultar antes de postar: traz as opções de privacidade permitidas e limites. */
export async function creatorInfo() {
  return api("/v2/post/publish/creator_info/query/");
}

/** Regras de chunk do TikTok: 5–64 MB por parte (a última pode ir até 128 MB); < 64 MB vai inteiro. */
export function chunkPlan(size) {
  if (size <= 64 * MB) return { chunk_size: size, total_chunk_count: 1 };
  const chunk_size = 10 * MB;
  return { chunk_size, total_chunk_count: Math.floor(size / chunk_size) };
}

async function uploadFile(uploadUrl, filePath, size, { chunk_size, total_chunk_count }) {
  const fd = await fs.promises.open(filePath, "r");
  try {
    for (let i = 0; i < total_chunk_count; i++) {
      const start = i * chunk_size;
      const end = i === total_chunk_count - 1 ? size - 1 : start + chunk_size - 1;
      const buf = Buffer.alloc(end - start + 1);
      await fd.read(buf, 0, buf.length, start);
      const res = await fetch(uploadUrl, {
        method: "PUT",
        headers: {
          "Content-Type": filePath.toLowerCase().endsWith(".mov") ? "video/quicktime" : "video/mp4",
          "Content-Length": String(buf.length),
          "Content-Range": `bytes ${start}-${end}/${size}`,
        },
        body: buf,
      });
      if (!res.ok) throw new Error(`Falha no upload da parte ${i + 1}/${total_chunk_count}: HTTP ${res.status} ${await res.text()}`);
    }
  } finally {
    await fd.close();
  }
}

function sourceInfo({ video_url, file_path }) {
  if (!video_url === !file_path) throw new Error("Informe video_url OU file_path.");
  if (video_url) return { info: { source: "PULL_FROM_URL", video_url } };
  const size = fs.statSync(file_path).size;
  const plan = chunkPlan(size);
  return { info: { source: "FILE_UPLOAD", video_size: size, ...plan }, size, plan };
}

/**
 * Publica um vídeo.
 * mode "direct" -> post direto (privacy_level obrigatório); mode "draft" -> vai para a inbox do TikTok.
 */
export async function publishVideo({
  video_url, file_path, mode = "direct", title, privacy_level,
  disable_comment = false, disable_duet = false, disable_stitch = false,
  video_cover_timestamp_ms, is_aigc, brand_content_toggle = false, brand_organic_toggle = false,
  wait = true,
}) {
  const src = sourceInfo({ video_url, file_path });
  let data;
  if (mode === "draft") {
    data = await api("/v2/post/publish/inbox/video/init/", { source_info: src.info });
  } else {
    const creator = await creatorInfo();
    const level = privacy_level || creator.privacy_level_options?.[0];
    if (!creator.privacy_level_options?.includes(level)) {
      throw new Error(`privacy_level "${level}" não permitido. Opções: ${creator.privacy_level_options?.join(", ")}`);
    }
    data = await api("/v2/post/publish/video/init/", {
      post_info: {
        title, privacy_level: level, disable_comment, disable_duet, disable_stitch,
        video_cover_timestamp_ms, is_aigc, brand_content_toggle, brand_organic_toggle,
      },
      source_info: src.info,
    });
  }
  if (file_path) await uploadFile(data.upload_url, file_path, src.size, src.plan);
  const result = { publish_id: data.publish_id, mode };
  return wait ? { ...result, ...(await waitForPublish(data.publish_id)) } : result;
}

/** Carrossel de fotos (só PULL_FROM_URL; JPG/WEBP; até 35 fotos). */
export async function publishPhotos({
  photo_urls, title, description, mode = "direct", privacy_level, cover_index = 0,
  disable_comment = false, auto_add_music = true, wait = true,
}) {
  const post_info = { title, description };
  if (mode === "direct") {
    const creator = await creatorInfo();
    const level = privacy_level || creator.privacy_level_options?.[0];
    if (!creator.privacy_level_options?.includes(level)) {
      throw new Error(`privacy_level "${level}" não permitido. Opções: ${creator.privacy_level_options?.join(", ")}`);
    }
    Object.assign(post_info, { privacy_level: level, disable_comment, auto_add_music });
  }
  const data = await api("/v2/post/publish/content/init/", {
    post_info,
    source_info: { source: "PULL_FROM_URL", photo_cover_index: cover_index, photo_images: photo_urls },
    post_mode: mode === "draft" ? "MEDIA_UPLOAD" : "DIRECT_POST",
    media_type: "PHOTO",
  });
  const result = { publish_id: data.publish_id, mode };
  return wait ? { ...result, ...(await waitForPublish(data.publish_id)) } : result;
}

export async function publishStatus(publish_id) {
  return api("/v2/post/publish/status/fetch/", { publish_id });
}

export async function waitForPublish(publish_id, { timeoutMs = 10 * 60_000, intervalMs = 5_000 } = {}) {
  const start = Date.now();
  for (;;) {
    const s = await publishStatus(publish_id);
    if (s.status === "PUBLISH_COMPLETE" || s.status === "SEND_TO_USER_INBOX") return s;
    if (s.status === "FAILED") throw new Error(`Publicação TikTok falhou: ${s.fail_reason || "motivo desconhecido"}`);
    if (Date.now() - start > timeoutMs) return { ...s, note: "Ainda processando; consulte com tiktok_status." };
    await sleep(intervalMs);
  }
}
