#!/usr/bin/env node
// Assistente de login OAuth do TikTok: gera o link de autorização e troca o "code" pelos tokens.
// Requer TIKTOK_CLIENT_KEY, TIKTOK_CLIENT_SECRET e TIKTOK_REDIRECT_URI (igual ao cadastrado no app).
import crypto from "node:crypto";
import readline from "node:readline/promises";
import { getConfig, saveTokens } from "../src/config.js";

const { clientKey, clientSecret, redirectUri } = getConfig().tiktok;
if (!clientKey || !clientSecret || !redirectUri) {
  console.error("Defina TIKTOK_CLIENT_KEY, TIKTOK_CLIENT_SECRET e TIKTOK_REDIRECT_URI no .env primeiro.");
  process.exit(1);
}

const state = crypto.randomBytes(8).toString("hex");
const auth = new URL("https://www.tiktok.com/v2/auth/authorize/");
auth.search = new URLSearchParams({
  client_key: clientKey,
  scope: "user.info.basic,video.publish,video.upload",
  response_type: "code",
  redirect_uri: redirectUri,
  state,
}).toString();

console.log("\n1) Abra este link no navegador e autorize o app:\n\n" + auth.href + "\n");
console.log("2) Você será redirecionado para o seu redirect URI. Copie a URL COMPLETA da barra de endereço.\n");

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const pasted = (await rl.question("Cole a URL aqui: ")).trim();
rl.close();

const params = new URL(pasted).searchParams;
if (params.get("state") !== state) {
  console.error("O parâmetro state não confere — tente de novo.");
  process.exit(1);
}
const code = params.get("code");
if (!code) {
  console.error("Nenhum code na URL:", params.get("error_description") || params.get("error"));
  process.exit(1);
}

const res = await fetch("https://open.tiktokapis.com/v2/oauth/token/", {
  method: "POST",
  headers: { "Content-Type": "application/x-www-form-urlencoded" },
  body: new URLSearchParams({
    client_key: clientKey, client_secret: clientSecret, code,
    grant_type: "authorization_code", redirect_uri: redirectUri,
  }),
});
const json = await res.json();
if (!res.ok || json.error) {
  console.error("Falha na troca do code:", json.error_description || json.error || res.status);
  process.exit(1);
}

saveTokens({ tiktok_access_token: json.access_token, tiktok_refresh_token: json.refresh_token });
console.log(`\nPronto! Tokens salvos em data/tokens.json (escopos: ${json.scope}).`);
console.log("O access token dura 24h e é renovado automaticamente com o refresh token (válido por 365 dias).");
