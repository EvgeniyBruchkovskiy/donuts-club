import { UserError } from "../errors.js";

/** Scheduled posts to the café's Instagram and Threads, made in the iOS app «Donuts Post». */

export type Platform = "instagram" | "threads";
export const PLATFORMS: Platform[] = ["instagram", "threads"];

/** `text` is Threads-only, `story` is Instagram-only; the rest go to both. */
export type PostKind = "image" | "carousel" | "video" | "story" | "text";

export interface MediaItem {
  /** Object path in the social bucket: social/{draftId}/{n}.jpg|mp4 */
  path: string;
  kind: "image" | "video";
}

export interface PlatformResult {
  state: "pending" | "processing" | "published" | "failed";
  /** Carousel item containers, created before the carousel container. */
  children?: string[];
  containerId?: string;
  /** Set right before the publish call: a crash after it must not publish twice. */
  publishing?: boolean;
  mediaId?: string;
  permalink?: string;
  error?: string;
  startedAt?: Date;
}

export type PostStatus = "scheduled" | "publishing" | "published" | "failed";

export interface SocialPost {
  kind: PostKind;
  platforms: Platform[];
  caption: string;
  /** Own text for Threads (500 chars max); the caption is used when absent. */
  threadsText?: string;
  media: MediaItem[];
  /** Small JPEG preview for the app's lists, base64 (kept after the media are deleted). */
  thumb?: string;
  scheduledAt: Date;
  status: PostStatus;
  /** While publishing: until when this tick owns the post. */
  leaseUntil?: Date;
  results: Partial<Record<Platform, PlatformResult>>;
  createdAt: Date;
  updatedAt: Date;
  publishedAt?: Date;
  /** Originals are deleted once every platform has published; the thumbnail stays. */
  mediaDeleted?: boolean;
  /** Team member names: who scheduled the post and who last changed it. */
  createdBy?: string;
  editedBy?: string;
}

/** admin: everything incl. accounts and team; editor: posts; viewer: only looks. */
export type Role = "admin" | "editor" | "viewer";
export const ROLES: Role[] = ["admin", "editor", "viewer"];

export interface TeamMember {
  id: string;
  name: string;
  role: Role;
  /** HMAC of the member's PIN keyed by the owner PIN (SOCIAL_PIN). */
  pinHash: string;
  createdAt: Date;
}

export interface SocialAccount {
  token: string;
  /** The id publishing calls go to (Instagram: professional account user_id; Threads: user id). */
  userId: string;
  username: string;
  /** Instagram only: which Graph host the token works on (absent = guessed from the token). */
  host?: "instagram" | "facebook";
  connectedAt: Date;
  refreshedAt: Date;
  expiresAt?: Date;
  refreshError?: string;
}

export type Accounts = Partial<Record<Platform, SocialAccount>>;

export const LIMITS = {
  caption: 2200,
  threadsText: 500,
  carouselMin: 2,
  carouselMax: 10,
  /** How far ahead a post may be scheduled (media live in the bucket for 90 days). */
  aheadMs: 60 * 24 * 3600_000,
  /** «Publish now» posts may carry a time a few minutes in the past. */
  pastSlackMs: 10 * 60_000,
  /** Base64 of a ~300 px JPEG preview. */
  thumbChars: 120_000,
};

export const SMSG = {
  badKind: "Невідомий тип публікації.",
  badPlatforms: "Оберіть Instagram, Threads або обидва.",
  storyThreads: "Сторіс публікуються лише в Instagram.",
  textInstagram: "Пост без фото чи відео можна опублікувати лише в Threads.",
  badMedia: "Перевірте фото та відео — завантажте їх ще раз.",
  mediaCount: "Кількість файлів не підходить для цього типу публікації.",
  carouselCount: "Карусель — від 2 до 10 фото чи відео.",
  captionLong: "Текст для Instagram задовгий — до 2200 символів.",
  threadsLong: "Текст для Threads задовгий — до 500 символів.",
  textEmpty: "Напишіть текст публікації.",
  badTime: "Оберіть час не раніше зараз і не пізніше ніж за 60 днів.",
  notConnected: (p: Platform) => `Підключіть ${p === "instagram" ? "Instagram" : "Threads"} у налаштуваннях.`,
  noPost: "Публікацію не знайдено — оновіть список.",
  busy: "Публікація саме виходить — зачекайте хвилину.",
  done: "Публікація вже вийшла — її не можна змінити.",
  badToken: "Meta не прийняла токен. Згенеруйте новий і вставте ще раз.",
  needAccountId: "Для цього токена вкажіть ID акаунта Instagram (число під назвою акаунта в Meta for Developers).",
  badUpload: "Можна завантажити до 10 файлів: фото JPEG або відео MP4.",
  adminOnly: "Це може лише власник.",
  viewerOnly: "У вас доступ лише на перегляд.",
  badMemberName: "Вкажіть ім'я (до 40 символів), яке ще не зайняте.",
  badRole: "Оберіть роль: редактор або перегляд.",
  noMember: "Учасника не знайдено — оновіть список.",
  teamFull: "У команді вже 30 людей.",
} as const;

const KINDS: PostKind[] = ["image", "carousel", "video", "story", "text"];

export interface PostInput {
  kind: PostKind;
  platforms: Platform[];
  caption: string;
  threadsText?: string;
  media: MediaItem[];
  thumb?: string;
  scheduledAt: Date;
}

const bad = (msg: string) => new UserError("invalid-argument", msg);

function cleanText(v: unknown): string {
  if (v === undefined || v === null) return "";
  if (typeof v !== "string") throw bad(SMSG.textEmpty);
  return v.replace(/\r\n/g, "\n").trim();
}

export function parsePlatforms(v: unknown): Platform[] {
  if (!Array.isArray(v) || !v.length || v.some((p) => !PLATFORMS.includes(p))) throw bad(SMSG.badPlatforms);
  return PLATFORMS.filter((p) => v.includes(p));
}

export function parseTime(v: unknown, now: Date): Date {
  const t = typeof v === "string" ? new Date(v) : null;
  if (!t || Number.isNaN(t.getTime())) throw bad(SMSG.badTime);
  if (t.getTime() < now.getTime() - LIMITS.pastSlackMs || t.getTime() > now.getTime() + LIMITS.aheadMs) throw bad(SMSG.badTime);
  return t;
}

/** Texts are checked against the platforms they go to. */
export function checkTexts(kind: PostKind, platforms: Platform[], caption: string, threadsText: string | undefined): void {
  if (caption.length > LIMITS.caption) throw bad(SMSG.captionLong);
  if (platforms.includes("threads")) {
    const t = threadsText ?? caption;
    if (t.length > LIMITS.threadsText) throw bad(SMSG.threadsLong);
    if (kind === "text" && !t) throw bad(SMSG.textEmpty);
  }
}

/** Validates a new post; media paths must belong to the draft the app uploaded them to. */
export function validatePost(raw: unknown, draftId: string, now: Date): PostInput {
  const r = (raw ?? {}) as Record<string, unknown>;
  const kind = r.kind as PostKind;
  if (!KINDS.includes(kind)) throw bad(SMSG.badKind);
  const platforms = parsePlatforms(r.platforms);
  if (kind === "story" && platforms.includes("threads")) throw bad(SMSG.storyThreads);
  if (kind === "text" && platforms.includes("instagram")) throw bad(SMSG.textInstagram);

  const prefix = `social/${draftId}/`;
  const pathRe = /^social\/[0-9a-f]{16}\/\d{1,2}\.(jpg|mp4)$/;
  const media: MediaItem[] = [];
  if (!Array.isArray(r.media)) throw bad(SMSG.badMedia);
  for (const m of r.media as Record<string, unknown>[]) {
    const path = m?.path;
    if (typeof path !== "string" || !path.startsWith(prefix) || !pathRe.test(path)) throw bad(SMSG.badMedia);
    const kindOf = path.endsWith(".mp4") ? "video" : "image";
    if (m.kind !== kindOf) throw bad(SMSG.badMedia);
    media.push({ path, kind: kindOf });
  }
  if (new Set(media.map((m) => m.path)).size !== media.length) throw bad(SMSG.badMedia);
  switch (kind) {
    case "text":
      if (media.length) throw bad(SMSG.mediaCount);
      break;
    case "image":
      if (media.length !== 1 || media[0].kind !== "image") throw bad(SMSG.mediaCount);
      break;
    case "video":
      if (media.length !== 1 || media[0].kind !== "video") throw bad(SMSG.mediaCount);
      break;
    case "story":
      if (media.length !== 1) throw bad(SMSG.mediaCount);
      break;
    case "carousel":
      if (media.length < LIMITS.carouselMin || media.length > LIMITS.carouselMax) throw bad(SMSG.carouselCount);
      break;
  }

  let thumb: string | undefined;
  if (r.thumb !== undefined && r.thumb !== null) {
    if (typeof r.thumb !== "string" || r.thumb.length > LIMITS.thumbChars || !/^\/9j\/[A-Za-z0-9+/]+=*$/.test(r.thumb)) throw bad(SMSG.badMedia);
    thumb = r.thumb;
  }

  const caption = kind === "story" ? "" : cleanText(r.caption);
  const threadsRaw = cleanText(r.threadsText);
  const threadsText = platforms.includes("threads") && threadsRaw ? threadsRaw : undefined;
  checkTexts(kind, platforms, caption, threadsText);

  return { kind, platforms, caption, ...(threadsText ? { threadsText } : {}), media, ...(thumb ? { thumb } : {}), scheduledAt: parseTime(r.scheduledAt, now) };
}
