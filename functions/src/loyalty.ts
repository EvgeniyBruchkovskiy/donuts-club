import { UserError, MSG } from "./errors.js";
import { maskPhone } from "./phone.js";
import type { PosterApi, PosterClientRecord, PosterTransaction } from "./poster/types.js";
import { rateStep, type Store } from "./store.js";

export const CACHE_TTL_MS = 60_000;
export const HISTORY_DAYS = 90;
export const HISTORY_LIMIT = 10;
export const RATE = { loyalty: { limit: 20, windowMs: 60_000 }, register: { limit: 5, windowMs: 3_600_000 } };

export interface Purchase {
  id: string;
  closedAt: string; // ISO
  totalUah: number;
  paidWithBonusUah: number;
}

export interface Loyalty {
  exists: true;
  clientId: number;
  name: string;
  bonusUah: number;
  program: "bonus" | "discount";
  /** Effective percent: max(personal, group). Bonus accrual % for "bonus", discount % for "discount". */
  percent: number;
  groupName: string;
  totalPaidUah: number;
  purchases: Purchase[];
}

export type LoyaltyResult = Loyalty | { exists: false };

export interface Deps {
  poster: PosterApi;
  store: Store;
  now: () => Date;
  log: (level: "info" | "warn", message: string, data: Record<string, unknown>) => void;
}

const kop = (v: string | undefined) => Number(v ?? 0) || 0;
const uah = (kopecks: number) => Math.round(kopecks) / 100;

/** Poster's phone filter is a prefix match — keep only exact, non-deleted matches. */
export async function findClientByPhone(poster: PosterApi, digits: string, deps: Pick<Deps, "log">) {
  const exact = (await poster.findClientsByPhone("+" + digits)).filter((c) => c.phone_number === digits && c.delete !== "1");
  if (exact.length > 1) deps.log("warn", "several poster clients share a phone", { phone: maskPhone(digits), count: exact.length });
  return exact.sort((a, b) => Number(a.client_id) - Number(b.client_id))[0] ?? null;
}

/** Ymd in Kyiv time — Poster's dateFrom/dateTo format. */
export function kyivYmd(d: Date): string {
  const p = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Kyiv", year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
  return p.replaceAll("-", "");
}

export function toPurchase(t: PosterTransaction): Purchase {
  const paid = kop(t.payed_sum) + kop(t.payed_bonus) + kop(t.payed_cert) + kop(t.payed_ewallet) + kop(t.payed_third_party);
  return {
    id: t.transaction_id,
    closedAt: new Date(Number(t.date_close)).toISOString(),
    totalUah: uah(paid),
    paidWithBonusUah: uah(kop(t.payed_bonus)),
  };
}

export function toLoyalty(c: PosterClientRecord, tx: PosterTransaction[]): Loyalty {
  return {
    exists: true,
    clientId: Number(c.client_id),
    name: [c.firstname, c.lastname].map((s) => (s ?? "").trim()).filter(Boolean).join(" "),
    bonusUah: uah(kop(c.bonus)),
    program: c.loyalty_type === "2" ? "discount" : "bonus",
    percent: Math.max(Number(c.discount_per) || 0, Number(c.client_groups_discount) || 0),
    groupName: c.client_groups_name ?? "",
    totalPaidUah: uah(kop(c.total_payed_sum)),
    purchases: tx
      .filter((t) => t.client_id === c.client_id && t.status === "2")
      .sort((a, b) => Number(b.date_close) - Number(a.date_close))
      .slice(0, HISTORY_LIMIT)
      .map(toPurchase),
  };
}

export async function enforceRate(store: Store, uid: string, kind: keyof typeof RATE, now: Date) {
  const { limit, windowMs } = RATE[kind];
  const ok = await store.hitRateLimit(`${kind}:${uid}`, (prev) => rateStep(prev, now.getTime(), limit, windowMs));
  if (!ok) throw new UserError("resource-exhausted", MSG.tooManyRequests);
}

/** Resolves the Poster client for a verified phone: stored link first (re-checked), then search. */
export async function resolveClient(uid: string, digits: string, deps: Deps): Promise<PosterClientRecord | null> {
  const profile = await deps.store.getProfile(uid);
  if (profile) {
    const c = await deps.poster.getClient(profile.posterClientId);
    if (c && c.phone_number === digits && c.delete !== "1") return c;
    deps.log("warn", "stored poster link is stale", { clientId: profile.posterClientId });
  }
  return findClientByPhone(deps.poster, digits, deps);
}

export async function getMyLoyalty(uid: string, digits: string, deps: Deps): Promise<LoyaltyResult> {
  const now = deps.now();
  await enforceRate(deps.store, uid, "loyalty", now);

  const cached = await deps.store.getCache<LoyaltyResult>(uid);
  if (cached && now.getTime() - cached.storedAt.getTime() < CACHE_TTL_MS) return cached.data;

  const client = await resolveClient(uid, digits, deps);
  let result: LoyaltyResult = { exists: false };
  if (client) {
    const from = kyivYmd(new Date(now.getTime() - HISTORY_DAYS * 86_400_000));
    const tx = await deps.poster.getClientTransactions(Number(client.client_id), from, kyivYmd(now));
    result = toLoyalty(client, tx);
  }
  await deps.store.setCache(uid, result, now);
  return result;
}
