// Carrossel a partir de pasta local, com GitHub, Instagram e TikTok simulados.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "carrossel-"));
process.env.DATA_DIR = path.join(tmp, "data");
process.env.IG_ACCESS_TOKEN = "IGtoken";
process.env.IG_USER_ID = "1784";
process.env.TIKTOK_ACCESS_TOKEN = "tt";
process.env.GITHUB_TOKEN = "ghtoken";
process.env.CARROSSEIS_DIR = path.join(tmp, "02. Carrossel Claude & Cia");

const pasta = path.join(process.env.CARROSSEIS_DIR, "Aula 5 — Juros Compostos");
fs.mkdirSync(pasta, { recursive: true });
for (const n of ["10", "2", "1"]) {
  await sharp({ create: { width: 1080, height: 1350, channels: 4, background: "#123456" } }).png().toFile(path.join(pasta, `${n}.png`));
}
fs.writeFileSync(path.join(pasta, "legenda.txt"), "﻿Juros compostos em 3 slides\n\n#financas #investimentos");
fs.writeFileSync(path.join(pasta, "notas.docx"), "ignorar");

const { runAction } = await import("../src/actions.js");
const carrosseis = await import("../src/carrosseis.js");
const json = (b, s = 200) => new Response(JSON.stringify(b), { status: s });

test("lista carrosséis e encontra pasta por parte do nome, sem acento", () => {
  const l = carrosseis.listCarousels();
  assert.equal(l.carrosseis.length, 1);
  assert.deepEqual({ ...l.carrosseis[0], modificada: undefined }, { pasta: "Aula 5 — Juros Compostos", imagens: 3, tem_legenda: true, modificada: undefined });
  assert.equal(carrosseis.resolveFolder("juros"), pasta);
  assert.throws(() => carrosseis.resolveFolder("inexistente"), /não encontrada/);
});

test("ordem natural dos nomes (1, 2, 10) e legenda.txt sem BOM", () => {
  const c = carrosseis.readFolder(pasta);
  assert.deepEqual(c.imagens.map((f) => path.basename(f)), ["1.png", "2.png", "10.png"]);
  assert.equal(c.legenda, "Juros compostos em 3 slides\n\n#financas #investimentos");
});

test("postar_carrossel: converte, hospeda num commit e publica nas duas redes", async () => {
  const gh = [];
  let tree, igChildren = 0, ttBody;
  globalThis.fetch = async (url, init = {}) => {
    const u = new URL(url);
    const method = init.method || "GET";
    if (u.host === "api.github.com") {
      gh.push(`${method} ${u.pathname.replace("/repos/asmenez/html-css", "")}`);
      assert.equal(init.headers.Authorization, "Bearer ghtoken");
      if (u.pathname.endsWith("/git/ref/heads/master")) return json({ object: { sha: "base" } });
      if (u.pathname.endsWith("/git/commits/base")) return json({ tree: { sha: "t0" } });
      if (u.pathname.endsWith("/git/blobs")) {
        const buf = Buffer.from(JSON.parse(init.body).content, "base64");
        assert.equal(buf[0], 0xff); assert.equal(buf[1], 0xd8); // é JPEG
        return json({ sha: `b${gh.length}` });
      }
      if (u.pathname.endsWith("/git/trees")) { tree = JSON.parse(init.body); return json({ sha: "t1" }); }
      if (u.pathname.endsWith("/git/commits")) return json({ sha: "c1" });
      if (u.pathname.endsWith("/git/refs/heads/master")) { assert.equal(JSON.parse(init.body).sha, "c1"); return json({}); }
    }
    if (u.host === "asmenez.github.io") { assert.equal(method, "HEAD"); return new Response(null, { status: 200 }); }
    if (u.host === "graph.instagram.com") {
      const b = new URLSearchParams(init.body);
      if (u.pathname.endsWith("/1784/media") && b.get("is_carousel_item")) { igChildren++; return json({ id: `child${igChildren}` }); }
      if (u.pathname.endsWith("/1784/media")) {
        assert.equal(b.get("media_type"), "CAROUSEL");
        assert.equal(b.get("children"), "child1,child2,child3");
        assert.match(b.get("caption"), /^Juros compostos/);
        return json({ id: "car" });
      }
      if (u.pathname.endsWith("/media_publish")) return json({ id: "post1" });
      if (method === "GET" && /child\d|car$/.test(u.pathname)) return json({ status_code: "FINISHED" });
      return json({ permalink: "https://instagram.com/p/abc" });
    }
    if (u.host === "open.tiktokapis.com") {
      if (u.pathname.endsWith("/creator_info/query/")) return json({ data: { privacy_level_options: ["SELF_ONLY"] }, error: { code: "ok" } });
      if (u.pathname.endsWith("/content/init/")) { ttBody = JSON.parse(init.body); return json({ data: { publish_id: "pp" }, error: { code: "ok" } }); }
      if (u.pathname.endsWith("/status/fetch/")) return json({ data: { status: "PUBLISH_COMPLETE" }, error: { code: "ok" } });
    }
    throw new Error(`inesperado ${method} ${u}`);
  };

  const r = await runAction("postar_carrossel", { pasta: "aula 5" });
  assert.equal(r.legenda_usada, "legenda.txt");
  assert.equal(r.instagram.ok, true);
  assert.equal(r.instagram.permalink, "https://instagram.com/p/abc");
  assert.equal(r.tiktok.ok, true);

  assert.deepEqual(gh.filter((x) => !x.includes("blobs")), [
    "GET /git/ref/heads/master", "GET /git/commits/base", "POST /git/trees", "POST /git/commits", "PATCH /git/refs/heads/master",
  ]);
  assert.equal(gh.filter((x) => x.includes("blobs")).length, 3);
  assert.equal(tree.base_tree, "t0");
  assert.match(tree.tree[0].path, /^carrosseis\/aula-5-juros-compostos-\d{8}-\d{6}\/01\.jpg$/);
  assert.match(tree.tree[2].path, /\/03\.jpg$/);

  assert.equal(ttBody.media_type, "PHOTO");
  assert.equal(ttBody.post_info.title, "Juros compostos em 3 slides");
  assert.equal(ttBody.post_info.privacy_level, "SELF_ONLY");
  assert.equal(ttBody.source_info.photo_images.length, 3);
  assert.match(ttBody.source_info.photo_images[0], /^https:\/\/asmenez\.github\.io\/html-css\/carrosseis\/aula-5-juros-compostos-.*\/01\.jpg$/);
});

test("Instagram recusa carrossel com mais de 10 imagens antes de enviar qualquer coisa", async () => {
  const big = path.join(process.env.CARROSSEIS_DIR, "grande");
  fs.mkdirSync(big);
  for (let i = 1; i <= 11; i++) fs.copyFileSync(path.join(pasta, "1.png"), path.join(big, `${i}.png`));
  globalThis.fetch = async () => { throw new Error("não deveria chamar a rede"); };
  await assert.rejects(runAction("postar_carrossel", { pasta: "grande", redes: ["instagram"] }), /2 a 10 imagens/);
});
