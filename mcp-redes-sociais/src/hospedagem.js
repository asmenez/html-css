// Hospeda imagens no GitHub Pages para que Instagram e TikTok possam baixá-las por URL pública.
// Usa a API do GitHub (um único commit com todos os arquivos), sem precisar do Git instalado.
import { getConfig, sleep } from "./config.js";

function cfg() {
  const c = getConfig().github;
  if (!c.token) throw new Error("GitHub não configurado: defina GITHUB_TOKEN no .env (veja o README, seção Carrosséis).");
  if (!/^[\w.-]+\/[\w.-]+$/.test(c.repo)) throw new Error(`GITHUB_REPO inválido: "${c.repo}" (formato: usuario/repositorio)`);
  return c;
}

async function gh(method, pathname, body) {
  const c = cfg();
  const res = await fetch(`https://api.github.com/repos/${c.repo}${pathname}`, {
    method,
    headers: {
      Authorization: `Bearer ${c.token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "mcp-redes-sociais",
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const hint = res.status === 401 ? " (token inválido ou expirado)"
      : res.status === 403 || res.status === 404 ? " (o token precisa de acesso de escrita em Contents neste repositório)" : "";
    throw new Error(`GitHub API ${res.status}: ${json.message || res.statusText}${hint}`);
  }
  return json;
}

/** Confere se o token consegue escrever no repositório. */
export async function checkAccess() {
  const c = cfg();
  const repo = await gh("GET", "");
  if (repo.permissions && !repo.permissions.push) throw new Error("O token não tem permissão de escrita neste repositório.");
  return { repo: repo.full_name, branch: c.branch, pages: c.pagesUrl };
}

/**
 * Envia arquivos num único commit.
 * files: [{ path: "carrosseis/x/01.jpg", content: Buffer }] -> URLs públicas na mesma ordem.
 */
export async function uploadFiles(files, message) {
  const c = cfg();
  const ref = await gh("GET", `/git/ref/heads/${encodeURIComponent(c.branch)}`);
  const parent = await gh("GET", `/git/commits/${ref.object.sha}`);
  const tree = [];
  for (const f of files) {
    const blob = await gh("POST", "/git/blobs", { content: f.content.toString("base64"), encoding: "base64" });
    tree.push({ path: f.path, mode: "100644", type: "blob", sha: blob.sha });
  }
  const newTree = await gh("POST", "/git/trees", { base_tree: parent.tree.sha, tree });
  const commit = await gh("POST", "/git/commits", { message, tree: newTree.sha, parents: [ref.object.sha] });
  await gh("PATCH", `/git/refs/heads/${encodeURIComponent(c.branch)}`, { sha: commit.sha });
  return files.map((f) => new URL(f.path.split("/").map(encodeURIComponent).join("/"), c.pagesUrl).href);
}

/** Espera o GitHub Pages publicar os arquivos (costuma levar de 30 s a 2 min). */
export async function waitUntilOnline(urls, { timeoutMs = 6 * 60_000, intervalMs = 10_000 } = {}) {
  const start = Date.now();
  const pending = new Set(urls);
  while (pending.size) {
    for (const u of [...pending]) {
      const res = await fetch(u, { method: "HEAD" }).catch(() => null);
      if (res?.ok) pending.delete(u);
    }
    if (!pending.size) break;
    if (Date.now() - start > timeoutMs) {
      throw new Error(`O GitHub Pages ainda não publicou ${pending.size} imagem(ns) depois de ${Math.round(timeoutMs / 60000)} min. ` +
        "Confira se o Pages está ligado (Settings > Pages) e tente de novo.");
    }
    await sleep(intervalMs);
  }
  return urls;
}
