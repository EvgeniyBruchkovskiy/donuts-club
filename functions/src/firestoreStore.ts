import { Timestamp, type Firestore } from "firebase-admin/firestore";
import type { CacheEntry, Profile, RateWindow, Store } from "./store.js";

// Collections (all closed to clients by firestore.rules; Admin SDK bypasses rules):
//   profiles/{uid}          uid → Poster client_id
//   loyaltyCache/{uid}      last getMyLoyalty result, 60 s TTL
//   rateLimits/{kind:uid}   fixed-window counters
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

  async hitRateLimit(key: string, step: (prev: RateWindow | null) => { allowed: boolean; next: RateWindow }): Promise<boolean> {
    const ref = this.db.doc(`rateLimits/${key}`);
    return this.db.runTransaction(async (tx) => {
      const s = await tx.get(ref);
      const { allowed, next } = step(s.exists ? (s.data() as RateWindow) : null);
      tx.set(ref, next);
      return allowed;
    });
  }
}
