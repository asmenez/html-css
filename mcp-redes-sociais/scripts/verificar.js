#!/usr/bin/env node
// Testa as credenciais do .env sem publicar nada:  npm run verificar
import * as ig from "../src/instagram.js";
import * as tt from "../src/tiktok.js";
import { getConfig } from "../src/config.js";
import * as hosting from "../src/hospedagem.js";
import * as carrosseis from "../src/carrosseis.js";

// Com o login unificado (token do Facebook), o ID da conta do Instagram é obrigatório.
// Se faltar, tenta descobrir pelas Páginas/contas que o token enxerga.
const c = getConfig().instagram;
if (c.accessToken) {
  // Mostra só o começo do token, nunca ele inteiro.
  const tipo = c.host === "graph.facebook.com" ? "Facebook / login unificado" : "login do Instagram";
  console.log(`\nToken do Instagram: começa com "${c.accessToken.slice(0, 4)}...", ${c.accessToken.length} caracteres (${tipo})`);
  if (/\s/.test(c.accessToken)) console.log("  Atenção: o token tem espaço no meio. Cole de novo no .env, numa linha só.");
  if (c.accessToken.length < 100) console.log("  Atenção: o token parece curto demais. Pode ter sido copiado pela metade.");
}
if (c.accessToken && c.host === "graph.facebook.com" && !c.userId) {
  console.log("\nIG_USER_ID está vazio. Procurando contas do Instagram ligadas a este token...");
  try {
    const url = `https://graph.facebook.com/${c.version}/me/accounts?fields=name,instagram_business_account{id,username}&access_token=${encodeURIComponent(c.accessToken)}`;
    const json = await (await fetch(url)).json();
    if (json.error) throw new Error(json.error.message);
    const found = (json.data || []).filter((p) => p.instagram_business_account);
    if (!found.length) console.log("  Nenhuma encontrada. Confira se a conta do Instagram foi atribuída ao token.");
    for (const p of found) {
      const a = p.instagram_business_account;
      console.log(`  @${a.username}: coloque no .env  IG_USER_ID=${a.id}`);
    }
  } catch (err) {
    console.log(`  Não consegui descobrir: ${err.message}`);
  }
}

console.log("\nVerificando Instagram...");
if (c.userId) console.log(`  Usando IG_USER_ID=${c.userId}`);
try {
  const conta = await ig.accountInfo();
  console.log(`  OK! Conta @${conta.username} (ID ${conta.user_id || conta.id}, ${conta.media_count ?? "?"} posts)`);
  const limite = await ig.publishingLimit().catch(() => null);
  if (limite?.data?.[0]) console.log(`  Posts via API nas últimas 24h: ${limite.data[0].quota_usage} de ${limite.data[0].config?.quota_total ?? 100}`);
} catch (err) {
  console.log(`  ERRO: ${err.message}`);
  if (/\(code 100\)|Object does not exist/.test(err.message) && c.host === "graph.facebook.com") {
    console.log(`
  O que conferir:
  1. IG_USER_ID precisa ser o ID da CONTA DO INSTAGRAM (costuma começar com 1784 e ter 17 dígitos).
     Não serve o ID do usuário do sistema, do app ou o business_id da barra de endereço.
     Onde achar: business.facebook.com/settings > Contas > Contas do Instagram > clique na conta.
  2. A conta do Instagram precisa estar atribuída ao usuário do sistema:
     Usuários do sistema > Postador > Atribuir ativos > Contas do Instagram > controle total.
  3. Deixe IG_USER_ID vazio e rode de novo: o programa tenta descobrir o ID sozinho.`);
  }
}

console.log("\nVerificando TikTok...");
try {
  const c = await tt.creatorInfo();
  console.log(`  OK! Conta @${c.creator_username} (${c.creator_nickname})`);
  console.log(`  Privacidades permitidas: ${c.privacy_level_options.join(", ")}`);
  if (c.privacy_level_options.length === 1 && c.privacy_level_options[0] === "SELF_ONLY") {
    console.log("  Atenção: app ainda não auditado, posts diretos sairão como privados (use o modo rascunho).");
  }
} catch (err) {
  console.log(`  ERRO: ${err.message}`);
}
console.log("\nVerificando carrosséis...");
try {
  const l = carrosseis.listCarousels();
  for (const rede of carrosseis.REDES) {
    const r = l[rede];
    if (r.erro) { console.log(`  ERRO (${rede}): ${r.erro}`); continue; }
    console.log(`  OK! ${rede}: ${r.pasta_base}`);
    console.log(`      ${r.carrosseis.length} carrossel(éis)${r.carrosseis[0] ? `, o mais recente: "${r.carrosseis[0].pasta}"` : ""}`);
  }
  if (l.nas_duas_redes) console.log(`  ${l.nas_duas_redes.length} carrossel(éis) com o mesmo nome nas duas pastas.`);
} catch (err) {
  console.log(`  ERRO: ${err.message}`);
}
try {
  const g = await hosting.checkAccess();
  console.log(`  OK! GitHub ${g.repo} (branch ${g.branch}) -> ${g.pages}`);
} catch (err) {
  console.log(`  ERRO: ${err.message}`);
}
console.log("");
