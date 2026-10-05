import { Timestamp, type Firestore } from "firebase-admin/firestore";
import { canClaim, type CacheEntry, type Feedback, type LedgerEntry, type LedgerOutcome, type LedgerStatus, type Profile, type RateWindow, type Store } from "./store.js";

// Collections (all closed to clients by firestore.rules; Admin SDK bypasses rules):
//   profiles/{uid}          uid → Poster client_id
//   loyaltyCache/{uid}      last getMyLoyalty result, 60 s TTL
//   rateLimits/{kind:uid}   fixed-window counters
//   config/bonusRules       bonus rules (owner edits in the console; disabled by default)
//   bonusLedger/{uid_rule_period}  one entry per accrual — the idempotency journal
//   feedback/{auto}         guest reviews from /feedback
export class FirestoreStore implements Store {
  constructor(private readonly db: Firestore) {}

  async getProfile(uid: string): Promise<Profile | null> {
    const s = await this.db.doc(`profiles/${uid}`).get();
    if (!s.exists) return null;
    const d = s.data()!;
    return { posterClientId: d.posterClientId, source: d.source, createdAt: (d.createdAt as Timestamp).toDate() };
  }

  async setProfile(uid: string, p: Profile): Promise<void> {
    await this.db.doc(`profiles/${uid}`).set({ ...p, createdAt: Timestamp.fromDate(p.createdAt) }, { merge: true });
  }

  async getCache<T>(uid: string): Promise<CacheEntry<T> | null> {
    const s = await this.db.doc(`loyaltyCache/${uid}`).get();
    if (!s.exists) return null;
    const d = s.data()!;
    return { data: JSON.parse(d.json) as T, storedAt: (d.storedAt as Timestamp).toDate() };
  }

  async setCache<T>(uid: string, data: T, now: Date): Promise<void> {
    await this.db.doc(`loyaltyCache/${uid}`).set({ json: JSON.stringify(data), storedAt: Timestamp.fromDate(now) });
  }

  async clearCache(uid: string): Promise<void> {
    await this.db.doc(`loyaltyCache/${uid}`).delete();
  }

  async getBonusRulesRaw(): Promise<unknown> {
    const s = await this.db.doc("config/bonusRules").get();
    return s.exists ? s.data() : null;
  }

  async claimLedger(key: string, entry: LedgerEntry): Promise<boolean> {
    const ref = this.db.doc(`bonusLedger/${key}`);
    return this.db.runTransaction(async (tx) => {
      const s = await tx.get(ref);
      const status = s.exists ? (s.get("status") as LedgerStatus) : null;
      if (!canClaim(status)) return false;
      tx.set(ref, { ...entry, createdAt: Timestamp.fromDate(entry.createdAt), status: "pending", attempts: (s.exists ? Number(s.get("attempts")) || 1 : 0) + 1 });
      return true;
    });
  }

  async finishLedger(key: string, o: LedgerOutcome): Promise<void> {
    await this.db.doc(`bonusLedger/${key}`).set({ ...o, finishedAt: Timestamp.fromDate(o.finishedAt) }, { merge: true });
  }

  async findUidByClientId(clientId: number): Promise<string | null> {
    const q = await this.db.collection("profiles").where("posterClientId", "==", clientId).limit(1).get();
    return q.empty ? null : q.docs[0].id;
  }

  async hitRateLimit(key: string, step: (prev: RateWindow | null) => { allowed: boolean; next: RateWindow }): Promise<boolean> {
    const ref = this.db.doc(`rateLimits/${key}`);
    return this.db.runTransaction(async (tx) => {
      const s = await tx.get(ref);
      const { allowed, next } = step(s.exists ? (s.data() as RateWindow) : null);
      tx.set(ref, next);
      return allowed;
    });
  }

  async addFeedback(f: Feedback): Promise<void> {
    await this.db.collection("feedback").add({ ...f, createdAt: Timestamp.fromDate(f.createdAt) });
  }

  async listFeedback(limit: number): Promise<(Feedback & { id: string })[]> {
    const q = await this.db.collection("feedback").orderBy("createdAt", "desc").limit(limit).get();
    return q.docs.map((d) => ({ ...(d.data() as Feedback), id: d.id, createdAt: (d.get("createdAt") as Timestamp).toDate() }));
  }
}
