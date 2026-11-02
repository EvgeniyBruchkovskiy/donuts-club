import { Timestamp, type DocumentData, type Firestore } from "firebase-admin/firestore";
import type { getStorage } from "firebase-admin/storage";
import { PLATFORMS, type Accounts, type Platform, type PlatformResult, type SocialAccount, type SocialPost, type TeamMember } from "./model.js";
import type { MediaStore, SocialStore } from "./publisher.js";

type Bucket = ReturnType<ReturnType<typeof getStorage>["bucket"]>;

// Collections (closed to clients by firestore.rules):
//   socialPosts/{auto}      scheduled posts; `dueAt` is set only while a tick should look at the post,
//                           so the every-minute query reads just those
//   socialConfig/accounts   Instagram and Threads access tokens
//   socialConfig/team       { members: TeamMember[] } — personal PINs (as HMACs) and roles

const toDate = (v: unknown) => (v instanceof Timestamp ? v.toDate() : undefined);

/** Firestore rejects undefined; Dates become Timestamps. */
function encode(v: unknown): unknown {
  if (v instanceof Date) return Timestamp.fromDate(v);
  if (Array.isArray(v)) return v.map(encode);
  if (v && typeof v === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, x] of Object.entries(v)) if (x !== undefined) out[k] = encode(x);
    return out;
  }
  return v;
}

function dueAt(p: SocialPost): Date | undefined {
  if (p.status === "scheduled") return p.scheduledAt;
  if (p.status === "publishing") return p.leaseUntil ?? p.scheduledAt;
  return undefined;
}

function decodeResult(d: DocumentData | undefined): PlatformResult | undefined {
  if (!d) return undefined;
  const { startedAt, ...rest } = d;
  return { ...(rest as PlatformResult), ...(toDate(startedAt) ? { startedAt: toDate(startedAt) } : {}) };
}

function decodePost(d: DocumentData): SocialPost {
  const results: SocialPost["results"] = {};
  for (const p of PLATFORMS) {
    const r = decodeResult(d.results?.[p]);
    if (r) results[p] = r;
  }
  const { dueAt: _due, scheduledAt, leaseUntil, createdAt, updatedAt, publishedAt, ...rest } = d;
  void _due;
  return {
    ...(rest as SocialPost),
    results,
    scheduledAt: toDate(scheduledAt)!,
    createdAt: toDate(createdAt)!,
    updatedAt: toDate(updatedAt)!,
    ...(toDate(leaseUntil) ? { leaseUntil: toDate(leaseUntil) } : {}),
    ...(toDate(publishedAt) ? { publishedAt: toDate(publishedAt) } : {}),
  };
}

function decodeTeam(d: DocumentData | undefined): TeamMember[] {
  return ((d?.members as DocumentData[] | undefined) ?? []).map((m) => ({ ...(m as TeamMember), createdAt: toDate(m.createdAt)! }));
}

function encodePost(p: SocialPost): DocumentData {
  return encode({ ...p, dueAt: dueAt(p) }) as DocumentData;
}

export class FirestoreSocialStore implements SocialStore {
  constructor(private readonly db: Firestore) {}

  async getAccounts(): Promise<Accounts> {
    const s = await this.db.doc("socialConfig/accounts").get();
    const out: Accounts = {};
    for (const p of PLATFORMS) {
      const a = s.get(p) as DocumentData | undefined;
      if (!a) continue;
      out[p] = {
        ...(a as SocialAccount),
        connectedAt: toDate(a.connectedAt)!,
        refreshedAt: toDate(a.refreshedAt)!,
        ...(toDate(a.expiresAt) ? { expiresAt: toDate(a.expiresAt) } : {}),
      };
    }
    return out;
  }

  async setAccount(p: Platform, a: SocialAccount | null): Promise<void> {
    const ref = this.db.doc("socialConfig/accounts");
    await this.db.runTransaction(async (tx) => {
      const s = await tx.get(ref);
      const data = { ...(s.data() ?? {}) };
      if (a) data[p] = encode(a);
      else delete data[p];
      tx.set(ref, data);
    });
  }

  async getTeam(): Promise<TeamMember[]> {
    return decodeTeam((await this.db.doc("socialConfig/team").get()).data());
  }

  async mutateTeam(fn: (t: TeamMember[]) => TeamMember[]): Promise<TeamMember[]> {
    const ref = this.db.doc("socialConfig/team");
    return this.db.runTransaction(async (tx) => {
      const next = fn(decodeTeam((await tx.get(ref)).data()));
      tx.set(ref, { members: encode(next) });
      return next;
    });
  }

  async listPosts(limit: number) {
    const q = await this.db.collection("socialPosts").orderBy("scheduledAt", "desc").limit(limit).get();
    return q.docs.map((d) => ({ ...decodePost(d.data()), id: d.id }));
  }

  async listDue(now: Date) {
    const q = await this.db.collection("socialPosts").where("dueAt", "<=", Timestamp.fromDate(now)).limit(20).get();
    return q.docs.map((d) => ({ ...decodePost(d.data()), id: d.id }));
  }

  async addPost(p: SocialPost): Promise<string> {
    const ref = await this.db.collection("socialPosts").add(encodePost(p));
    return ref.id;
  }

  async savePost(id: string, p: SocialPost): Promise<void> {
    await this.db.doc(`socialPosts/${id}`).set(encodePost(p));
  }

  async mutatePost(id: string, fn: (p: SocialPost | null) => SocialPost | "delete" | null): Promise<SocialPost | null> {
    const ref = this.db.doc(`socialPosts/${id}`);
    return this.db.runTransaction(async (tx) => {
      const s = await tx.get(ref);
      const next = fn(s.exists ? decodePost(s.data()!) : null);
      if (next === null) return null;
      if (next === "delete") {
        tx.delete(ref);
        return null;
      }
      tx.set(ref, encodePost(next));
      return next;
    });
  }
}

/** Media live in a private bucket; Meta and the app reach them only through short-lived signed links. */
export class BucketMediaStore implements MediaStore {
  constructor(private readonly bucket: Bucket) {}

  async uploadUrl(path: string, contentType: string, ttlMs: number): Promise<string> {
    const [url] = await this.bucket.file(path).getSignedUrl({ version: "v4", action: "write", contentType, expires: Date.now() + ttlMs });
    return url;
  }

  async readUrl(path: string, ttlMs: number): Promise<string> {
    const [url] = await this.bucket.file(path).getSignedUrl({ version: "v4", action: "read", expires: Date.now() + ttlMs });
    return url;
  }

  async exists(path: string): Promise<boolean> {
    const [ok] = await this.bucket.file(path).exists();
    return ok;
  }

  async remove(paths: string[]): Promise<void> {
    await Promise.all(paths.map((p) => this.bucket.file(p).delete({ ignoreNotFound: true })));
  }
}
