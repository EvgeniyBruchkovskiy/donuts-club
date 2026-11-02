import { describe, expect, it } from "vitest";
import type { AccountApi, ContainerStatus, PublishApi } from "../src/social/meta.js";
import { validatePost, type Accounts, type Platform, type SocialAccount, type SocialPost } from "../src/social/model.js";
import { refreshTokens, runSocialTick, TIMING, type MediaStore, type SocialDeps, type SocialStore } from "../src/social/publisher.js";
import { socialAction, type SocialActionDeps } from "../src/social/service.js";
import { MemoryStore } from "./fakes.js";

const NOW = new Date("2026-11-02T10:00:00Z");
const MIN = 60_000;
const DRAFT = "0123456789abcdef";
const PIN = "4321";
const IP = "ip";
const THUMB = "/9j/4AAQSkZJRg==";

class MemorySocial implements SocialStore {
  accounts: Accounts = {};
  posts = new Map<string, SocialPost>();
  seq = 0;
  async getAccounts() {
    return structuredClone(this.accounts);
  }
  async setAccount(p: Platform, a: SocialAccount | null) {
    if (a) this.accounts[p] = a;
    else delete this.accounts[p];
  }
  async listPosts(limit: number) {
    return [...this.posts].map(([id, p]) => ({ ...structuredClone(p), id })).sort((a, b) => b.scheduledAt.getTime() - a.scheduledAt.getTime()).slice(0, limit);
  }
  async listDue(now: Date) {
    return [...this.posts]
      .filter(([, p]) => {
        const due = p.status === "scheduled" ? p.scheduledAt : p.status === "publishing" ? (p.leaseUntil ?? p.scheduledAt) : null;
        return due !== null && due.getTime() <= now.getTime();
      })
      .map(([id, p]) => ({ ...structuredClone(p), id }));
  }
  async addPost(p: SocialPost) {
    const id = `p${++this.seq}`;
    this.posts.set(id, structuredClone(p));
    return id;
  }
  async savePost(id: string, p: SocialPost) {
    this.posts.set(id, structuredClone(p));
  }
  async mutatePost(id: string, fn: (p: SocialPost | null) => SocialPost | "delete" | null) {
    const cur = this.posts.get(id);
    const next = fn(cur ? structuredClone(cur) : null);
    if (next === null) return null;
    if (next === "delete") {
      this.posts.delete(id);
      return null;
    }
    this.posts.set(id, structuredClone(next));
    return next;
  }
}

class FakeMedia implements MediaStore {
  files = new Set<string>();
  removed: string[] = [];
  async uploadUrl(path: string, contentType: string) {
    return `https://up/${path}?ct=${contentType}`;
  }
  async readUrl(path: string) {
    return `https://read/${path}`;
  }
  async exists(path: string) {
    return this.files.has(path);
  }
  async remove(paths: string[]) {
    this.removed.push(...paths);
    for (const p of paths) this.files.delete(p);
  }
}

/** Meta stand-in: containers become ready after `readyAfter` status checks. */
class FakeMeta implements PublishApi {
  calls: string[] = [];
  readyAfter = 0;
  checks = new Map<string, number>();
  failOn?: string;
  statusError?: string;
  n = 0;
  constructor(readonly name: Platform) {}
  private id(what: string) {
    if (this.failOn === what) throw new Error(`${this.name} rejected ${what}`);
    this.calls.push(what);
    return `${this.name}-${what}-${++this.n}`;
  }
  async single(kind: string, item: { url: string } | undefined, text: string) {
    return this.id(`single:${kind}:${item?.url ?? "-"}:${text}`);
  }
  async carouselItem(item: { url: string }) {
    return this.id(`item:${item.url}`);
  }
  async carousel(children: string[], text: string) {
    return this.id(`carousel:${children.length}:${text}`);
  }
  async status(id: string): Promise<ContainerStatus> {
    if (this.statusError) return { code: "error", message: this.statusError };
    const n = (this.checks.get(id) ?? 0) + 1;
    this.checks.set(id, n);
    return n > this.readyAfter ? { code: "ready" } : { code: "wait" };
  }
  async publish(id: string) {
    if (this.failOn === "publish") throw new Error("publish exploded");
    this.calls.push(`publish:${id}`);
    return `${this.name}-media`;
  }
  async permalink() {
    return `https://${this.name}/p/1`;
  }
}

const account = (username: string): SocialAccount => ({ token: `tok-${username}`, userId: "17841", username, connectedAt: NOW, refreshedAt: NOW });

function setup() {
  let now = NOW.getTime();
  const social = new MemorySocial();
  social.accounts = { instagram: account("donutsclub"), threads: account("donutsclub") };
  const media = new FakeMedia();
  const meta = { instagram: new FakeMeta("instagram"), threads: new FakeMeta("threads") };
  const refreshed: string[] = [];
  const accountApi = (p: Platform): AccountApi => ({
    async me(token) {
      if (token.startsWith("bad")) throw new Error("Invalid OAuth access token");
      return { userId: `${p}-id`, username: `dc_${p}` };
    },
    async refresh(token) {
      refreshed.push(p);
      if (token.includes("dead")) throw new Error("Session expired");
      return { token: `${token}+`, expiresInSec: 5_184_000 };
    },
  });
  const deps: SocialActionDeps = {
    social,
    media,
    publishApi: (p) => meta[p],
    accountApi,
    now: () => new Date(now),
    sleep: async (ms) => {
      now += ms;
    },
    log: () => {},
    store: new MemoryStore(),
  };
  const tick = (checkTokens = false) => runSocialTick(deps as SocialDeps, new Date(now + 5 * MIN), checkTokens);
  const advance = (ms: number) => (now += ms);
  return { deps, social, media, meta, tick, advance, refreshed };
}

function post(over: Partial<SocialPost> = {}): SocialPost {
  return {
    kind: "image",
    platforms: ["instagram", "threads"],
    caption: "Нові пончики з фісташкою 🍩",
    media: [{ path: `social/${DRAFT}/0.jpg`, kind: "image" }],
    scheduledAt: NOW,
    status: "scheduled",
    results: {},
    createdAt: NOW,
    updatedAt: NOW,
    ...over,
  };
}

describe("validatePost", () => {
  const ok = { kind: "image", platforms: ["threads", "instagram"], caption: " Привіт \r\n", media: [{ path: `social/${DRAFT}/0.jpg`, kind: "image" }], scheduledAt: NOW.toISOString() };

  it("accepts a photo post and orders platforms", () => {
    expect(validatePost({ ...ok, thumb: THUMB }, DRAFT, NOW)).toEqual({
      kind: "image",
      platforms: ["instagram", "threads"],
      caption: "Привіт",
      media: [{ path: `social/${DRAFT}/0.jpg`, kind: "image" }],
      thumb: THUMB,
      scheduledAt: NOW,
    });
  });

  it("keeps the Threads text only when Threads is chosen", () => {
    expect(validatePost({ ...ok, threadsText: "Коротко" }, DRAFT, NOW).threadsText).toBe("Коротко");
    expect(validatePost({ ...ok, platforms: ["instagram"], threadsText: "Коротко" }, DRAFT, NOW).threadsText).toBeUndefined();
  });

  it("accepts a text-only Threads post and a 10-item carousel", () => {
    expect(validatePost({ kind: "text", platforms: ["threads"], caption: "Сьогодні до 22:00", media: [], scheduledAt: NOW.toISOString() }, DRAFT, NOW).kind).toBe("text");
    const media = Array.from({ length: 10 }, (_, i) => ({ path: `social/${DRAFT}/${i}.${i % 2 ? "mp4" : "jpg"}`, kind: i % 2 ? "video" : "image" }));
    expect(validatePost({ ...ok, kind: "carousel", media }, DRAFT, NOW).media).toHaveLength(10);
  });

  it.each([
    ["unknown kind", { kind: "reel" }],
    ["no platforms", { platforms: [] }],
    ["story to Threads", { kind: "story" }],
    ["text to Instagram", { kind: "text", media: [] }],
    ["another draft's media", { media: [{ path: "social/ffffffffffffffff/0.jpg", kind: "image" }] }],
    ["kind mismatch", { media: [{ path: `social/${DRAFT}/0.jpg`, kind: "video" }] }],
    ["traversal", { media: [{ path: `social/${DRAFT}/../x.jpg`, kind: "image" }] }],
    ["two photos as a photo post", { media: [{ path: `social/${DRAFT}/0.jpg`, kind: "image" }, { path: `social/${DRAFT}/1.jpg`, kind: "image" }] }],
    ["one-item carousel", { kind: "carousel" }],
    ["long caption", { caption: "x".repeat(2201) }],
    ["long Threads text", { caption: "x".repeat(501) }],
    ["past time", { scheduledAt: new Date(NOW.getTime() - 11 * MIN).toISOString() }],
    ["too far ahead", { scheduledAt: new Date(NOW.getTime() + 61 * 24 * 60 * MIN).toISOString() }],
    ["non-JPEG thumb", { thumb: "iVBORw0KGgo=" }],
  ])("rejects %s", (_name, over) => {
    expect(() => validatePost({ ...ok, ...over }, DRAFT, NOW)).toThrow(expect.objectContaining({ code: "invalid-argument" }));
  });
});

describe("runSocialTick", () => {
  it("publishes a due photo to both platforms and deletes the original", async () => {
    const { social, media, meta, tick } = setup();
    media.files.add(`social/${DRAFT}/0.jpg`);
    const id = await social.addPost(post());
    await social.addPost(post({ scheduledAt: new Date(NOW.getTime() + 30 * MIN) }));
    await tick();

    const p = social.posts.get(id)!;
    expect(p.status).toBe("published");
    expect(p.results.instagram).toEqual({ state: "published", mediaId: "instagram-media", permalink: "https://instagram/p/1" });
    expect(p.results.threads?.state).toBe("published");
    expect(meta.instagram.calls[0]).toBe(`single:image:https://read/social/${DRAFT}/0.jpg:Нові пончики з фісташкою 🍩`);
    expect(media.removed).toEqual([`social/${DRAFT}/0.jpg`]);
    expect(p.mediaDeleted).toBe(true);
    expect(p.publishedAt).toEqual(NOW);
    expect(social.posts.get("p2")!.status).toBe("scheduled");
  });

  it("sends the Threads text to Threads and the caption to Instagram", async () => {
    const { social, meta, tick } = setup();
    await social.addPost(post({ threadsText: "Коротше для Threads" }));
    await tick();
    expect(meta.threads.calls[0]).toContain(":Коротше для Threads");
    expect(meta.instagram.calls[0]).toContain(":Нові пончики");
  });

  it("keeps polling a video Meta is still processing across ticks", async () => {
    const { social, meta, tick, advance } = setup();
    meta.instagram.readyAfter = 15; // one tick polls ~10 times
    const id = await social.addPost(post({ kind: "video", platforms: ["instagram"], media: [{ path: `social/${DRAFT}/0.mp4`, kind: "video" }] }));
    await tick();
    let p = social.posts.get(id)!;
    expect(p.status).toBe("publishing");
    expect(p.results.instagram?.state).toBe("processing");
    expect(meta.instagram.calls.filter((c) => c.startsWith("single"))).toHaveLength(1);

    advance(MIN);
    await tick();
    p = social.posts.get(id)!;
    expect(p.status).toBe("published");
    expect(meta.instagram.calls.filter((c) => c.startsWith("single"))).toHaveLength(1); // container reused
  });

  it("does not touch a post another tick holds", async () => {
    const { social, meta, tick } = setup();
    await social.addPost(post({ status: "publishing", leaseUntil: new Date(NOW.getTime() + MIN) }));
    await tick();
    expect(meta.instagram.calls).toEqual([]);
  });

  it("builds a carousel from item containers once they are ready", async () => {
    const { social, meta, tick } = setup();
    meta.threads.readyAfter = 1;
    const media = [0, 1, 2].map((i) => ({ path: `social/${DRAFT}/${i}.jpg`, kind: "image" as const }));
    const id = await social.addPost(post({ kind: "carousel", media }));
    await tick();
    expect(social.posts.get(id)!.status).toBe("published");
    expect(meta.threads.calls.filter((c) => c.startsWith("item:"))).toHaveLength(3);
    expect(meta.threads.calls).toContain("carousel:3:Нові пончики з фісташкою 🍩");
  });

  it("fails one platform without stopping the other, and «now» retries only the failed one", async () => {
    const { deps, social, media, meta, tick, advance } = setup();
    media.files.add(`social/${DRAFT}/0.jpg`);
    meta.threads.failOn = `single:image:https://read/social/${DRAFT}/0.jpg:Нові пончики з фісташкою 🍩`;
    const id = await social.addPost(post());
    await tick();
    let p = social.posts.get(id)!;
    expect(p.status).toBe("failed");
    expect(p.results.instagram?.state).toBe("published");
    expect(p.results.threads).toMatchObject({ state: "failed", error: expect.stringContaining("threads rejected") });
    expect(media.removed).toEqual([]); // kept for the retry

    meta.threads.failOn = undefined;
    advance(MIN);
    await socialAction({ pin: PIN, action: "now", id }, IP, PIN, deps);
    await tick();
    p = social.posts.get(id)!;
    expect(p.status).toBe("published");
    expect(meta.instagram.calls.filter((c) => c.startsWith("publish"))).toHaveLength(1);
    expect(media.removed).toEqual([`social/${DRAFT}/0.jpg`]);
  });

  it("reports Meta's processing error", async () => {
    const { social, meta, tick } = setup();
    meta.instagram.statusError = "The video's aspect ratio is not supported";
    const id = await social.addPost(post({ platforms: ["instagram"] }));
    await tick();
    expect(social.posts.get(id)!.results.instagram).toEqual({ state: "failed", error: "The video's aspect ratio is not supported" });
  });

  it("never publishes twice after a crash mid-publish", async () => {
    const { social, meta, tick } = setup();
    const id = await social.addPost(
      post({ platforms: ["instagram"], status: "publishing", leaseUntil: NOW, results: { instagram: { state: "processing", containerId: "c1", publishing: true, startedAt: NOW } } }),
    );
    await tick();
    expect(social.posts.get(id)!.results.instagram).toMatchObject({ state: "failed", error: expect.stringContaining("Невідомо") });
    expect(meta.instagram.calls).toEqual([]);
  });

  it("gives up when Meta processes longer than 30 minutes", async () => {
    const { social, meta, tick } = setup();
    meta.instagram.readyAfter = 1e9;
    const startedAt = new Date(NOW.getTime() - TIMING.maxProcessMs - 1);
    const id = await social.addPost(post({ platforms: ["instagram"], results: { instagram: { state: "processing", containerId: "c1", startedAt } } }));
    await tick();
    expect(social.posts.get(id)!.status).toBe("failed");
  });

  it("fails a platform that was disconnected", async () => {
    const { social, tick } = setup();
    delete social.accounts.threads;
    const id = await social.addPost(post());
    await tick();
    expect(social.posts.get(id)!.results.threads).toEqual({ state: "failed", error: "Підключіть Threads у налаштуваннях." });
  });
});

describe("refreshTokens", () => {
  it("extends tokens older than 5 days and records failures", async () => {
    const { deps, social, refreshed } = setup();
    const old = new Date(NOW.getTime() - 6 * 24 * 60 * MIN);
    social.accounts.instagram = { ...account("dc"), refreshedAt: old };
    social.accounts.threads = { ...account("dc"), token: "tok-dead", refreshedAt: old };
    await refreshTokens(deps);
    expect(refreshed).toEqual(["instagram", "threads"]);
    expect(social.accounts.instagram).toMatchObject({ token: "tok-dc+", refreshedAt: NOW, expiresAt: new Date(NOW.getTime() + 5_184_000_000) });
    expect(social.accounts.threads).toMatchObject({ token: "tok-dead", refreshError: "Session expired", refreshedAt: old });

    refreshed.length = 0;
    social.accounts.instagram.refreshedAt = NOW;
    delete social.accounts.threads;
    await refreshTokens(deps);
    expect(refreshed).toEqual([]);
  });
});

describe("socialAction", () => {
  const create = (over: Record<string, unknown> = {}) => ({
    pin: PIN,
    action: "create",
    draftId: DRAFT,
    post: { kind: "image", platforms: ["instagram", "threads"], caption: "Пончик дня", media: [{ path: `social/${DRAFT}/0.jpg`, kind: "image" }], scheduledAt: new Date(NOW.getTime() + 60 * MIN).toISOString(), ...over },
  });

  it("checks the PIN and locks out after repeated failures", async () => {
    const { deps } = setup();
    await expect(socialAction({ pin: "0000", action: "login" }, IP, PIN, deps)).rejects.toMatchObject({ code: "failed-precondition" });
    await expect(socialAction({ pin: PIN, action: "login" }, IP, "", deps)).rejects.toMatchObject({ code: "failed-precondition" });
    for (let i = 0; i < 8; i++) await socialAction({ pin: "1", action: "login" }, IP, PIN, deps).catch(() => {});
    await expect(socialAction({ pin: PIN, action: "login" }, IP, PIN, deps)).rejects.toMatchObject({ code: "resource-exhausted" });
  });

  it("logs in and shows connected accounts without tokens", async () => {
    const { deps } = setup();
    const r = await socialAction({ pin: PIN, action: "login" }, IP, PIN, deps);
    expect(r).toEqual({ ok: true, accounts: { instagram: { username: "donutsclub" }, threads: { username: "donutsclub" } } });
    expect(JSON.stringify(r)).not.toContain("tok-");
  });

  it("hands out upload links in a fresh draft", async () => {
    const { deps } = setup();
    const r = (await socialAction({ pin: PIN, action: "upload", files: ["image", "video"] }, IP, PIN, deps)) as { draftId: string; files: { path: string; contentType: string }[] };
    expect(r.draftId).toMatch(/^[0-9a-f]{16}$/);
    expect(r.files.map((f) => [f.path, f.contentType])).toEqual([
      [`social/${r.draftId}/0.jpg`, "image/jpeg"],
      [`social/${r.draftId}/1.mp4`, "video/mp4"],
    ]);
    await expect(socialAction({ pin: PIN, action: "upload", files: ["pdf"] }, IP, PIN, deps)).rejects.toMatchObject({ code: "invalid-argument" });
  });

  it("schedules a post only when its media were uploaded and accounts are connected", async () => {
    const { deps, social, media } = setup();
    await expect(socialAction(create(), IP, PIN, deps)).rejects.toMatchObject({ code: "invalid-argument" });
    media.files.add(`social/${DRAFT}/0.jpg`);
    const { id } = (await socialAction(create({ thumb: THUMB }), IP, PIN, deps)) as { id: string };
    expect(social.posts.get(id)).toMatchObject({ status: "scheduled", caption: "Пончик дня", thumb: THUMB });

    delete social.accounts.threads;
    await expect(socialAction(create(), IP, PIN, deps)).rejects.toMatchObject({ code: "failed-precondition", message: "Підключіть Threads у налаштуваннях." });
  });

  it("lists posts newest first without internals", async () => {
    const { deps, social } = setup();
    await social.addPost(post({ results: { instagram: { state: "processing", containerId: "secret-container" } } }));
    await social.addPost(post({ scheduledAt: new Date(NOW.getTime() + MIN) }));
    const r = (await socialAction({ pin: PIN, action: "posts" }, IP, PIN, deps)) as { items: { id: string; results: object }[] };
    expect(r.items.map((i) => i.id)).toEqual(["p2", "p1"]);
    expect(JSON.stringify(r)).not.toContain("secret-container");
    expect(JSON.stringify(r)).not.toContain("social/");
  });

  it("edits texts and time of a scheduled post, but not of a published one", async () => {
    const { deps, social } = setup();
    const id = await social.addPost(post());
    const at = new Date(NOW.getTime() + 120 * MIN).toISOString();
    const v = await socialAction({ pin: PIN, action: "update", id, caption: "Новий текст", threadsText: "Для Threads", scheduledAt: at, platforms: ["instagram"] }, IP, PIN, deps);
    expect(v).toMatchObject({ caption: "Новий текст", threadsText: "Для Threads", scheduledAt: at, platforms: ["instagram"] });
    await expect(socialAction({ pin: PIN, action: "update", id, caption: "x".repeat(2201) }, IP, PIN, deps)).rejects.toMatchObject({ code: "invalid-argument" });

    const done = await social.addPost(post({ status: "published" }));
    await expect(socialAction({ pin: PIN, action: "update", id: done, caption: "x" }, IP, PIN, deps)).rejects.toMatchObject({ code: "failed-precondition" });
    await expect(socialAction({ pin: PIN, action: "update", id: "nope", caption: "x" }, IP, PIN, deps)).rejects.toMatchObject({ code: "not-found" });
  });

  it("removes a post with its media, but not while it is publishing", async () => {
    const { deps, social, media } = setup();
    const id = await social.addPost(post());
    expect(await socialAction({ pin: PIN, action: "remove", id }, IP, PIN, deps)).toEqual({ ok: true });
    expect(social.posts.has(id)).toBe(false);
    expect(media.removed).toEqual([`social/${DRAFT}/0.jpg`]);

    const busy = await social.addPost(post({ status: "publishing", leaseUntil: NOW }));
    await expect(socialAction({ pin: PIN, action: "remove", id: busy }, IP, PIN, deps)).rejects.toMatchObject({ code: "failed-precondition" });
  });

  it("connects an account after Meta accepts the token", async () => {
    const { deps, social } = setup();
    social.accounts = {};
    await expect(socialAction({ pin: PIN, action: "connect", platform: "threads", token: "bad-token-0123456789abcdef" }, IP, PIN, deps)).rejects.toMatchObject({ code: "failed-precondition" });
    const r = await socialAction({ pin: PIN, action: "connect", platform: "threads", token: " THAAgood-token-0123456789 " }, IP, PIN, deps);
    expect(r).toEqual({ ok: true, accounts: { threads: { username: "dc_threads" } } });
    expect(social.accounts.threads).toMatchObject({ token: "THAAgood-token-0123456789", userId: "threads-id", refreshedAt: NOW });

    await socialAction({ pin: PIN, action: "disconnect", platform: "threads" }, IP, PIN, deps);
    expect(social.accounts.threads).toBeUndefined();
  });
});

describe("Instagram token kinds", async () => {
  const { accountApi, instagramApi } = await import("../src/social/meta.js");
  const fake = (body: unknown) => {
    const urls: string[] = [];
    const f = async (url: string) => {
      urls.push(url);
      return { ok: true, status: 200, json: async () => body };
    };
    return { f, urls };
  };

  it("takes the Instagram account a Unified-login token was issued for", async () => {
    const { f, urls } = fake({ id: "1784", username: "donuts_club_krop" });
    expect(await accountApi("instagram", f).me("EAAtoken-0123456789")).toEqual({ userId: "1784", username: "donuts_club_krop", host: "facebook" });
    expect(urls).toHaveLength(1);
  });

  it("falls back to graph.instagram.com for an EAA token Facebook rejects", async () => {
    const urls: string[] = [];
    const f = async (url: string) => {
      urls.push(url);
      const ig = url.startsWith("https://graph.instagram.com");
      return { ok: ig, status: ig ? 200 : 400, json: async () => (ig ? { user_id: "1784", username: "donuts_club_krop" } : { error: { message: "Object does not exist" } }) };
    };
    expect(await accountApi("instagram", f).me("EAAtoken-0123456789", "1784")).toEqual({ userId: "1784", username: "donuts_club_krop", host: "instagram" });
    expect(urls.at(-1)).toMatch(/^https:\/\/graph\.instagram\.com\/v24\.0\/me\?/);
    const pub = fake({ id: "c1" });
    await instagramApi("1784", "EAAtoken-0123456789", pub.f, "instagram").single("image", { path: "p", kind: "image", url: "https://x/y.jpg" }, "Hi");
    expect(pub.urls[0]).toBe("https://graph.instagram.com/v24.0/1784/media");
  });

  it("finds the Instagram account behind a Facebook token and publishes through graph.facebook.com", async () => {
    const { f, urls } = fake({ id: "fb-user", data: [{ id: "page1" }, { id: "page2", instagram_business_account: { id: "1784", username: "donuts_club_krop" } }] });
    expect(await accountApi("instagram", f).me("EAAtoken-0123456789")).toEqual({ userId: "1784", username: "donuts_club_krop", host: "facebook" });
    expect(urls[1]).toMatch(/^https:\/\/graph\.facebook\.com\/v24\.0\/me\/accounts\?/);
    expect(await accountApi("instagram", f).refresh("EAAtoken-0123456789")).toEqual({ token: "EAAtoken-0123456789" });

    const pub = fake({ id: "c1" });
    await instagramApi("1784", "EAAtoken-0123456789", pub.f).single("image", { path: "p", kind: "image", url: "https://x/y.jpg" }, "Hi");
    expect(pub.urls[0]).toBe("https://graph.facebook.com/v24.0/1784/media");
  });

  it("keeps Instagram Login tokens on graph.instagram.com", async () => {
    const { f, urls } = fake({ user_id: "1784", username: "donuts_club_krop" });
    expect(await accountApi("instagram", f).me("IGAAtoken-0123456789")).toMatchObject({ userId: "1784", host: "instagram" });
    expect(urls[0]).toMatch(/^https:\/\/graph\.instagram\.com\/v24\.0\/me\?/);
  });

  it("checks a Facebook token against the account id given from the dashboard", async () => {
    const { f, urls } = fake({ id: "17841446914255549", username: "donuts_club_krop" });
    expect(await accountApi("instagram", f).me("EAAtoken-0123456789", "17841446914255549")).toEqual({ userId: "17841446914255549", username: "donuts_club_krop", host: "facebook" });
    expect(urls[0]).toMatch(/^https:\/\/graph\.facebook\.com\/v24\.0\/17841446914255549\?fields=id%2Cusername/);
  });

  it("explains a Facebook token without an Instagram account", async () => {
    const { f } = fake({ data: [{ id: "page1" }] });
    await expect(accountApi("instagram", f).me("EAAtoken-0123456789")).rejects.toThrow();
  });
});
