/** Server-side state (Firestore in prod, in-memory in tests). Clients never access it directly. */
export interface Profile {
  posterClientId: number;
  /** "created" — registered via the site; "linked" — matched an existing Poster client. */
  source: "created" | "linked";
  createdAt: Date;
}

export interface CacheEntry<T> {
  data: T;
  storedAt: Date;
}

export interface RateWindow {
  windowStart: number;
  count: number;
}

export interface Store {
  getProfile(uid: string): Promise<Profile | null>;
  setProfile(uid: string, profile: Profile): Promise<void>;
  getCache<T>(uid: string): Promise<CacheEntry<T> | null>;
  setCache<T>(uid: string, data: T, now: Date): Promise<void>;
  clearCache(uid: string): Promise<void>;
  /** Atomically applies `step` to the stored window; returns whether the call is allowed. */
  hitRateLimit(key: string, step: (prev: RateWindow | null) => { allowed: boolean; next: RateWindow }): Promise<boolean>;
}

/** Fixed-window limiter step (pure — unit tested). */
export function rateStep(prev: RateWindow | null, nowMs: number, limit: number, windowMs: number) {
  const fresh = !prev || nowMs - prev.windowStart >= windowMs;
  const next: RateWindow = fresh ? { windowStart: nowMs, count: 1 } : { windowStart: prev.windowStart, count: prev.count + 1 };
  return { allowed: next.count <= limit, next };
}
