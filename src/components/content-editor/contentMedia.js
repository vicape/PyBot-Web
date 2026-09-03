import { getSupabase } from "../../supabaseClient.js";

export const CONTENT_MEDIA_BUCKET = "content-media";
export const CONTENT_MEDIA_SCHEME = "content-media://";
export const SIGNED_URL_SECONDS = 60 * 60;

export const CONTENT_MEDIA_LIMITS = {
  image: 10 * 1024 * 1024,
  audio: 50 * 1024 * 1024,
  video: 100 * 1024 * 1024,
  file: 50 * 1024 * 1024,
};

export const CONTENT_MEDIA_MIMES = {
  image: ["image/jpeg", "image/png", "image/webp", "image/gif"],
  audio: ["audio/mpeg", "audio/mp4", "audio/ogg", "audio/wav", "audio/webm"],
  video: ["video/mp4", "video/webm"],
  file: ["application/pdf"],
};

const MIME_ALIASES = {
  "image/jpg": "image/jpeg",
  "audio/mp3": "audio/mpeg",
  "audio/x-wav": "audio/wav",
  "audio/wave": "audio/wav",
  "audio/x-m4a": "audio/mp4",
};

const EXT_TO_KIND = {
  ".jpg": "image",
  ".jpeg": "image",
  ".png": "image",
  ".webp": "image",
  ".gif": "image",
  ".mp3": "audio",
  ".m4a": "audio",
  ".ogg": "audio",
  ".wav": "audio",
  ".weba": "audio",
  ".mp4": "video",
  ".webm": "video",
  ".pdf": "file",
};

const MIME_TO_EXT = {
  "image/jpeg": ".jpg",
  "image/png": ".png",
  "image/webp": ".webp",
  "image/gif": ".gif",
  "audio/mpeg": ".mp3",
  "audio/mp4": ".m4a",
  "audio/ogg": ".ogg",
  "audio/wav": ".wav",
  "audio/webm": ".weba",
  "video/mp4": ".mp4",
  "video/webm": ".webm",
  "application/pdf": ".pdf",
};

const BLOCKED_EXT = new Set([
  ".exe",
  ".bat",
  ".cmd",
  ".com",
  ".msi",
  ".scr",
  ".pif",
  ".dll",
  ".js",
  ".mjs",
  ".cjs",
  ".html",
  ".htm",
  ".xhtml",
  ".svg",
  ".php",
  ".sh",
  ".ps1",
  ".vbs",
  ".jar",
  ".wasm",
  ".apk",
]);

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const FILE_NAME_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.[a-z0-9]{1,8}$/i;
const YT_ID_RE = /^[a-zA-Z0-9_-]{11}$/;
const VIMEO_ID_RE = /^\d{6,12}$/;

function formatMb(bytes) {
  return Math.round(bytes / (1024 * 1024));
}

function extensionOf(file) {
  const name = String(file?.name || "");
  const dot = name.lastIndexOf(".");
  if (dot < 0) return "";
  return name.slice(dot).toLowerCase().replace(/[^a-z0-9.]/g, "").slice(0, 9);
}

function normalizeMime(mime) {
  const raw = String(mime || "").toLowerCase().split(";")[0].trim();
  return MIME_ALIASES[raw] || raw;
}

export function mediaKindForFile(file) {
  const mime = normalizeMime(file?.type);
  const ext = extensionOf(file);
  if (BLOCKED_EXT.has(ext)) return null;
  for (const [kind, mimes] of Object.entries(CONTENT_MEDIA_MIMES)) {
    if (mimes.includes(mime)) return kind;
  }
  return EXT_TO_KIND[ext] || null;
}

export function validateContentMediaFile(file) {
  if (!file) throw new Error("No se eligió ningún archivo.");
  const ext = extensionOf(file);
  if (BLOCKED_EXT.has(ext)) {
    throw new Error("Ese tipo de archivo no está permitido.");
  }
  const kind = mediaKindForFile(file);
  if (!kind) {
    throw new Error("Ese formato no está permitido. Probá con imagen, audio, video o PDF.");
  }
  const max = CONTENT_MEDIA_LIMITS[kind];
  if (file.size > max) {
    throw new Error(`El archivo supera el límite de ${formatMb(max)} MB.`);
  }
  return kind;
}

function extensionForUpload(file, kind) {
  const ext = extensionOf(file);
  if (ext && EXT_TO_KIND[ext] === kind && !BLOCKED_EXT.has(ext)) return ext;
  const mime = normalizeMime(file?.type);
  return MIME_TO_EXT[mime] || (kind === "file" ? ".pdf" : "");
}

function assertUuid(value, label) {
  if (!UUID_RE.test(String(value || ""))) {
    throw new Error(`No se pudo preparar la ${label}.`);
  }
}

export function toContentMediaRef(userId, contentId, lessonId, fileName) {
  return `${CONTENT_MEDIA_SCHEME}${userId}/${contentId}/${lessonId}/${fileName}`;
}

export function parseContentMediaRef(url) {
  if (!url || typeof url !== "string" || !url.startsWith(CONTENT_MEDIA_SCHEME)) return null;
  const parts = url.slice(CONTENT_MEDIA_SCHEME.length).split("/");
  if (parts.length !== 4) return null;
  const [userId, contentId, lessonId, fileName] = parts;
  if (!UUID_RE.test(userId) || !UUID_RE.test(contentId) || !UUID_RE.test(lessonId)) return null;
  if (!FILE_NAME_RE.test(fileName)) return null;
  return { userId, contentId, lessonId, fileName, path: `${userId}/${contentId}/${lessonId}/${fileName}` };
}

export function isSafeLessonLink(href) {
  if (!href || typeof href !== "string") return false;
  const trimmed = href.trim();
  if (/^(javascript|data|vbscript):/i.test(trimmed)) return false;
  if (/^data:text\/html/i.test(trimmed)) return false;
  try {
    const parsed = new URL(trimmed, typeof window !== "undefined" ? window.location.origin : "https://pybotclass.local");
    return parsed.protocol === "http:" || parsed.protocol === "https:" || parsed.protocol === "mailto:";
  } catch {
    return false;
  }
}

export function getSafeVideoEmbed(url) {
  if (!url || typeof url !== "string") return null;
  let parsed;
  try {
    parsed = new URL(url.trim());
  } catch {
    return null;
  }
  if (parsed.protocol !== "https:") return null;

  const host = parsed.hostname.replace(/^www\./, "").toLowerCase();

  const youtubeId = (() => {
    if (host === "youtu.be") {
      return parsed.pathname.replace(/^\//, "").slice(0, 11);
    }
    if (
      host === "youtube.com" ||
      host === "m.youtube.com" ||
      host === "music.youtube.com" ||
      host === "youtube-nocookie.com"
    ) {
      const fromQuery = parsed.searchParams.get("v");
      if (fromQuery) return fromQuery.slice(0, 11);
      const parts = parsed.pathname.split("/").filter(Boolean);
      if (parts[0] === "embed" || parts[0] === "shorts" || parts[0] === "live") {
        return (parts[1] || "").slice(0, 11);
      }
    }
    return "";
  })();

  if (youtubeId && YT_ID_RE.test(youtubeId)) {
    return {
      src: `https://www.youtube-nocookie.com/embed/${youtubeId}`,
      title: "Video de YouTube",
    };
  }

  if (host === "vimeo.com" || host === "player.vimeo.com") {
    const parts = parsed.pathname.split("/").filter(Boolean);
    const id = host === "player.vimeo.com" && parts[0] === "video" ? parts[1] : parts[0];
    if (id && VIMEO_ID_RE.test(id)) {
      return {
        src: `https://player.vimeo.com/video/${id}`,
        title: "Video de Vimeo",
      };
    }
  }

  return null;
}

function fallbackUrl(url) {
  if (!url) return "about:blank";
  if (url.startsWith("blob:") || url.startsWith("https://")) return url;
  return "about:blank";
}

export async function resolveContentMediaUrl(url) {
  if (!url) return "about:blank";
  if (typeof url !== "string") return "about:blank";
  if (/^(javascript|data|vbscript):/i.test(url)) return "about:blank";
  if (url.startsWith("blob:")) return url;
  if (url.startsWith("https://")) return url;

  const parsed = parseContentMediaRef(url);
  if (!parsed) return fallbackUrl(url);

  const client = getSupabase();
  if (!client) return "about:blank";

  const { data, error } = await client.storage
    .from(CONTENT_MEDIA_BUCKET)
    .createSignedUrl(parsed.path, SIGNED_URL_SECONDS);

  if (error || !data?.signedUrl) return "about:blank";
  return data.signedUrl;
}

export async function uploadContentMedia(file, { contentId, lessonId } = {}) {
  const kind = validateContentMediaFile(file);
  assertUuid(contentId, "carpeta del contenido");
  assertUuid(lessonId, "carpeta de la lección");

  const client = getSupabase();
  if (!client) throw new Error("No hay conexión para subir archivos.");

  const { data: sessionData } = await client.auth.getUser();
  const userId = sessionData?.user?.id;
  if (!userId) throw new Error("Tenés que iniciar sesión para subir archivos.");

  const ext = extensionForUpload(file, kind);
  if (!ext) throw new Error("No se reconoció la extensión del archivo.");

  const fileName = `${crypto.randomUUID()}${ext}`;
  const path = `${userId}/${contentId}/${lessonId}/${fileName}`;
  const contentType = normalizeMime(file.type) || undefined;

  const { error } = await client.storage.from(CONTENT_MEDIA_BUCKET).upload(path, file, {
    cacheControl: "3600",
    upsert: false,
    contentType,
  });

  if (error) {
    throw new Error(error.message || "No se pudo subir el archivo.");
  }

  return toContentMediaRef(userId, contentId, lessonId, fileName);
}
