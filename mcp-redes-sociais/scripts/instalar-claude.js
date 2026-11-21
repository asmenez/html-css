#!/usr/bin/env node
// Configura o Claude Desktop para usar este servidor MCP:  npm run instalar-claude
// - Acha o arquivo claude_desktop_config.json (instalação normal e da Microsoft Store)
// - Faz backup, mantém os outros servidores que já existirem e adiciona "redes-sociais"
// - Usa o caminho completo do Node, para o Claude não dar "spawn node ENOENT"
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { ROOT_DIR } from "../src/config.js";

const serverFile = path.join(ROOT_DIR, "src", "index.js").replace(/\\/g, "/");
const nodePath = process.execPath.replace(/\\/g, "/");

function candidateDirs() {
  const dirs = [];
  if (process.platform === "win32") {
    const appData = process.env.APPDATA || path.join(os.homedir(), "AppData", "Roaming");
    const localAppData = process.env.LOCALAPPDATA || path.join(os.homedir(), "AppData", "Local");
    dirs.push(path.join(appData, "Claude"));
    // Versão da Microsoft Store guarda a configuração numa pasta virtualizada.
    const packages = path.join(localAppData, "Packages");
    if (fs.existsSync(packages)) {
      for (const p of fs.readdirSync(packages)) {
        if (/^Claude/i.test(p)) dirs.push(path.join(packages, p, "LocalCache", "Roaming", "Claude"));
      }
    }
  } else if (process.platform === "darwin") {
    dirs.push(path.join(os.homedir(), "Library", "Application Support", "Claude"));
  } else {
    dirs.push(path.join(os.homedir(), ".config", "Claude"));
  }
  return dirs;
}

// Escreve onde o Claude já existe; se nenhuma pasta existir, cria a padrão.
let targets = candidateDirs().filter((d) => fs.existsSync(d));
if (!targets.length) targets = [candidateDirs()[0]];

for (const dir of targets) {
  const file = path.join(dir, "claude_desktop_config.json");
  let config = {};
  if (fs.existsSync(file)) {
    const raw = fs.readFileSync(file, "utf8").replace(/^﻿/, "");
    try {
      config = raw.trim() ? JSON.parse(raw) : {};
    } catch {
      console.error(`O arquivo ${file} tem um erro de formatação e não foi alterado.`);
      console.error("Abra ele, apague tudo, salve e rode este comando de novo.");
      process.exitCode = 1;
      continue;
    }
    fs.copyFileSync(file, `${file}.backup`);
  }
  fs.mkdirSync(dir, { recursive: true });
  config.mcpServers = { ...(config.mcpServers || {}), "redes-sociais": { command: nodePath, args: [serverFile] } };
  fs.writeFileSync(file, JSON.stringify(config, null, 2));
  console.log(`Configurado: ${file}`);
}

if (!process.exitCode) {
  console.log(`\nServidor: ${serverFile}\nNode:     ${nodePath}`);
  console.log("\nPronto! Agora feche o Claude Desktop por completo (botão direito no ícone perto do relógio > Sair) e abra de novo.");
}
