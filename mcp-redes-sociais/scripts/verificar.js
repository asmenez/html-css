#!/usr/bin/env node
// Testa as credenciais do .env sem publicar nada:  npm run verificar
import * as ig from "../src/instagram.js";
import * as tt from "../src/tiktok.js";

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
