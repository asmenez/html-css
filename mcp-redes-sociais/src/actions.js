// Ações de publicação compartilhadas pelo servidor MCP e pelo agendador.
import { z } from "zod";
import * as ig from "./instagram.js";
import * as tt from "./tiktok.js";

const url = z.string().url();
const privacy = z.enum(["PUBLIC_TO_EVERYONE", "MUTUAL_FOLLOW_FRIENDS", "FOLLOWER_OF_CREATOR", "SELF_ONLY"]);

export const actions = {
  instagram_post_image: {
    description: "Publica uma foto no feed do Instagram. A imagem precisa estar em uma URL pública (JPEG).",
    schema: {
      image_url: url.describe("URL pública da imagem JPEG"),
      caption: z.string().max(2200).optional().describe("Legenda (aceita #hashtags e @menções)"),
      alt_text: z.string().optional().describe("Texto alternativo para acessibilidade"),
    },
    run: ig.publishImage,
  },
  instagram_post_reel: {
    description: "Publica um Reel no Instagram a partir de uma URL pública de vídeo (MP4/MOV, 3s–15min).",
    schema: {
      video_url: url,
      caption: z.string().max(2200).optional(),
      cover_url: url.optional().describe("Imagem de capa (opcional)"),
      thumb_offset: z.number().int().optional().describe("Milissegundo do vídeo usado como capa"),
      share_to_feed: z.boolean().optional().describe("Também mostrar no feed (padrão: true)"),
    },
    run: ig.publishReel,
  },
  instagram_post_story: {
    description: "Publica um Story no Instagram (imagem OU vídeo em URL pública).",
    schema: { image_url: url.optional(), video_url: url.optional() },
    run: ig.publishStory,
  },
  instagram_post_carousel: {
    description: "Publica um carrossel (2 a 10 fotos/vídeos) no Instagram.",
    schema: {
      items: z.array(z.object({ type: z.enum(["image", "video"]), url })).min(2).max(10),
      caption: z.string().max(2200).optional(),
    },
    run: ig.publishCarousel,
  },
  tiktok_post_video: {
    description:
      "Publica um vídeo no TikTok. Use file_path (arquivo local, upload em partes) ou video_url (domínio verificado no app). " +
      "mode='direct' publica no perfil; mode='draft' envia para a caixa de entrada do TikTok para finalizar no app. " +
      "Apps não auditados só podem usar privacy_level=SELF_ONLY.",
    schema: {
      file_path: z.string().optional().describe("Caminho de um MP4/MOV local"),
      video_url: url.optional(),
      mode: z.enum(["direct", "draft"]).optional(),
      title: z.string().max(2200).optional().describe("Legenda com #hashtags e @menções"),
      privacy_level: privacy.optional().describe("Se omitido, usa a primeira opção permitida pela conta"),
      disable_comment: z.boolean().optional(),
      disable_duet: z.boolean().optional(),
      disable_stitch: z.boolean().optional(),
      video_cover_timestamp_ms: z.number().int().optional(),
      is_aigc: z.boolean().optional().describe("Marcar como conteúdo gerado por IA"),
      brand_content_toggle: z.boolean().optional().describe("Conteúdo pago/parceria"),
      brand_organic_toggle: z.boolean().optional().describe("Promove a própria marca"),
      wait: z.boolean().optional().describe("Esperar o processamento terminar (padrão: true)"),
    },
    run: tt.publishVideo,
  },
  tiktok_post_photos: {
    description: "Publica um carrossel de fotos no TikTok (URLs públicas JPG/WEBP de domínio verificado, até 35).",
    schema: {
      photo_urls: z.array(url).min(1).max(35),
      title: z.string().max(90).optional(),
      description: z.string().max(4000).optional(),
      mode: z.enum(["direct", "draft"]).optional(),
      privacy_level: privacy.optional(),
      cover_index: z.number().int().min(0).optional(),
      disable_comment: z.boolean().optional(),
      auto_add_music: z.boolean().optional(),
      wait: z.boolean().optional(),
    },
    run: tt.publishPhotos,
  },
  post_video_everywhere: {
    description:
      "Publica o mesmo vídeo como Reel no Instagram e como vídeo no TikTok. " +
      "video_url é usado no Instagram (e no TikTok se file_path não for informado).",
    schema: {
      video_url: url.describe("URL pública do vídeo (obrigatória para o Instagram)"),
      file_path: z.string().optional().describe("Arquivo local para o TikTok (evita verificação de domínio)"),
      caption: z.string().max(2200).optional(),
      tiktok_mode: z.enum(["direct", "draft"]).optional(),
      tiktok_privacy_level: privacy.optional(),
    },
    run: async ({ video_url, file_path, caption, tiktok_mode, tiktok_privacy_level }) => {
      const [instagram, tiktok] = await Promise.allSettled([
        ig.publishReel({ video_url, caption }),
        tt.publishVideo({
          ...(file_path ? { file_path } : { video_url }),
          title: caption, mode: tiktok_mode, privacy_level: tiktok_privacy_level,
        }),
      ]);
      const out = (r) => (r.status === "fulfilled" ? { ok: true, ...r.value } : { ok: false, error: r.reason.message });
      const result = { instagram: out(instagram), tiktok: out(tiktok) };
      if (!result.instagram.ok && !result.tiktok.ok) {
        throw new Error(`Falhou nas duas redes. Instagram: ${result.instagram.error} | TikTok: ${result.tiktok.error}`);
      }
      return result;
    },
  },
};

export async function runAction(name, args) {
  const action = actions[name];
  if (!action) throw new Error(`Ação desconhecida: ${name}`);
  const parsed = z.object(action.schema).parse(args ?? {});
  return action.run(parsed);
}
