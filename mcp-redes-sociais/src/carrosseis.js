// Carrosséis a partir de pastas do computador, uma pasta-base por rede:
//   CARROSSEIS_DIR_INSTAGRAM e CARROSSEIS_DIR_TIKTOK (ou CARROSSEIS_DIR para as duas).
// Cada subpasta é um carrossel: as imagens entram em ordem de nome (1, 2, ... 10)
// e um legenda.txt opcional vira a legenda. O mesmo carrossel é achado pelo nome nas duas pastas.
import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { getConfig } from "./config.js";
import * as hosting from "./hospedagem.js";
import * as ig from "./instagram.js";
import * as tt from "./tiktok.js";

export const REDES = ["instagram", "tiktok"];
const ENV_NAME = { instagram: "CARROSSEIS_DIR_INSTAGRAM", tiktok: "CARROSSEIS_DIR_TIKTOK" };
const IMAGE_EXT = /\.(jpe?g|png|webp)$/i;
const CAPTION_FILES = ["legenda.txt", "legenda.md", "caption.txt"];
const naturalSort = (a, b) => a.localeCompare(b, "pt-BR", { numeric: true, sensitivity: "base" });
const norm = (s) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

function baseDir(rede) {
  const dir = getConfig().carrosseisDirs[rede];
  if (!dir) throw new Error(`Defina ${ENV_NAME[rede]} (ou CARROSSEIS_DIR) no .env com a pasta dos carrosséis do ${rede}.`);
  if (!fs.existsSync(dir)) throw new Error(`A pasta de carrosséis do ${rede} não existe: ${dir}`);
  return dir;
}

const subdirs = (base) => fs.readdirSync(base, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name);

/** Acha a subpasta do carrossel na pasta da rede: nome exato, sem acentos/maiúsculas, ou parte do nome. */
export function resolveFolder(pasta, rede) {
  if (!pasta) throw new Error("Informe a pasta do carrossel.");
  if (path.isAbsolute(pasta)) {
    if (fs.existsSync(pasta)) return pasta;
    throw new Error(`Pasta não encontrada: ${pasta}`);
  }
  const base = baseDir(rede);
  const direct = path.join(base, pasta);
  if (fs.existsSync(direct)) return direct;
  const names = subdirs(base);
  const exact = names.filter((d) => norm(d) === norm(pasta));
  const partial = names.filter((d) => norm(d).includes(norm(pasta)));
  const found = exact.length ? exact : partial;
  if (found.length === 1) return path.join(base, found[0]);
  if (found.length > 1) throw new Error(`No ${rede}, mais de uma pasta combina com "${pasta}": ${found.join(", ")}. Seja mais específico.`);
  throw new Error(`No ${rede}, nenhuma pasta combina com "${pasta}" em ${base}. Use listar_carrosseis para ver as opções.`);
}

export function readFolder(folder) {
  const names = fs.readdirSync(folder).filter((f) => IMAGE_EXT.test(f)).sort(naturalSort);
  const captionFile = CAPTION_FILES.map((f) => path.join(folder, f)).find((f) => fs.existsSync(f));
  return {
    pasta: folder,
    imagens: names.map((n) => path.join(folder, n)),
    legenda: captionFile ? fs.readFileSync(captionFile, "utf8").replace(/^﻿/, "").trim() : undefined,
  };
}

function listBase(rede) {
  const base = baseDir(rede);
  return subdirs(base)
    .map((name) => {
      const c = readFolder(path.join(base, name));
      return { pasta: name, imagens: c.imagens.length, tem_legenda: Boolean(c.legenda),
        modificada: fs.statSync(path.join(base, name)).mtime.toISOString().slice(0, 10) };
    })
    .filter((c) => c.imagens > 0)
    .sort((a, b) => b.modificada.localeCompare(a.modificada));
}

/** Lista os carrosséis de cada rede e indica quais existem nas duas (pelo nome). */
export function listCarousels() {
  const out = {};
  for (const rede of REDES) {
    try {
      out[rede] = { pasta_base: baseDir(rede), carrosseis: listBase(rede) };
    } catch (err) {
      out[rede] = { erro: err.message };
    }
  }
  if (out.instagram.carrosseis && out.tiktok.carrosseis) {
    const tiktokNames = new Set(out.tiktok.carrosseis.map((c) => norm(c.pasta)));
    out.nas_duas_redes = out.instagram.carrosseis.filter((c) => tiktokNames.has(norm(c.pasta))).map((c) => c.pasta);
  }
  return out;
}

const slug = (s) => norm(s).replace(/ /g, "-").slice(0, 40) || "carrossel";

/** Converte para JPEG (Instagram só aceita JPEG) com no máximo 1080 px de largura. */
export async function toJpeg(file) {
  return sharp(file).rotate().resize({ width: 1080, withoutEnlargement: true })
    .flatten({ background: "#ffffff" }).jpeg({ quality: 90, mozjpeg: true }).toBuffer();
}

/** Converte e hospeda as imagens; devolve as URLs públicas. */
export async function hostImages(images, name) {
  const stamp = new Date().toISOString().replace(/[-:]/g, "").replace("T", "-").slice(0, 15);
  const dir = `carrosseis/${slug(name)}-${stamp}`;
  const files = [];
  for (const [i, img] of images.entries()) {
    files.push({ path: `${dir}/${String(i + 1).padStart(2, "0")}.jpg`, content: await toJpeg(img) });
  }
  const urls = await hosting.uploadFiles(files, `Carrossel: ${name}`);
  return hosting.waitUntilOnline(urls);
}

/**
 * Publica um carrossel nas redes escolhidas, cada uma com as imagens da sua pasta.
 * Confere tudo ANTES de enviar qualquer coisa: se a pasta de uma rede não for achada, nada é publicado.
 * Legenda: parâmetro > legenda.txt da pasta da rede > legenda.txt da outra rede.
 */
export async function postCarousel({
  pasta, pasta_instagram, pasta_tiktok, redes = REDES, legenda, titulo_tiktok,
  tiktok_mode = "direct", tiktok_privacy_level, auto_add_music = true,
}) {
  const override = { instagram: pasta_instagram, tiktok: pasta_tiktok };
  const plan = {};
  const problems = [];
  for (const rede of redes) {
    try {
      const folder = resolveFolder(override[rede] || pasta, rede);
      const c = readFolder(folder);
      if (!c.imagens.length) throw new Error(`Nenhuma imagem JPG, PNG ou WEBP em ${folder}.`);
      if (rede === "instagram" && (c.imagens.length < 2 || c.imagens.length > 10)) {
        throw new Error(`O Instagram aceita de 2 a 10 imagens no carrossel; ${folder} tem ${c.imagens.length}.`);
      }
      if (rede === "tiktok" && c.imagens.length > 35) throw new Error(`O TikTok aceita até 35 fotos; ${folder} tem ${c.imagens.length}.`);
      plan[rede] = c;
    } catch (err) {
      problems.push(err.message);
    }
  }
  if (problems.length) throw new Error(`Nada foi publicado. ${problems.join(" | ")}`);

  const fallbackCaption = redes.map((r) => plan[r].legenda).find(Boolean);
  const result = {};
  const hosted = new Map(); // mesma pasta para as duas redes = hospeda uma vez só
  const tasks = [];
  for (const rede of redes) {
    const c = plan[rede];
    const caption = legenda ?? c.legenda ?? fallbackCaption;
    if (!hosted.has(c.pasta)) hosted.set(c.pasta, hostImages(c.imagens, path.basename(c.pasta)));
    result[rede] = { pasta: c.pasta, imagens: c.imagens.length,
      legenda_usada: legenda ? "parâmetro" : c.legenda ? "legenda.txt da pasta" : fallbackCaption ? "legenda.txt da outra rede" : "nenhuma" };

    tasks.push([rede, hosted.get(c.pasta).then((urls) => {
      if (rede === "instagram") return ig.publishCarousel({ items: urls.map((url) => ({ type: "image", url })), caption });
      const firstLine = caption?.split(/\r?\n/).find((l) => l.trim())?.trim();
      return tt.publishPhotos({
        photo_urls: urls, title: (titulo_tiktok ?? firstLine)?.slice(0, 90), description: caption?.slice(0, 4000),
        mode: tiktok_mode, privacy_level: tiktok_privacy_level, auto_add_music,
      });
    })]);
  }
  const settled = await Promise.allSettled(tasks.map(([, p]) => p));
  settled.forEach((r, i) => {
    const rede = tasks[i][0];
    Object.assign(result[rede], r.status === "fulfilled" ? { ok: true, ...r.value } : { ok: false, error: r.reason.message });
  });
  if (settled.every((r) => r.status === "rejected")) {
    throw new Error(`O carrossel não foi publicado. ${tasks.map(([n], i) => `${n}: ${settled[i].reason.message}`).join(" | ")}`);
  }
  return result;
}
