# MCP Redes Sociais — Instagram + TikTok

Servidor **MCP (Model Context Protocol)** que permite ao Claude (ou a outro cliente MCP) **publicar e agendar posts no Instagram e no TikTok** pelas **APIs oficiais**. Assim você pode pedir em linguagem natural:

> "Publica esse vídeo como Reel no Instagram e no TikTok com a legenda *Aula 5 de CSS 🚀 #html #css*"
> "Agenda o carrossel com estas 4 imagens para sexta às 18h"

## Por que MCP?

O MCP é a forma padrão de dar "ferramentas" a um assistente de IA. O servidor roda na sua máquina, guarda seus tokens localmente e expõe ações como `instagram_post_reel` ou `agendar_post`. O Claude decide quando chamar cada uma, e você revisa/aprova cada chamada.

Se você **não** quer usar IA, os mesmos módulos (`src/instagram.js`, `src/tiktok.js`) podem ser chamados de um script Node, e o agendador funciona sozinho via `npm run agendador`.

## Ferramentas disponíveis

| Ferramenta | O que faz |
|---|---|
| `instagram_post_image` | Foto no feed |
| `instagram_post_reel` | Reel (vídeo de URL pública **ou arquivo local**) |
| `instagram_post_story` | Story (foto ou vídeo, vídeo também de arquivo local) |
| `instagram_post_carousel` | Carrossel de 2 a 10 fotos/vídeos |
| `tiktok_post_video` | Vídeo no TikTok (arquivo local ou URL), direto ou como rascunho |
| `tiktok_post_photos` | Carrossel de fotos no TikTok |
| `post_video_everywhere` | Mesmo vídeo nas duas redes de uma vez |
| `postar_carrossel` | Carrossel a partir de uma pasta do computador, no Instagram e/ou TikTok |
| `listar_carrosseis` | Lista as pastas de carrossel disponíveis |
| `agendar_post` / `listar_agendados` / `cancelar_agendado` | Fila de agendamentos |
| `status_contas` | Verifica as credenciais e mostra o limite de posts |
| `tiktok_status` | Status de uma publicação no TikTok |
| `instagram_metricas` | Posts recentes com curtidas/comentários; com `media_id`, visualizações, alcance, salvamentos |
| `tiktok_metricas` | Vídeos recentes com visualizações, curtidas, comentários e compartilhamentos |
| `renovar_tokens` | Renova os tokens manualmente (normalmente não é preciso, veja abaixo) |

## Instalação

```bash
cd mcp-redes-sociais
npm install
cp .env.example .env   # e preencha as credenciais (veja abaixo)
npm test               # testes offline, sem tocar nas APIs
```

Requer Node.js 20 ou mais recente.

### Conectar ao Claude

**Claude Code**:
```bash
claude mcp add redes-sociais -- node /caminho/completo/mcp-redes-sociais/src/index.js
```

**Claude Desktop**: edite `claude_desktop_config.json`:
```json
{
  "mcpServers": {
    "redes-sociais": {
      "command": "node",
      "args": ["/caminho/completo/mcp-redes-sociais/src/index.js"]
    }
  }
}
```

## Credenciais

### Instagram (Meta)

1. A conta precisa ser **Profissional** (Criador de conteúdo ou Empresa).
2. Em <https://developers.facebook.com>, crie um app do tipo **Business** e adicione o produto **Instagram** → *API setup with Instagram login*.
3. Adicione sua conta como testadora, gere um token com as permissões `instagram_business_basic` e `instagram_business_content_publish`.
4. Coloque no `.env`:
   - `IG_ACCESS_TOKEN`: token de longa duração (60 dias). O servidor e o agendador **renovam sozinhos** a cada 7 dias, então ele não vence enquanto um deles rodar pelo menos de vez em quando.
   - `IG_USER_ID`: opcional com o login do Instagram. Se quiser preencher, use o `user_id` de `https://graph.instagram.com/v23.0/me?fields=user_id,username&access_token=SEU_TOKEN`.
5. Confira com `npm run verificar`, que testa as credenciais sem publicar nada.

> Se a sua conta é ligada a uma Página do Facebook e você usa o *Facebook Login*, defina `IG_GRAPH_HOST=graph.facebook.com`.

**Limitações do Instagram:**
- **Vídeos** (Reels, Stories, itens de carrossel) podem ser enviados direto do computador com `file_path`.
- **Imagens** precisam estar numa **URL pública HTTPS**, porque a Meta baixa o arquivo. Pode ser GitHub Pages (este repositório já usa), Cloudinary, S3, Google Cloud Storage etc.
- Imagens em **JPEG**. Reels em MP4/MOV (H.264, até 15 min).
- Limite de **100 posts por 24h** por conta via API (`status_contas` mostra o uso).

### TikTok

1. Em <https://developers.tiktok.com>, crie um app e adicione os produtos **Login Kit** e **Content Posting API** (ative *Direct Post*).
2. Escopos: `user.info.basic`, `video.publish`, `video.upload` e `video.list` (para as métricas).
3. Cadastre um *Redirect URI* (ex.: `https://seusite.com/callback`; a página não precisa existir de verdade).
4. Preencha `TIKTOK_CLIENT_KEY`, `TIKTOK_CLIENT_SECRET` e `TIKTOK_REDIRECT_URI` no `.env` e rode:
   ```bash
   npm run auth:tiktok
   ```
   Abra o link, autorize, cole a URL para onde foi redirecionado. Os tokens ficam em `data/tokens.json` e são **renovados automaticamente** (o access token dura 24h e o refresh token, 365 dias).

**Limitações do TikTok:**
- **Enquanto o app não passa pela auditoria do TikTok, todo post direto sai como privado (`SELF_ONLY`).** Para publicar como público, envie o app para revisão no portal de desenvolvedores. Uma alternativa sem auditoria é `mode: "draft"`: o vídeo vai para a caixa de entrada do app do TikTok e você toca em "Publicar" no celular.
- `video_url` e fotos (`PULL_FROM_URL`) exigem que o **domínio esteja verificado** no app. Para vídeos, prefira `file_path` (upload direto do arquivo, sem verificação).
- O TikTok exige que o usuário saiba que está publicando. Não use isto para postar sem consentimento.

## Carrosséis a partir de uma pasta

Defina `CARROSSEIS_DIR` no `.env` com a pasta onde você guarda os carrosséis. Cada **subpasta** é um carrossel:

```
02. Carrossel Claude/
├── Aula 5 - Juros compostos/
│   ├── 1.png
│   ├── 2.png
│   ├── ...
│   └── legenda.txt      (opcional: vira a legenda)
└── Aula 6 - Reserva de emergência/
```

- As imagens (JPG, PNG ou WEBP) entram **em ordem de nome**, com 2 antes de 10.
- São convertidas para JPG com 1080 px de largura, **hospedadas no GitHub Pages** deste repositório (pasta `carrosseis/`) e publicadas. Instagram e TikTok só aceitam fotos por URL pública.
- Instagram: 2 a 10 imagens, de preferência 1080×1350 (4:5). TikTok: até 35 fotos, com o título vindo da primeira linha da legenda.
- Diga ao Claude, por exemplo: *"posta o carrossel juros compostos no Instagram e no TikTok"*. O nome pode ser só parte do nome da pasta.

As imagens ficam públicas no site, como ficariam nas redes. Para a hospedagem, crie um token em <https://github.com/settings/personal-access-tokens/new>:
1. **Repository access:** *Only select repositories*, escolhendo este repositório.
2. **Permissions → Contents:** *Read and write*.
3. Coloque o token em `GITHUB_TOKEN` no `.env`.

## Agendamento

Nenhuma das duas APIs tem agendamento nativo, então o servidor mantém uma fila em `data/fila.json`:

- Enquanto o servidor MCP está aberto, ele verifica a fila a cada 60s (`SCHEDULER_INTERVAL_SECONDS`).
- Para não depender do Claude aberto, rode o agendador sozinho:
  ```bash
  npm run agendador              # fica rodando
  npm run agendador -- --once    # processa o que venceu e sai
  npm run agendador -- --list    # mostra a fila
  ```
  Exemplo de cron (a cada 5 min): `*/5 * * * * cd /caminho/mcp-redes-sociais && npm run agendador -- --once`

Uma trava de arquivo impede que o servidor e o CLI publiquem o mesmo post duas vezes.

Se um post agendado falhar por **erro temporário** (internet caiu, limite de requisições, instabilidade da Meta ou do TikTok), ele é tentado de novo em 5 e depois em 10 minutos, até 3 tentativas. Erros definitivos (URL inválida, permissão faltando etc.) marcam o post como `failed` na hora, e o motivo aparece em `listar_agendados`.

Exemplo de chamada `agendar_post`:
```json
{
  "action": "post_video_everywhere",
  "run_at": "2026-12-05T18:00:00-03:00",
  "args": {
    "file_path": "/home/eu/videos/aula5.mp4",
    "caption": "Aula 5 de CSS 🚀 #html #css #programacao"
  }
}
```

## Estrutura

```
mcp-redes-sociais/
├── src/
│   ├── index.js          # servidor MCP (ferramentas)
│   ├── actions.js        # ações de publicação + validação (zod)
│   ├── instagram.js      # Instagram Graph API
│   ├── tiktok.js         # TikTok Content Posting API
│   ├── agendador.js      # fila de agendamentos
│   ├── agendador-cli.js  # CLI do agendador
│   └── config.js         # .env e tokens
├── scripts/tiktok-auth.js
└── test/basico.test.js
```

## Segurança

- `.env` e `data/` (tokens e fila) estão no `.gitignore`. **Nunca faça commit deles.**
- `data/tokens.json` é criado com permissão `600` (só o seu usuário lê).
