import type { AccountApi, PublishApi } from "./meta.js";
import { PLATFORMS, SMSG, type Accounts, type Platform, type PlatformResult, type SocialAccount, type SocialPost } from "./model.js";

export interface SocialStore {
  getAccounts(): Promise<Accounts>;
  setAccount(p: Platform, a: SocialAccount | null): Promise<void>;
  /** Newest scheduledAt first. */
  listPosts(limit: number): Promise<(SocialPost & { id: string })[]>;
  /** Posts a tick should look at: scheduled ones whose time has come and publishing ones whose lease ran out. */
  listDue(now: Date): Promise<(SocialPost & { id: string })[]>;
  addPost(p: SocialPost): Promise<string>;
  /** Overwrites the post (the caller owns it through a lease). */
  savePost(id: string, p: SocialPost): Promise<void>;
  /**
   * Transactional read-modify-write. `fn` returns the new post, "delete", or null to leave it as is;
   * resolves the written post (null when skipped, deleted or missing). Errors thrown by `fn` propagate.
   */
  mutatePost(id: string, fn: (p: SocialPost | null) => SocialPost | "delete" | null): Promise<SocialPost | null>;
}

export interface MediaStore {
  uploadUrl(path: string, contentType: string, ttlMs: number): Promise<string>;
  readUrl(path: string, ttlMs: number): Promise<string>;
  exists(path: string): Promise<boolean>;
  remove(paths: string[]): Promise<void>;
}

export interface SocialDeps {
  social: SocialStore;
  media: MediaStore;
  publishApi(p: Platform, a: SocialAccount): PublishApi;
  accountApi(p: Platform): AccountApi;
  now(): Date;
  sleep(ms: number): Promise<void>;
  log(level: "info" | "warn" | "error", message: string, data: Record<string, unknown>): void;
}

export const TIMING = {
  /** A tick owns a claimed post this long; a crashed tick's post is picked up again after it. */
  leaseMs: 3 * 60_000,
  /** How long one tick keeps polling a post whose media Meta is still processing. */
  postBudgetMs: 50_000,
  pollMs: 5_000,
  /** Meta processing longer than this fails the platform. */
  maxProcessMs: 30 * 60_000,
  /** Meta downloads the media while creating the container; the link only has to live that long. */
  urlTtlMs: 2 * 3600_000,
  refreshEveryMs: 5 * 24 * 3600_000,
};

const final = (r: PlatformResult | undefined) => r?.state === "published" || r?.state === "failed";
const errText = (e: unknown) => (e instanceof Error ? e.message : String(e)).slice(0, 300);

export function isDue(p: SocialPost, now: Date): boolean {
  if (p.status === "scheduled") return p.scheduledAt.getTime() <= now.getTime();
  if (p.status === "publishing") return !p.leaseUntil || p.leaseUntil.getTime() <= now.getTime();
  return false;
}

/** Runs every minute: publishes due posts, one at a time, until the deadline. */
export async function runSocialTick(deps: SocialDeps, deadline: Date, checkTokens: boolean): Promise<void> {
  if (checkTokens) await refreshTokens(deps);
  const due = (await deps.social.listDue(deps.now())).sort((a, b) => a.scheduledAt.getTime() - b.scheduledAt.getTime());
  for (const p of due) {
    if (deps.now().getTime() + TIMING.postBudgetMs > deadline.getTime()) break;
    const claimed = await deps.social.mutatePost(p.id, (cur) => {
      const now = deps.now();
      if (!cur || !isDue(cur, now)) return null;
      return { ...cur, status: "publishing", leaseUntil: new Date(now.getTime() + TIMING.leaseMs) };
    });
    if (claimed) await processPost(p.id, claimed, deps);
  }
}

async function processPost(id: string, claimed: SocialPost, deps: SocialDeps): Promise<void> {
  const accounts = await deps.social.getAccounts();
  const started = deps.now().getTime();
  let post = claimed;
  const save = async (platform: Platform, r: PlatformResult) => {
    post = { ...post, results: { ...post.results, [platform]: r } };
    await deps.social.savePost(id, post);
  };

  for (;;) {
    let waiting = false;
    for (const platform of post.platforms) {
      const r = post.results[platform] ?? { state: "pending" };
      if (final(r)) continue;
      const account = accounts[platform];
      if (!account) {
        await save(platform, { state: "failed", error: SMSG.notConnected(platform) });
        continue;
      }
      try {
        const out = await step(post, platform, r, deps.publishApi(platform, account), deps, (x) => save(platform, x));
        if (out.wait) waiting = true;
        await save(platform, out.result);
        if (out.result.state === "published") deps.log("info", "social: published", { id, platform, mediaId: out.result.mediaId });
      } catch (e) {
        deps.log("warn", "social: platform failed", { id, platform, error: errText(e) });
        await save(platform, { state: "failed", error: errText(e) });
      }
    }
    if (post.platforms.every((p) => final(post.results[p]))) break;
    if (deps.now().getTime() - started > TIMING.postBudgetMs) break;
    if (waiting) await deps.sleep(TIMING.pollMs);
  }

  const now = deps.now();
  const done = post.platforms.every((p) => final(post.results[p]));
  if (!done) {
    // Release the lease so the next tick continues polling.
    await deps.social.savePost(id, { ...post, leaseUntil: now });
    return;
  }
  const allOk = post.platforms.every((p) => post.results[p]?.state === "published");
  let out: SocialPost = { ...post, leaseUntil: undefined, status: allOk ? "published" : "failed", updatedAt: now };
  if (post.platforms.some((p) => post.results[p]?.state === "published")) out.publishedAt = post.publishedAt ?? now;
  if (allOk && !post.mediaDeleted && post.media.length) {
    try {
      await deps.media.remove(post.media.map((m) => m.path));
      out = { ...out, mediaDeleted: true };
    } catch (e) {
      deps.log("warn", "social: media cleanup failed", { id, error: errText(e) });
    }
  }
  await deps.social.savePost(id, out);
}

/** One move of a platform's state machine: create containers → wait for Meta → publish. */
async function step(
  post: SocialPost,
  platform: Platform,
  r: PlatformResult,
  api: PublishApi,
  deps: SocialDeps,
  persist: (r: PlatformResult) => Promise<void>,
): Promise<{ result: PlatformResult; wait?: boolean }> {
  const now = deps.now();
  const fail = (error: string) => ({ result: { state: "failed" as const, error } });
  if (r.publishing) return fail("Невідомо, чи вийшла публікація (збій під час публікації). Перевірте акаунт, перш ніж повторювати.");
  const startedAt = r.startedAt ?? now;
  if (now.getTime() - startedAt.getTime() > TIMING.maxProcessMs) return fail("Meta обробляла медіа понад 30 хвилин. Спробуйте ще раз або коротше відео.");
  const text = platform === "threads" ? (post.threadsText ?? post.caption) : post.caption;
  const withUrl = async (i: number) => ({ ...post.media[i], url: await deps.media.readUrl(post.media[i].path, TIMING.urlTtlMs) });

  if (!r.containerId) {
    if (post.kind !== "carousel") {
      const item = post.media.length ? await withUrl(0) : undefined;
      return { result: { state: "processing", startedAt, containerId: await api.single(post.kind, item, text) } };
    }
    if (!r.children) {
      const children: string[] = [];
      for (let i = 0; i < post.media.length; i++) children.push(await api.carouselItem(await withUrl(i)));
      return { result: { state: "processing", startedAt, children } };
    }
    for (const c of r.children) {
      const s = await api.status(c);
      if (s.code === "error") return fail(s.message);
      if (s.code === "wait") return { result: { ...r, startedAt }, wait: true };
    }
    return { result: { ...r, state: "processing", startedAt, containerId: await api.carousel(r.children, text) } };
  }

  const s = await api.status(r.containerId);
  if (s.code === "error") return fail(s.message);
  if (s.code === "wait") return { result: r, wait: true };
  await persist({ ...r, publishing: true });
  const mediaId = await api.publish(r.containerId);
  const permalink = await api.permalink(mediaId).catch(() => undefined);
  return { result: { state: "published", mediaId, ...(permalink ? { permalink } : {}) } };
}

/** Long-lived tokens live 60 days; they are extended every 5 days (checked hourly). */
export async function refreshTokens(deps: SocialDeps): Promise<void> {
  const accounts = await deps.social.getAccounts();
  const now = deps.now();
  for (const p of PLATFORMS) {
    const a = accounts[p];
    if (!a || now.getTime() - a.refreshedAt.getTime() < TIMING.refreshEveryMs) continue;
    try {
      const r = await deps.accountApi(p).refresh(a.token, a.host);
      await deps.social.setAccount(p, {
        userId: a.userId,
        username: a.username,
        ...(a.host ? { host: a.host } : {}),
        connectedAt: a.connectedAt,
        token: r.token,
        refreshedAt: now,
        ...(r.expiresInSec ? { expiresAt: new Date(now.getTime() + r.expiresInSec * 1000) } : {}),
      });
      deps.log("info", "social: token refreshed", { platform: p });
    } catch (e) {
      // Retried next hour; the app shows the error in Settings.
      deps.log("warn", "social: token refresh failed", { platform: p, error: errText(e) });
      await deps.social.setAccount(p, { ...a, refreshError: errText(e) });
    }
  }
}
