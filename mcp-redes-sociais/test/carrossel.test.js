// Carrosséis com uma pasta por rede, com GitHub, Instagram e TikTok simulados.
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
process.env.CARROSSEIS_DIR_INSTAGRAM = path.join(tmp, "Projetos Claude", "Carrosseis Instagram");
process.env.CARROSSEIS_DIR_TIKTOK = path.join(tmp, "02. Carrossel Claude & Cia");

async function makeImages(dir, names, color, height = 1350) {
  fs.mkdirSync(dir, { recursive: true });
  for (const n of names) {
    await sharp({ create: { width: 1080, height, channels: 4, background: color } }).png().toFile(path.join(dir, `${n}.png`));
  }
}
// Mesmo carrossel, nomes levemente diferentes; Instagram 4:5 com 3 imagens, TikTok 9:16 com 4.
const igPasta = path.join(process.env.CARROSSEIS_DIR_INSTAGRAM, "Aula 5 — Juros Compostos");
const ttPasta = path.join(process.env.CARROSSEIS_DIR_TIKTOK, "aula 5 - juros compostos");
await makeImages(igPasta, ["10", "2", "1"], "#123456");
await makeImages(ttPasta, ["1", "2", "3", "4"], "#654321", 1920);
fs.writeFileSync(path.join(igPasta, "legenda.txt"), "\uFEFFJuros compostos em 3 slides\n\n#financas");
await makeImages(path.join(process.env.CARROSSEIS_DIR_INSTAGRAM, "Só no Insta"), ["1", "2"], "#111111");

const { runAction } = await import("../src/actions.js");
const carrosseis = await import("../src/carrosseis.js");
const json = (b, s = 200) => new Response(JSON.stringify(b), { status: s });

test("lista as duas pastas e mostra o que existe nas duas redes", () => {
  const l = carrosseis.listCarousels();
  assert.equal(l.instagram.carrosseis.length, 2);
  assert.equal(l.tiktok.carrosseis.length, 1);
  assert.deepEqual(l.nas_duas_redes, ["Aula 5 — Juros Compostos"]);
});

test("acha o mesmo carrossel em cada pasta pelo nome, ignorando acento, traço e maiúsculas", () => {
  assert.equal(carrosseis.resolveFolder("juros compostos", "instagram"), igPasta);
  assert.equal(carrosseis.resolveFolder("juros compostos", "tiktok"), ttPasta);
  assert.equal(carrosseis.resolveFolder("Aula 5 — Juros Compostos", "tiktok"), ttPasta);
  assert.throws(() => carrosseis.resolveFolder("so no insta", "tiktok"), /No tiktok, nenhuma pasta/);
});

test("ordem natural dos nomes (1, 2, 10) e legenda.txt sem BOM", () => {
  const c = carrosseis.readFolder(igPasta);
  assert.deepEqual(c.imagens.map((f) => path.basename(f)), ["1.png", "2.png", "10.png"]);
  assert.equal(c.legenda, "Juros compostos em 3 slides\n\n#financas");
});

test("um comando: cada rede recebe as imagens da sua pasta", async () => {
  const commits = [];
  let blobs = 0, igChildren = 0, ttBody;
  globalThis.fetch = async (url, init = {}) => {
    const u = new URL(url);
    const method = init.method || "GET";
    if (u.host === "api.github.com") {
      if (u.pathname.endsWith("/git/ref/heads/master")) return json({ object: { sha: "base" } });
      if (u.pathname.endsWith("/git/commits/base")) return json({ tree: { sha: "t0" } });
      if (u.pathname.endsWith("/git/blobs")) {
        const buf = Buffer.from(JSON.parse(init.body).content, "base64");
        assert.equal(buf[0], 0xff); // JPEG
        return json({ sha: `b${++blobs}` });
      }
      if (u.pathname.endsWith("/git/trees")) { commits.push(JSON.parse(init.body).tree.map((t) => t.path)); return json({ sha: "t1" }); }
      if (u.pathname.endsWith("/git/commits")) return json({ sha: "c1" });
      if (u.pathname.endsWith("/git/refs/heads/master")) return json({});
    }
    if (u.host === "asmenez.github.io") return new Response(null, { status: 200 });
    if (u.host === "graph.instagram.com") {
      const b = new URLSearchParams(init.body);
      if (u.pathname.endsWith("/1784/media") && b.get("is_carousel_item")) {
        assert.match(b.get("image_url"), /aula-5-juros-compostos/);
        igChildren++; return json({ id: `child${igChildren}` });
      }
      if (u.pathname.endsWith("/1784/media")) { assert.equal(b.get("children"), "child1,child2,child3"); return json({ id: "car" }); }
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

  const r = await runAction("postar_carrossel", { pasta: "juros compostos" });
  assert.equal(r.instagram.ok, true);
  assert.equal(r.instagram.pasta, igPasta);
  assert.equal(r.instagram.imagens, 3);
  assert.equal(r.instagram.legenda_usada, "legenda.txt da pasta");
  assert.equal(r.tiktok.ok, true);
  assert.equal(r.tiktok.pasta, ttPasta);
  assert.equal(r.tiktok.imagens, 4);
  assert.equal(r.tiktok.legenda_usada, "legenda.txt da outra rede");

  assert.equal(commits.length, 2); // uma hospedagem por pasta
  assert.deepEqual(commits.map((c) => c.length).sort(), [3, 4]);
  assert.equal(blobs, 7);
  assert.equal(ttBody.source_info.photo_images.length, 4);
  assert.equal(ttBody.post_info.title, "Juros compostos em 3 slides");
});

test("se a pasta de uma rede não existir, nada é publicado nem enviado", async () => {
  globalThis.fetch = async () => { throw new Error("não deveria chamar a rede"); };
  await assert.rejects(runAction("postar_carrossel", { pasta: "so no insta" }), /Nada foi publicado\. No tiktok, nenhuma pasta/);
});

test("só Instagram funciona com carrossel que só existe lá; pasta_tiktok resolve nomes diferentes", async () => {
  globalThis.fetch = async () => { throw new Error("parar antes da rede"); };
  // Validação passa (chega a tentar hospedar) quando só o Instagram é pedido:
  await assert.rejects(runAction("postar_carrossel", { pasta: "so no insta", redes: ["instagram"] }), /parar antes da rede/);
  // Nome diferente no TikTok, indicado à parte:
  await assert.rejects(runAction("postar_carrossel", { pasta: "so no insta", pasta_tiktok: "juros" }), /parar antes da rede/);
});

test("Instagram recusa mais de 10 imagens antes de enviar qualquer coisa", async () => {
  const big = path.join(process.env.CARROSSEIS_DIR_INSTAGRAM, "grande");
  fs.mkdirSync(big);
  for (let i = 1; i <= 11; i++) fs.copyFileSync(path.join(igPasta, "1.png"), path.join(big, `${i}.png`));
  globalThis.fetch = async () => { throw new Error("não deveria chamar a rede"); };
  await assert.rejects(runAction("postar_carrossel", { pasta: "grande", redes: ["instagram"] }), /2 a 10 imagens/);
});

test("CARROSSEIS_DIR sozinho vale para as duas redes", async () => {
  const { getConfig } = await import("../src/config.js");
  const saved = { i: process.env.CARROSSEIS_DIR_INSTAGRAM, t: process.env.CARROSSEIS_DIR_TIKTOK };
  delete process.env.CARROSSEIS_DIR_INSTAGRAM; delete process.env.CARROSSEIS_DIR_TIKTOK;
  process.env.CARROSSEIS_DIR = "X:/unica";
  assert.deepEqual(getConfig().carrosseisDirs, { instagram: "X:/unica", tiktok: "X:/unica" });
  process.env.CARROSSEIS_DIR_INSTAGRAM = saved.i; process.env.CARROSSEIS_DIR_TIKTOK = saved.t; delete process.env.CARROSSEIS_DIR;
});
