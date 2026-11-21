// Testes offline: a rede é simulada substituindo globalThis.fetch.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "mcp-redes-"));
process.env.IG_ACCESS_TOKEN = "ig-token";
process.env.IG_USER_ID = "1784";
process.env.TIKTOK_ACCESS_TOKEN = "tt-token";

const { chunkPlan } = await import("../src/tiktok.js");
const { runAction } = await import("../src/actions.js");
const agenda = await import("../src/agendador.js");

const MB = 1024 * 1024;
const json = (body, status = 200) => new Response(JSON.stringify(body), { status });

test("chunkPlan segue as regras do TikTok", () => {
  assert.deepEqual(chunkPlan(3 * MB), { chunk_size: 3 * MB, total_chunk_count: 1 });
  assert.deepEqual(chunkPlan(64 * MB), { chunk_size: 64 * MB, total_chunk_count: 1 });
  const p = chunkPlan(79 * MB);
  assert.equal(p.total_chunk_count, 7);
  assert.ok(79 * MB - p.chunk_size * 6 <= 128 * MB);
});

test("instagram_post_image: cria container, espera e publica", async () => {
  const calls = [];
  globalThis.fetch = async (url, init = {}) => {
    const u = new URL(url);
    calls.push(`${init.method || "GET"} ${u.pathname}`);
    if (u.pathname.endsWith("/1784/media")) return json({ id: "c1" });
    if (u.pathname.endsWith("/c1")) return json({ status_code: "FINISHED" });
    if (u.pathname.endsWith("/media_publish")) {
      assert.equal(new URLSearchParams(init.body).get("creation_id"), "c1");
      return json({ id: "m1" });
    }
    if (u.pathname.endsWith("/m1")) return json({ permalink: "https://instagram.com/p/x" });
    throw new Error("inesperado " + u);
  };
  const r = await runAction("instagram_post_image", { image_url: "https://ex.com/a.jpg", caption: "oi" });
  assert.deepEqual(r, { media_id: "m1", container_id: "c1", permalink: "https://instagram.com/p/x" });
  assert.deepEqual(calls, ["POST /v23.0/1784/media", "GET /v23.0/c1", "POST /v23.0/1784/media_publish", "GET /v23.0/m1"]);
});

test("tiktok_post_video: upload de arquivo local em modo direto", async () => {
  const file = path.join(process.env.DATA_DIR, "v.mp4");
  fs.writeFileSync(file, Buffer.alloc(1000, 1));
  let put;
  globalThis.fetch = async (url, init = {}) => {
    const u = String(url);
    if (u.endsWith("/creator_info/query/")) return json({ data: { privacy_level_options: ["SELF_ONLY"] }, error: { code: "ok" } });
    if (u.endsWith("/video/init/")) {
      const b = JSON.parse(init.body);
      assert.equal(b.post_info.privacy_level, "SELF_ONLY");
      assert.deepEqual(b.source_info, { source: "FILE_UPLOAD", video_size: 1000, chunk_size: 1000, total_chunk_count: 1 });
      return json({ data: { publish_id: "p1", upload_url: "https://upload.tiktok/x" }, error: { code: "ok" } });
    }
    if (u === "https://upload.tiktok/x") { put = init.headers; return new Response(null, { status: 201 }); }
    if (u.endsWith("/status/fetch/")) return json({ data: { status: "PUBLISH_COMPLETE" }, error: { code: "ok" } });
    throw new Error("inesperado " + u);
  };
  const r = await runAction("tiktok_post_video", { file_path: file, title: "teste #fyp" });
  assert.equal(r.status, "PUBLISH_COMPLETE");
  assert.equal(put["Content-Range"], "bytes 0-999/1000");
});

test("tiktok rejeita privacidade não permitida", async () => {
  globalThis.fetch = async () => json({ data: { privacy_level_options: ["SELF_ONLY"] }, error: { code: "ok" } });
  await assert.rejects(
    runAction("tiktok_post_video", { video_url: "https://ex.com/v.mp4", privacy_level: "PUBLIC_TO_EVERYONE" }),
    /não permitido/,
  );
});

test("agendador executa posts vencidos uma única vez", async () => {
  globalThis.fetch = async (url) => {
    const p = new URL(url).pathname;
    if (p.endsWith("/media")) return json({ id: "c2" });
    if (p.endsWith("/c2")) return json({ status_code: "FINISHED" });
    if (p.endsWith("/media_publish")) return json({ id: "m2" });
    return json({ permalink: "https://instagram.com/p/y" });
  };
  const past = agenda.schedule({ action: "instagram_post_image", args: { image_url: "https://ex.com/b.jpg" }, run_at: "2020-01-01T00:00:00Z" });
  const future = agenda.schedule({ action: "instagram_post_image", args: { image_url: "https://ex.com/c.jpg" }, run_at: "2099-01-01T00:00:00Z" });
  const r = await agenda.runDue();
  assert.deepEqual(r.map((x) => [x.id, x.status]), [[past.id, "done"]]);
  assert.deepEqual(await agenda.runDue(), []);
  assert.equal(agenda.cancel(future.id).status, "cancelled");
  assert.throws(() => agenda.schedule({ action: "x", args: {}, run_at: "2030-01-01" }), /desconhecida/);
});

test("instagram_post_reel com arquivo local usa upload resumível", async () => {
  const file = path.join(process.env.DATA_DIR, "reel.mp4");
  fs.writeFileSync(file, Buffer.alloc(2048, 2));
  let upload;
  globalThis.fetch = async (url, init = {}) => {
    const u = new URL(url);
    if (u.pathname.endsWith("/1784/media")) {
      const b = new URLSearchParams(init.body);
      assert.equal(b.get("upload_type"), "resumable");
      assert.equal(b.get("media_type"), "REELS");
      assert.equal(b.get("video_url"), null);
      return json({ id: "c9", uri: "https://rupload.facebook.com/ig-api-upload/v23.0/c9" });
    }
    if (u.host === "rupload.facebook.com") {
      upload = { path: u.pathname, headers: init.headers, size: init.body.size };
      return json({ success: true });
    }
    if (u.pathname.endsWith("/c9")) return json({ status_code: "FINISHED" });
    if (u.pathname.endsWith("/media_publish")) return json({ id: "m9" });
    return json({ permalink: "https://instagram.com/reel/z" });
  };
  const r = await runAction("instagram_post_reel", { file_path: file, caption: "reel local" });
  assert.equal(r.media_id, "m9");
  assert.equal(upload.path, "/ig-api-upload/v23.0/c9");
  assert.equal(upload.headers.Authorization, "OAuth ig-token");
  assert.equal(upload.headers.file_size, "2048");
  assert.equal(upload.size, 2048);
});

test("agendador tenta de novo em erro temporário e desiste em erro definitivo", async () => {
  globalThis.fetch = async () => json({ error: { message: "Service temporarily unavailable", code: 2 } }, 503);
  const job = agenda.schedule({ action: "instagram_post_image", args: { image_url: "https://ex.com/d.jpg" }, run_at: "2020-01-01T00:00:00Z" });
  const [r1] = await agenda.runDue();
  assert.equal(r1.status, "retry");
  assert.ok(new Date(r1.run_at) > new Date());
  assert.equal(agenda.list({ status: "pending" }).find((j) => j.id === job.id).attempts, 1);

  globalThis.fetch = async () => json({ error: { message: "Invalid parameter", code: 100 } }, 400);
  const bad = agenda.schedule({ action: "instagram_post_image", args: { image_url: "https://ex.com/e.jpg" }, run_at: "2020-01-01T00:00:00Z" });
  const results = await agenda.runDue();
  assert.equal(results.find((x) => x.id === bad.id).status, "failed");
  agenda.cancel(job.id);
});

test("isTransient classifica erros", () => {
  assert.ok(agenda.isTransient("Instagram API 500: erro"));
  assert.ok(agenda.isTransient("TypeError: fetch failed"));
  assert.ok(agenda.isTransient("Instagram API 400: Application request limit reached (code 4)"));
  assert.ok(!agenda.isTransient("Instagram API 400: Invalid parameter (code 100)"));
  assert.ok(!agenda.isTransient("privacy_level não permitido"));
});

test("métricas do Instagram e do TikTok", async () => {
  globalThis.fetch = async (url, init = {}) => {
    const u = new URL(url);
    if (u.host === "open.tiktokapis.com") {
      assert.match(u.search, /view_count/);
      return json({ data: { videos: [{ id: "v1", view_count: 42 }] }, error: { code: "ok" } });
    }
    if (u.pathname.endsWith("/m1/insights")) {
      assert.match(u.searchParams.get("metric"), /views/);
      return json({ data: [{ name: "views", values: [{ value: 120 }] }, { name: "reach", values: [{ value: 90 }] }] });
    }
    if (u.pathname.endsWith("/m1")) return json({ id: "m1", media_product_type: "REELS", like_count: 7 });
    if (u.pathname.endsWith("/1784/media")) return json({ data: [{ id: "m1" }] });
    throw new Error("inesperado " + u);
  };
  const ig = await import("../src/instagram.js");
  const tt = await import("../src/tiktok.js");
  assert.deepEqual(await ig.metrics(), [{ id: "m1" }]);
  const m = await ig.metrics({ media_id: "m1" });
  assert.deepEqual(m.insights, { views: 120, reach: 90 });
  assert.deepEqual(await tt.metrics(), [{ id: "v1", view_count: 42 }]);
});

test("renovação automática do token do Instagram: no máximo uma tentativa por dia", async () => {
  const ig = await import("../src/instagram.js");
  let calls = 0;
  globalThis.fetch = async () => { calls++; return json({ access_token: "novo", expires_in: 5184000 }); };
  assert.equal((await ig.maybeRefreshToken()).expires_in_days, 60);
  assert.equal(await ig.maybeRefreshToken(), null); // recém-renovado
  assert.equal(calls, 1);
  const { readTokens } = await import("../src/config.js");
  assert.equal(readTokens().ig_access_token, "novo");
});

test("endereço da API do Instagram é descoberto pelo token", async () => {
  const { igHostFor } = await import("../src/config.js");
  assert.equal(igHostFor("IGAAx123", "graph.facebook.com"), "graph.instagram.com");
  assert.equal(igHostFor("EAAGm0PX4", "graph.instagram.com"), "graph.facebook.com");
  assert.equal(igHostFor("outro", "graph.facebook.com"), "graph.facebook.com");
  assert.equal(igHostFor("outro", undefined), "graph.instagram.com");
});
