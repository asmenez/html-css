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
