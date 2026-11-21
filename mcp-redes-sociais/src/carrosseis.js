// Carrosséis a partir de uma pasta do computador (CARROSSEIS_DIR).
// Cada subpasta é um carrossel: as imagens são usadas em ordem de nome (1, 2, ... 10)
// e um legenda.txt opcional vira a legenda.
import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { getConfig } from "./config.js";
import * as hosting from "./hospedagem.js";
import * as ig from "./instagram.js";
import * as tt from "./tiktok.js";

const IMAGE_EXT = /\.(jpe?g|png|webp)$/i;
const CAPTION_FILES = ["legenda.txt", "legenda.md", "caption.txt"];
const naturalSort = (a, b) => a.localeCompare(b, "pt-BR", { numeric: true, sensitivity: "base" });

function baseDir() {
  const dir = getConfig().carrosseisDir;
  if (!dir) throw new Error("Defina CARROSSEIS_DIR no .env com a pasta dos seus carrosséis.");
  if (!fs.existsSync(dir)) throw new Error(`A pasta CARROSSEIS_DIR não existe: ${dir}`);
  return dir;
}

/** Aceita o nome de uma subpasta de CARROSSEIS_DIR ou um caminho completo. */
export function resolveFolder(pasta) {
  if (!pasta) throw new Error("Informe a pasta do carrossel.");
  if (path.isAbsolute(pasta) && fs.existsSync(pasta)) return pasta;
  const base = baseDir();
  const direct = path.join(base, pasta);
  if (fs.existsSync(direct)) return direct;
  // Tolerante: ignora maiúsculas/acentos e aceita parte do nome.
  const norm = (s) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
  const subdirs = fs.readdirSync(base, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name);
  const exact = subdirs.filter((d) => norm(d) === norm(pasta));
  const partial = subdirs.filter((d) => norm(d).includes(norm(pasta)));
  const found = exact.length ? exact : partial;
  if (found.length === 1) return path.join(base, found[0]);
  if (found.length > 1) throw new Error(`Mais de uma pasta combina com "${pasta}": ${found.join(", ")}. Seja mais específico.`);
  throw new Error(`Pasta "${pasta}" não encontrada em ${base}. Use listar_carrosseis para ver as opções.`);
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

export function listCarousels() {
  const base = baseDir();
  const items = fs.readdirSync(base, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => {
      const c = readFolder(path.join(base, d.name));
      return {
        pasta: d.name, imagens: c.imagens.length, tem_legenda: Boolean(c.legenda),
        modificada: fs.statSync(path.join(base, d.name)).mtime.toISOString().slice(0, 10),
      };
    })
    .filter((c) => c.imagens > 0)
    .sort((a, b) => b.modificada.localeCompare(a.modificada));
  const soltas = readFolder(base).imagens.length;
  return { pasta_base: base, carrosseis: items, ...(soltas ? { imagens_soltas_na_raiz: soltas } : {}) };
}

const slug = (s) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase()
  .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "carrossel";

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
 * Publica um carrossel da pasta nas redes escolhidas.
 * Legenda: parâmetro > legenda.txt da pasta.
 */
export async function postCarousel({
  pasta, redes = ["instagram", "tiktok"], legenda, titulo_tiktok,
  tiktok_mode = "direct", tiktok_privacy_level, auto_add_music = true,
}) {
  const folder = resolveFolder(pasta);
  const c = readFolder(folder);
  if (!c.imagens.length) throw new Error(`Nenhuma imagem JPG, PNG ou WEBP em ${folder}.`);
  if (redes.includes("instagram") && (c.imagens.length < 2 || c.imagens.length > 10)) {
    throw new Error(`O Instagram aceita de 2 a 10 imagens no carrossel; a pasta tem ${c.imagens.length}.`);
  }
  if (c.imagens.length > 35) throw new Error(`O TikTok aceita até 35 fotos; a pasta tem ${c.imagens.length}.`);
  const caption = legenda ?? c.legenda;

  const urls = await hostImages(c.imagens, path.basename(folder));
  const result = { pasta: folder, imagens: urls.length, legenda_usada: caption ? (legenda ? "parâmetro" : "legenda.txt") : "nenhuma" };

  const tasks = [];
  if (redes.includes("instagram")) {
    tasks.push(["instagram", ig.publishCarousel({ items: urls.map((url) => ({ type: "image", url })), caption })]);
  }
  if (redes.includes("tiktok")) {
    const firstLine = caption?.split(/\r?\n/).find((l) => l.trim())?.trim();
    tasks.push(["tiktok", tt.publishPhotos({
      photo_urls: urls, title: (titulo_tiktok ?? firstLine)?.slice(0, 90), description: caption?.slice(0, 4000),
      mode: tiktok_mode, privacy_level: tiktok_privacy_level, auto_add_music,
    })]);
  }
  const settled = await Promise.allSettled(tasks.map(([, p]) => p));
  settled.forEach((r, i) => {
    result[tasks[i][0]] = r.status === "fulfilled" ? { ok: true, ...r.value } : { ok: false, error: r.reason.message };
  });
  if (tasks.length && settled.every((r) => r.status === "rejected")) {
    throw new Error(`O carrossel não foi publicado. ${tasks.map(([n], i) => `${n}: ${settled[i].reason.message}`).join(" | ")}`);
  }
  return result;
}
