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

export interface LedgerEntry {
  uid: string;
  clientId: number;
  rule: "welcome" | "birthday";
  period: string;
  amountUah: number;
  createdAt: Date;
}

export interface LedgerOutcome {
  status: "done" | "failed" | "uncertain";
  finishedAt: Date;
  newBalanceUah?: number;
  error?: string;
}

export type LedgerStatus = "pending" | LedgerOutcome["status"];

/** A guest review from /feedback. `phone` is the digits-only 380… form (not verified by SMS). */
export interface Feedback {
  clean: number;
  staff: number;
  comment: string;
  name?: string;
  phone?: string;
  createdAt: Date;
}

export interface Store {
  getProfile(uid: string): Promise<Profile | null>;
  setProfile(uid: string, profile: Profile): Promise<void>;
  getCache<T>(uid: string): Promise<CacheEntry<T> | null>;
  setCache<T>(uid: string, data: T, now: Date): Promise<void>;
  clearCache(uid: string): Promise<void>;
  /** Raw `config/bonusRules` document (validated by parseRules). */
  getBonusRulesRaw(): Promise<unknown>;
  /** Creates `bonusLedger/{key}` as "pending" unless it exists (a "failed" entry may be re-claimed). */
  claimLedger(key: string, entry: LedgerEntry): Promise<boolean>;
  finishLedger(key: string, outcome: LedgerOutcome): Promise<void>;
  /** uid of the site user linked to a Poster client, if any. */
  findUidByClientId(clientId: number): Promise<string | null>;
  /** Atomically applies `step` to the stored window; returns whether the call is allowed. */
  hitRateLimit(key: string, step: (prev: RateWindow | null) => { allowed: boolean; next: RateWindow }): Promise<boolean>;
  addFeedback(f: Feedback): Promise<void>;
  /** Newest first. */
  listFeedback(limit: number): Promise<(Feedback & { id: string })[]>;
}

/** Fixed-window limiter step (pure — unit tested). */
export function rateStep(prev: RateWindow | null, nowMs: number, limit: number, windowMs: number) {
  const fresh = !prev || nowMs - prev.windowStart >= windowMs;
  const next: RateWindow = fresh ? { windowStart: nowMs, count: 1 } : { windowStart: prev.windowStart, count: prev.count + 1 };
  return { allowed: next.count <= limit, next };
}

/** Pure decision for claimLedger (unit tested): only a missing or "failed" entry can be claimed. */
export function canClaim(existing: LedgerStatus | null): boolean {
  return existing === null || existing === "failed";
}
