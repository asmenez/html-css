# Contexto para o Claude: MCP Redes Sociais

Servidor MCP (Node.js) que publica e agenda posts no Instagram e no TikTok pelas APIs oficiais. Detalhes técnicos estão em `README.md`. Este arquivo resume o estado atual e como trabalhar com o dono do projeto.

## Quem usa e como falar
- Usuário iniciante em programação. Fale **em português**, de forma simples, um passo por vez.
- Usa **somente Windows**. Não fale de Mac.
- Terminal: **UCRT64 (MSYS2, bash)**, não PowerShell. Comandos de PowerShell como `Resolve-Path` não funcionam ali; use `pwd -W` e `cygpath`.
- O Claude Desktop é a versão nova: os servidores MCP locais ficam em Configurações → Aplicativo para desktop → Extensões → Gerenciar → "Servidores MCP locais". O arquivo de configuração fica em `%LOCALAPPDATA%\Claude-Data\claude_<id>\claude_desktop_config.json`, e `npm run instalar-claude` já sabe achar.
- Depois de mudar o código ou o `.env`, o Claude Desktop precisa ser **fechado por completo** (ícone perto do relógio → Sair) e aberto de novo.

## Regras de segurança (obrigatórias)
- **Nunca** mostre, copie para o chat nem registre valores de tokens do `.env` ou de `data/tokens.json`. Para conferir se existem, só veja se a linha está preenchida (`grep -c '^GITHUB_TOKEN=.' .env`).
- **Nunca** publique nada sem o usuário confirmar aquele post específico. Antes, mostre o nome completo da pasta, a rede, o número de imagens, a legenda e a privacidade.
- TikTok: se o usuário não disser a privacidade, use `SELF_ONLY` e avise. A conta permite público, e o padrão do código é a **primeira opção, que é pública**.
- Não mova, renomeie nem apague arquivos das pastas de carrossel sem perguntar.
- Não faça `git push` para `master` sem autorização. O trabalho fica na branch `claude/tiktok-instagram-automation-mcp-8tf2wl`.

## Estado atual (tudo funcionando: `npm run verificar` dá OK em tudo)
- **Instagram:** usa o **login unificado** da Meta, porque apps novos não têm mais o "login do Instagram". O token é de um **usuário do sistema** ("Postador") no portfólio empresarial, começa com `EAA` e **não expira**. O código detecta o host `graph.facebook.com` pelo prefixo do token. `IG_USER_ID` está preenchido (o ID começa com 1784).
- **TikTok:** app criado no portal de desenvolvedores, com Sandbox e login feito (`npm run auth:tiktok`). Os tokens ficam em `data/tokens.json` e são renovados sozinhos. O app **ainda não passou pela revisão** do TikTok, e posts diretos podem sair privados.
- **Site para mídia:** GitHub Pages em `https://asmenez.github.io/html-css/`, servido pela branch `master`. Domínio verificado no TikTok (URL prefix). `termos.html` e `privacidade.html` estão na `master`, para o formulário do app do TikTok.
- **Carrosséis:** uma pasta-base por rede (`CARROSSEIS_DIR_INSTAGRAM` e `CARROSSEIS_DIR_TIKTOK` no `.env`). As imagens são convertidas para JPG (sharp), hospedadas via API do GitHub (`GITHUB_TOKEN`, com Contents: read/write só neste repositório) na pasta `carrosseis/` da `master`, e publicadas.
- **Claude Desktop:** servidor `redes-sociais` configurado e aparecendo. `status_contas` funcionou nas duas contas.

## Pendências
- **Nomes dos carrosséis não batem entre as pastas** (o `verificar` mostra "0 com o mesmo nome nas duas pastas"). Para postar nas duas redes com um comando, use o mesmo nome de subpasta nas duas, ou passe `pasta_instagram` / `pasta_tiktok`. Sugira a padronização, mas só renomeie com autorização.
- Ainda não houve teste real de `postar_carrossel` (hospedagem + publicação).
- **Revisão do app do TikTok** (para posts públicos diretos): precisa de um vídeo de demonstração gravado no Sandbox. O texto da explicação já foi escrito; peça ao usuário, se precisar.
- O usuário quer um **Projeto no Claude Desktop** com instruções fixas de postagem (listar → confirmar → publicar, TikTok `SELF_ONLY` por padrão).

## Comandos úteis (dentro de `mcp-redes-sociais`)
```
git pull                 # atualizar
npm install              # dependências
npm test                 # testes offline (rede simulada)
npm run verificar        # confere credenciais, pastas e GitHub sem publicar
npm run instalar-claude  # configura o Claude Desktop
npm run agendador        # roda posts agendados sem o Claude aberto
```
Para testar uma publicação pelo terminal (só com autorização do usuário):
```
node --input-type=module -e "import {runAction} from './src/actions.js'; console.log(JSON.stringify(await runAction('postar_carrossel', {pasta: 'NOME', redes: ['tiktok'], tiktok_privacy_level: 'SELF_ONLY'}), null, 2))"
```
