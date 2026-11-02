import { randomBytes } from "node:crypto";
import { MSG, UserError } from "../errors.js";
import { pinGate, type FeedbackDeps } from "../feedback.js";
import { MetaError } from "./meta.js";
import { checkTexts, parsePlatforms, parseTime, PLATFORMS, SMSG, validatePost, type Accounts, type Platform, type PlatformResult, type SocialPost } from "./model.js";
import type { SocialDeps } from "./publisher.js";

export type SocialActionDeps = SocialDeps & Pick<FeedbackDeps, "store">;

/** What the app sees of a post — no tokens, container ids or bucket paths. */
export interface PostView {
  id: string;
  kind: SocialPost["kind"];
  platforms: Platform[];
  caption: string;
  threadsText?: string;
  mediaCount: number;
  thumb?: string;
  scheduledAt: string;
  status: SocialPost["status"];
  results: Partial<Record<Platform, { state: PlatformResult["state"]; permalink?: string; error?: string }>>;
  createdAt: string;
  publishedAt?: string;
}

export interface AccountView {
  username: string;
  expiresAt?: string;
  refreshError?: string;
}

const UPLOAD_TTL_MS = 30 * 60_000;
const LIST_LIMIT = 80;
const TOKEN_RE = /^[A-Za-z0-9_\-|.]{20,1000}$/;

function view(id: string, p: SocialPost): PostView {
  const results: PostView["results"] = {};
  for (const pl of p.platforms) {
    const r = p.results[pl];
    if (r) results[pl] = { state: r.state, ...(r.permalink ? { permalink: r.permalink } : {}), ...(r.error ? { error: r.error } : {}) };
  }
  return {
    id,
    kind: p.kind,
    platforms: p.platforms,
    caption: p.caption,
    ...(p.threadsText ? { threadsText: p.threadsText } : {}),
    mediaCount: p.media.length,
    ...(p.thumb ? { thumb: p.thumb } : {}),
    scheduledAt: p.scheduledAt.toISOString(),
    status: p.status,
    results,
    createdAt: p.createdAt.toISOString(),
    ...(p.publishedAt ? { publishedAt: p.publishedAt.toISOString() } : {}),
  };
}

function accountsView(a: Accounts): Partial<Record<Platform, AccountView>> {
  const out: Partial<Record<Platform, AccountView>> = {};
  for (const p of PLATFORMS) {
    const x = a[p];
    if (x) out[p] = { username: x.username, ...(x.expiresAt ? { expiresAt: x.expiresAt.toISOString() } : {}), ...(x.refreshError ? { refreshError: x.refreshError } : {}) };
  }
  return out;
}

const bad = (msg: string) => new UserError("invalid-argument", msg);
const str = (v: unknown) => (typeof v === "string" && v ? v : null);

/** Only scheduled or failed posts can be edited, rescheduled or deleted. */
function editable(p: SocialPost | null): SocialPost {
  if (!p) throw new UserError("not-found", SMSG.noPost);
  if (p.status === "publishing") throw new UserError("failed-precondition", SMSG.busy);
  if (p.status === "published") throw new UserError("failed-precondition", SMSG.done);
  return p;
}

/** Failed platforms start over; published ones stay published. */
function resetFailed(p: SocialPost): SocialPost["results"] {
  const out: SocialPost["results"] = {};
  for (const pl of p.platforms) out[pl] = p.results[pl]?.state === "published" ? p.results[pl] : { state: "pending" };
  return out;
}

/**
 * The «Donuts Post» app's single callable, PIN-protected like /staff:
 * login | posts | upload | create | update | remove | now | connect | disconnect.
 */
export async function socialAction(raw: unknown, ip: string, pin: string, deps: SocialActionDeps): Promise<unknown> {
  const r = (raw ?? {}) as Record<string, unknown>;
  await pinGate("socialFail", r.pin, pin, ip, deps);
  const now = deps.now();

  switch (r.action) {
    case "login":
      return { ok: true, accounts: accountsView(await deps.social.getAccounts()) };

    case "posts": {
      const list = await deps.social.listPosts(LIST_LIMIT);
      return { items: list.map((p) => view(p.id, p)), accounts: accountsView(await deps.social.getAccounts()) };
    }

    /** Signed PUT links for the app to upload media straight to the bucket. */
    case "upload": {
      const files = r.files;
      if (!Array.isArray(files) || !files.length || files.length > 10 || files.some((f) => f !== "image" && f !== "video")) throw bad(SMSG.badUpload);
      const draftId = randomBytes(8).toString("hex");
      const out = await Promise.all(
        (files as ("image" | "video")[]).map(async (kind, i) => {
          const path = `social/${draftId}/${i}.${kind === "video" ? "mp4" : "jpg"}`;
          const contentType = kind === "video" ? "video/mp4" : "image/jpeg";
          return { path, contentType, url: await deps.media.uploadUrl(path, contentType, UPLOAD_TTL_MS) };
        }),
      );
      return { draftId, files: out };
    }

    case "create": {
      const draftId = str(r.draftId) ?? "";
      if (!/^[0-9a-f]{16}$/.test(draftId)) throw bad(SMSG.badMedia);
      const input = validatePost(r.post, draftId, now);
      const accounts = await deps.social.getAccounts();
      for (const p of input.platforms) if (!accounts[p]) throw new UserError("failed-precondition", SMSG.notConnected(p));
      for (const m of input.media) if (!(await deps.media.exists(m.path))) throw bad(SMSG.badMedia);
      const post: SocialPost = { ...input, status: "scheduled", results: {}, createdAt: now, updatedAt: now };
      const id = await deps.social.addPost(post);
      deps.log("info", "social: scheduled", { id, kind: input.kind, platforms: input.platforms, at: input.scheduledAt.toISOString() });
      return { id };
    }

    /** Texts, time and (while nothing has gone out yet) platforms. */
    case "update": {
      const id = str(r.id);
      if (!id) throw new UserError("not-found", SMSG.noPost);
      const accounts = await deps.social.getAccounts();
      const saved = await deps.social.mutatePost(id, (cur) => {
        const p = editable(cur);
        const next: SocialPost = { ...p, updatedAt: now };
        if (r.caption !== undefined && p.kind !== "story") next.caption = typeof r.caption === "string" ? r.caption.replace(/\r\n/g, "\n").trim() : p.caption;
        if (r.threadsText !== undefined) {
          const t = typeof r.threadsText === "string" ? r.threadsText.replace(/\r\n/g, "\n").trim() : "";
          if (t) next.threadsText = t;
          else delete next.threadsText;
        }
        if (r.platforms !== undefined) {
          const platforms = parsePlatforms(r.platforms);
          const changed = platforms.join() !== p.platforms.join();
          if (changed && Object.values(p.results).some((x) => x && x.state !== "pending")) throw new UserError("failed-precondition", SMSG.done);
          if (p.kind === "story" && platforms.includes("threads")) throw bad(SMSG.storyThreads);
          if (p.kind === "text" && platforms.includes("instagram")) throw bad(SMSG.textInstagram);
          for (const pl of platforms) if (!accounts[pl]) throw new UserError("failed-precondition", SMSG.notConnected(pl));
          next.platforms = platforms;
        }
        if (r.scheduledAt !== undefined) {
          next.scheduledAt = parseTime(r.scheduledAt, now);
          next.status = "scheduled";
          next.results = resetFailed(next);
        }
        checkTexts(next.kind, next.platforms, next.caption, next.threadsText);
        return next;
      });
      return view(id, saved!);
    }

    /** Puts a scheduled or failed post at the head of the queue (the next tick, within a minute). */
    case "now": {
      const id = str(r.id);
      if (!id) throw new UserError("not-found", SMSG.noPost);
      const saved = await deps.social.mutatePost(id, (cur) => {
        const p = editable(cur);
        return { ...p, scheduledAt: now, status: "scheduled", results: resetFailed(p), updatedAt: now };
      });
      return view(id, saved!);
    }

    case "remove": {
      const id = str(r.id);
      if (!id) throw new UserError("not-found", SMSG.noPost);
      let media: string[] = [];
      await deps.social.mutatePost(id, (cur) => {
        if (!cur) throw new UserError("not-found", SMSG.noPost);
        if (cur.status === "publishing") throw new UserError("failed-precondition", SMSG.busy);
        media = cur.mediaDeleted ? [] : cur.media.map((m) => m.path);
        return "delete";
      });
      if (media.length) await deps.media.remove(media).catch((e) => deps.log("warn", "social: media cleanup failed", { id, error: String(e) }));
      return { ok: true };
    }

    /** Stores a long-lived token generated in the Meta developer dashboard. */
    case "connect": {
      const platform = r.platform as Platform;
      if (!PLATFORMS.includes(platform)) throw bad(SMSG.badPlatforms);
      const token = typeof r.token === "string" ? r.token.trim() : "";
      if (!TOKEN_RE.test(token)) throw bad(SMSG.badToken);
      let me: { userId: string; username: string };
      try {
        me = await deps.accountApi(platform).me(token);
      } catch (e) {
        deps.log("warn", "social: token rejected", { platform, error: e instanceof MetaError ? e.message : "unknown" });
        throw new UserError("failed-precondition", SMSG.badToken);
      }
      await deps.social.setAccount(platform, { token, userId: me.userId, username: me.username, connectedAt: now, refreshedAt: now });
      deps.log("info", "social: account connected", { platform, username: me.username });
      return { ok: true, accounts: accountsView(await deps.social.getAccounts()) };
    }

    case "disconnect": {
      const platform = r.platform as Platform;
      if (!PLATFORMS.includes(platform)) throw bad(SMSG.badPlatforms);
      await deps.social.setAccount(platform, null);
      return { ok: true, accounts: accountsView(await deps.social.getAccounts()) };
    }

    default:
      throw bad(MSG.badAction);
  }
}
