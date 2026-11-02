import type { MediaItem, Platform, PostKind } from "./model.js";

/**
 * Meta's publishing APIs: Instagram API with Instagram Login (graph.instagram.com) and the Threads API
 * (graph.threads.net). Both work in two steps — create a media container from a public URL, wait until
 * Meta has fetched and processed it, then publish it.
 */

export class MetaError extends Error {
  constructor(
    message: string,
    readonly code?: number,
  ) {
    super(message);
    this.name = "MetaError";
  }
}

export type ContainerStatus = { code: "ready" } | { code: "wait" } | { code: "error"; message: string };

export interface PublishApi {
  /** A container for a single photo, video, story or text post. */
  single(kind: PostKind, item: (MediaItem & { url: string }) | undefined, text: string): Promise<string>;
  carouselItem(item: MediaItem & { url: string }): Promise<string>;
  carousel(children: string[], text: string): Promise<string>;
  status(containerId: string): Promise<ContainerStatus>;
  publish(containerId: string): Promise<string>;
  permalink(mediaId: string): Promise<string | undefined>;
}

/**
 * Instagram tokens come in two kinds: Instagram Login tokens (IGAA…, graph.instagram.com) and, for apps
 * created since Meta's «Unified login» (late 2026), Facebook tokens (EAA…, graph.facebook.com) that reach
 * the Instagram account through a Page or the business portfolio. Publishing calls are the same on both.
 */
export type IgHost = "instagram" | "facebook";
export const igHostOf = (token: string): IgHost => (token.startsWith("EAA") ? "facebook" : "instagram");
const FB = "https://graph.facebook.com";

export interface AccountApi {
  /** `accountId`: the Instagram account id from the dashboard, for Facebook tokens that cannot name it. */
  me(token: string, accountId?: string): Promise<{ userId: string; username: string; host?: IgHost }>;
  /** Extends a long-lived token by 60 days (it must be at least a day old). */
  refresh(token: string): Promise<{ token: string; expiresInSec?: number }>;
}

export type Fetch = (url: string, init?: { method?: string; body?: URLSearchParams }) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;

const HOSTS: Record<Platform, string> = {
  instagram: "https://graph.instagram.com",
  threads: "https://graph.threads.net",
};
const VERSIONS: Record<Platform, string> = { instagram: "v24.0", threads: "v1.0" };

async function call(fetchFn: Fetch, method: "GET" | "POST", url: string, params: Record<string, string>): Promise<Record<string, unknown>> {
  const qs = new URLSearchParams(params);
  const res = method === "GET" ? await fetchFn(`${url}?${qs}`) : await fetchFn(url, { method: "POST", body: qs });
  const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok || body.error) {
    const e = (body.error ?? {}) as Record<string, unknown>;
    const msg = String(e.error_user_msg || e.message || `HTTP ${res.status}`);
    throw new MetaError(msg, typeof e.code === "number" ? e.code : res.status);
  }
  return body;
}

function idOf(body: Record<string, unknown>): string {
  if (typeof body.id !== "string" || !body.id) throw new MetaError("Meta не повернула id");
  return body.id;
}

export function accountApi(platform: Platform, fetchFn: Fetch): AccountApi {
  const host = HOSTS[platform];
  const v = VERSIONS[platform];
  return {
    async me(token, accountId) {
      if (platform === "instagram" && igHostOf(token) === "facebook" && accountId) {
        const b = await call(fetchFn, "GET", `${FB}/${v}/${accountId}`, { fields: "id,username", access_token: token });
        return { userId: String(b.id), username: String(b.username ?? ""), host: "facebook" };
      }
      if (platform === "instagram" && igHostOf(token) === "facebook") {
        // Unified-login tokens are issued for the Instagram account itself: /me is that account.
        const self = await call(fetchFn, "GET", `${FB}/${v}/me`, { fields: "id,username", access_token: token }).catch(() => null);
        if (self && typeof self.username === "string" && self.username) return { userId: String(self.id), username: self.username, host: "facebook" };
        const b = await call(fetchFn, "GET", `${FB}/${v}/me/accounts`, { fields: "instagram_business_account{id,username}", access_token: token });
        const ig = ((b.data as Record<string, unknown>[] | undefined) ?? [])
          .map((p) => p.instagram_business_account as Record<string, unknown> | undefined)
          .find((x) => x && typeof x.id === "string");
        if (!ig) throw new MetaError("Токен не має доступу до жодного професійного акаунта Instagram");
        return { userId: String(ig.id), username: String(ig.username ?? ""), host: "facebook" };
      }
      if (platform === "instagram") {
        const b = await call(fetchFn, "GET", `${host}/${v}/me`, { fields: "user_id,username", access_token: token });
        return { userId: String(b.user_id ?? b.id), username: String(b.username ?? ""), host: "instagram" };
      }
      const b = await call(fetchFn, "GET", `${host}/${v}/me`, { fields: "id,username", access_token: token });
      return { userId: String(b.id), username: String(b.username ?? "") };
    },
    async refresh(token) {
      // Facebook tokens from the dashboard (system user / page) do not expire and have no refresh call.
      if (platform === "instagram" && igHostOf(token) === "facebook") return { token };
      const grant = platform === "instagram" ? "ig_refresh_token" : "th_refresh_token";
      const b = await call(fetchFn, "GET", `${host}/refresh_access_token`, { grant_type: grant, access_token: token });
      if (typeof b.access_token !== "string") throw new MetaError("Meta не повернула токен");
      return { token: b.access_token, ...(typeof b.expires_in === "number" ? { expiresInSec: b.expires_in } : {}) };
    },
  };
}

export function instagramApi(userId: string, token: string, fetchFn: Fetch): PublishApi {
  const base = `${igHostOf(token) === "facebook" ? FB : HOSTS.instagram}/${VERSIONS.instagram}`;
  const post = (path: string, p: Record<string, string>) => call(fetchFn, "POST", `${base}/${path}`, { ...p, access_token: token });
  const media = (p: Record<string, string>) => post(`${userId}/media`, p).then(idOf);
  return {
    single(kind, item, text) {
      if (!item) throw new MetaError("Instagram потребує фото або відео");
      const src: Record<string, string> = item.kind === "video" ? { video_url: item.url } : { image_url: item.url };
      if (kind === "story") return media({ media_type: "STORIES", ...src });
      if (item.kind === "video") return media({ media_type: "REELS", ...src, caption: text, share_to_feed: "true" });
      return media({ ...src, caption: text });
    },
    carouselItem(item) {
      return media(item.kind === "video" ? { media_type: "VIDEO", video_url: item.url, is_carousel_item: "true" } : { image_url: item.url, is_carousel_item: "true" });
    },
    carousel(children, text) {
      return media({ media_type: "CAROUSEL", children: children.join(","), caption: text });
    },
    async status(id) {
      const b = await call(fetchFn, "GET", `${base}/${id}`, { fields: "status_code,status", access_token: token });
      return statusOf(String(b.status_code ?? ""), String(b.status ?? ""));
    },
    async publish(id) {
      return idOf(await post(`${userId}/media_publish`, { creation_id: id }));
    },
    async permalink(mediaId) {
      const b = await call(fetchFn, "GET", `${base}/${mediaId}`, { fields: "permalink", access_token: token });
      return typeof b.permalink === "string" ? b.permalink : undefined;
    },
  };
}

export function threadsApi(userId: string, token: string, fetchFn: Fetch): PublishApi {
  const base = `${HOSTS.threads}/${VERSIONS.threads}`;
  const post = (path: string, p: Record<string, string>) => call(fetchFn, "POST", `${base}/${path}`, { ...p, access_token: token });
  const container = (p: Record<string, string>) => post(`${userId}/threads`, p).then(idOf);
  const src = (item: MediaItem & { url: string }): Record<string, string> => (item.kind === "video" ? { media_type: "VIDEO", video_url: item.url } : { media_type: "IMAGE", image_url: item.url });
  return {
    single(_kind, item, text) {
      return container(item ? { ...src(item), text } : { media_type: "TEXT", text });
    },
    carouselItem(item) {
      return container({ ...src(item), is_carousel_item: "true" });
    },
    carousel(children, text) {
      return container({ media_type: "CAROUSEL", children: children.join(","), text });
    },
    async status(id) {
      const b = await call(fetchFn, "GET", `${base}/${id}`, { fields: "status,error_message", access_token: token });
      return statusOf(String(b.status ?? ""), String(b.error_message ?? ""));
    },
    async publish(id) {
      return idOf(await post(`${userId}/threads_publish`, { creation_id: id }));
    },
    async permalink(mediaId) {
      const b = await call(fetchFn, "GET", `${base}/${mediaId}`, { fields: "permalink", access_token: token });
      return typeof b.permalink === "string" ? b.permalink : undefined;
    },
  };
}

function statusOf(code: string, detail: string): ContainerStatus {
  switch (code) {
    case "FINISHED":
      return { code: "ready" };
    case "IN_PROGRESS":
    case "":
      return { code: "wait" };
    case "PUBLISHED":
      return { code: "error", message: "Контейнер уже опубліковано" };
    case "EXPIRED":
      return { code: "error", message: "Meta не встигла обробити медіа (контейнер прострочено)" };
    default:
      return { code: "error", message: detail || "Meta не змогла обробити медіа" };
  }
}
