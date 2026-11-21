#!/usr/bin/env node
// Testa as credenciais do .env sem publicar nada:  npm run verificar
import * as ig from "../src/instagram.js";
import * as tt from "../src/tiktok.js";
import { getConfig } from "../src/config.js";

// Com o login unificado (token do Facebook), o ID da conta do Instagram é obrigatório.
// Se faltar, tenta descobrir pelas Páginas/contas que o token enxerga.
const c = getConfig().instagram;
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
try {
  const conta = await ig.accountInfo();
  console.log(`  OK! Conta @${conta.username} (ID ${conta.user_id || conta.id}, ${conta.media_count ?? "?"} posts)`);
  const limite = await ig.publishingLimit().catch(() => null);
  if (limite?.data?.[0]) console.log(`  Posts via API nas últimas 24h: ${limite.data[0].quota_usage} de ${limite.data[0].config?.quota_total ?? 100}`);
} catch (err) {
  console.log(`  ERRO: ${err.message}`);
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
console.log("");
