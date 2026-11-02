import { createHmac, randomBytes, randomInt } from "node:crypto";
import { MSG, UserError } from "../errors.js";
import { pinGate, samePin, type FeedbackDeps } from "../feedback.js";
import { MetaError } from "./meta.js";
import { checkTexts, parsePlatforms, parseTime, PLATFORMS, SMSG, validatePost, type Accounts, type Platform, type PlatformResult, type Role, type SocialPost, type TeamMember } from "./model.js";
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
  createdBy?: string;
  editedBy?: string;
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
    ...(p.createdBy ? { createdBy: p.createdBy } : {}),
    ...(p.editedBy ? { editedBy: p.editedBy } : {}),
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

/** Who is calling: the owner (SOCIAL_PIN) or a team member with a personal PIN. */
export interface Who {
  id: string;
  name: string;
  role: Role;
}

const OWNER: Who = { id: "owner", name: "Власник", role: "admin" };
const TEAM_MAX = 30;

export const pinHash = (pin: string, ownerPin: string) => createHmac("sha256", ownerPin).update(pin).digest("hex");

async function resolve(given: string, ownerPin: string, deps: SocialActionDeps): Promise<Who | null> {
  if (!ownerPin) return null;
  if (samePin(given, ownerPin)) return OWNER;
  const h = pinHash(given, ownerPin);
  const m = (await deps.social.getTeam()).find((x) => x.pinHash === h);
  return m ? { id: m.id, name: m.name, role: m.role } : null;
}

const teamView = (t: TeamMember[]) => t.map((m) => ({ id: m.id, name: m.name, role: m.role, createdAt: m.createdAt.toISOString() }));

/** A fresh 6-digit PIN that is neither the owner's nor anyone else's. */
function newPin(team: TeamMember[], ownerPin: string): { pin: string; hash: string } {
  for (;;) {
    const pin = String(randomInt(100_000, 1_000_000));
    const hash = pinHash(pin, ownerPin);
    if (pin !== ownerPin && !team.some((m) => m.pinHash === hash)) return { pin, hash };
  }
}

const ADMIN_ACTIONS = new Set(["connect", "disconnect", "team", "addMember", "removeMember", "resetPin"]);
const WRITE_ACTIONS = new Set(["upload", "create", "update", "now", "remove"]);

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
 * The «Donuts Post» app's single callable. Everyone signs in with a personal PIN; the owner's is SOCIAL_PIN.
 * login | posts (everyone) · upload | create | update | remove | now (editors) ·
 * connect | disconnect | team | addMember | removeMember | resetPin (owner and admins).
 */
export async function socialAction(raw: unknown, ip: string, pin: string, deps: SocialActionDeps): Promise<unknown> {
  const r = (raw ?? {}) as Record<string, unknown>;
  const me = await pinGate("socialFail", r.pin, (g) => resolve(g, pin, deps), ip, deps);
  const action = String(r.action);
  if (ADMIN_ACTIONS.has(action) && me.role !== "admin") throw new UserError("permission-denied", SMSG.adminOnly);
  if (WRITE_ACTIONS.has(action) && me.role === "viewer") throw new UserError("permission-denied", SMSG.viewerOnly);
  const now = deps.now();

  switch (action) {
    case "login":
      return { ok: true, me: { name: me.name, role: me.role }, accounts: accountsView(await deps.social.getAccounts()) };

    case "posts": {
      const list = await deps.social.listPosts(LIST_LIMIT);
      return { items: list.map((p) => view(p.id, p)), me: { name: me.name, role: me.role }, accounts: accountsView(await deps.social.getAccounts()) };
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
      const post: SocialPost = { ...input, status: "scheduled", results: {}, createdAt: now, updatedAt: now, createdBy: me.name };
      const id = await deps.social.addPost(post);
      deps.log("info", "social: scheduled", { id, by: me.name, kind: input.kind, platforms: input.platforms, at: input.scheduledAt.toISOString() });
      return { id };
    }

    /** Texts, time and (while nothing has gone out yet) platforms. */
    case "update": {
      const id = str(r.id);
      if (!id) throw new UserError("not-found", SMSG.noPost);
      const accounts = await deps.social.getAccounts();
      const saved = await deps.social.mutatePost(id, (cur) => {
        const p = editable(cur);
        const next: SocialPost = { ...p, updatedAt: now, editedBy: me.name };
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
        return { ...p, scheduledAt: now, status: "scheduled", results: resetFailed(p), updatedAt: now, editedBy: me.name };
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
      deps.log("info", "social: removed", { id, by: me.name });
      if (media.length) await deps.media.remove(media).catch((e) => deps.log("warn", "social: media cleanup failed", { id, error: String(e) }));
      return { ok: true };
    }

    /** Stores a long-lived token generated in the Meta developer dashboard. */
    case "connect": {
      const platform = r.platform as Platform;
      if (!PLATFORMS.includes(platform)) throw bad(SMSG.badPlatforms);
      const token = typeof r.token === "string" ? r.token.trim() : "";
      if (!TOKEN_RE.test(token)) throw bad(SMSG.badToken);
      const accountId = typeof r.accountId === "string" && /^\d{5,25}$/.test(r.accountId.trim()) ? r.accountId.trim() : undefined;
      let me: { userId: string; username: string; host?: "instagram" | "facebook" };
      try {
        me = await deps.accountApi(platform).me(token, accountId);
      } catch (e) {
        deps.log("warn", "social: token rejected", { platform, error: e instanceof MetaError ? e.message : "unknown" });
        throw new UserError("failed-precondition", e instanceof MetaError && !accountId && token.startsWith("EAA") ? SMSG.needAccountId : SMSG.badToken);
      }
      await deps.social.setAccount(platform, { token, userId: me.userId, username: me.username, ...(me.host ? { host: me.host } : {}), connectedAt: now, refreshedAt: now });
      deps.log("info", "social: account connected", { platform, username: me.username });
      return { ok: true, accounts: accountsView(await deps.social.getAccounts()) };
    }

    case "disconnect": {
      const platform = r.platform as Platform;
      if (!PLATFORMS.includes(platform)) throw bad(SMSG.badPlatforms);
      await deps.social.setAccount(platform, null);
      return { ok: true, accounts: accountsView(await deps.social.getAccounts()) };
    }

    case "team":
      return { members: teamView(await deps.social.getTeam()) };

    /** Creates a member with a fresh PIN; the PIN is shown once and only its HMAC is stored. */
    case "addMember": {
      const name = typeof r.name === "string" ? r.name.trim().replace(/\s+/g, " ") : "";
      const role = r.role as Role;
      // Accounts and the team stay with the owner.
      if (role !== "editor" && role !== "viewer") throw bad(SMSG.badRole);
      let pinOut = "";
      const team = await deps.social.mutateTeam((t) => {
        const taken = [OWNER.name, ...t.map((m) => m.name)].some((n) => n.toLowerCase() === name.toLowerCase());
        if (!name || name.length > 40 || taken) throw bad(SMSG.badMemberName);
        if (t.length >= TEAM_MAX) throw new UserError("failed-precondition", SMSG.teamFull);
        const { pin: fresh, hash } = newPin(t, pin);
        pinOut = fresh;
        return [...t, { id: randomBytes(6).toString("hex"), name, role, pinHash: hash, createdAt: now }];
      });
      deps.log("info", "social: member added", { name, role, by: me.name });
      return { members: teamView(team), pin: pinOut };
    }

    case "resetPin": {
      const id = str(r.id);
      let pinOut = "";
      const team = await deps.social.mutateTeam((t) => {
        const m = t.find((x) => x.id === id);
        if (!m) throw new UserError("not-found", SMSG.noMember);
        const { pin: fresh, hash } = newPin(t, pin);
        pinOut = fresh;
        return t.map((x) => (x.id === id ? { ...x, pinHash: hash } : x));
      });
      deps.log("info", "social: member pin reset", { id, by: me.name });
      return { members: teamView(team), pin: pinOut };
    }

    case "removeMember": {
      const id = str(r.id);
      const team = await deps.social.mutateTeam((t) => {
        if (!t.some((x) => x.id === id)) throw new UserError("not-found", SMSG.noMember);
        return t.filter((x) => x.id !== id);
      });
      deps.log("info", "social: member removed", { id, by: me.name });
      return { members: teamView(team) };
    }

    default:
      throw bad(MSG.badAction);
  }
}
