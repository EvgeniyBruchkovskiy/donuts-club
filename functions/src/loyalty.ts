import { UserError, MSG } from "./errors.js";
import { maskPhone } from "./phone.js";
import type { PosterApi, PosterClientRecord, PosterTransaction, PosterTransactionProduct } from "./poster/types.js";
import { maybeWelcome } from "./bonus/welcome.js";
import { rateStep, type Profile, type Store } from "./store.js";

export const CACHE_TTL_MS = 60_000;
export const HISTORY_DAYS = 365;
/** Transactions are fetched from here so the lifetime total can include bonus payments. */
export const ALL_TIME_FROM = "20180101";
export const HISTORY_LIMIT = 10;
export const RATE = { loyalty: { limit: 20, windowMs: 60_000 }, register: { limit: 5, windowMs: 3_600_000 } };

export interface PurchaseItem {
  name: string;
  /** Dish modifiers as Poster prints them, "" when none. */
  modifiers: string;
  qty: number;
  /** true → qty is kilograms. */
  byWeight: boolean;
}

export interface Purchase {
  id: string;
  closedAt: string; // ISO
  totalUah: number;
  paidWithBonusUah: number;
  /**
   * A fiscal return was printed but the check was never returned in Poster itself, so it still counts
   * there as a sale. Shown as "Повернення" and left out of the totals.
   */
  returned?: true;
  /** Missing when Poster couldn't return the check lines — the purchase is still listed. */
  items?: PurchaseItem[];
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
  /** Poster's total_payed_sum: money only, bonus payments excluded. Drives the 3% level progress. */
  totalPaidUah: number;
  /** Lifetime total shown in the cabinet: money plus bonus payments. */
  totalWithBonusUah: number;
  /** Encoded in the cabinet QR — the till's scanner looks clients up by card number, not phone. */
  cardNumber: string;
  purchases: Purchase[];
}

export type LoyaltyResult = Loyalty | { exists: false };

export interface Deps {
  poster: PosterApi;
  store: Store;
  now: () => Date;
  log: (level: "info" | "warn" | "error", message: string, data: Record<string, unknown>) => void;
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
    ...(isReturned(t) && { returned: true as const }),
  };
}

export const isReturned = (t: PosterTransaction) => t.print_fiscal === "2";

export function toItem(p: PosterTransactionProduct): PurchaseItem {
  return {
    name: p.product_name.trim(),
    modifiers: (p.modificator_name ?? "").trim(),
    qty: Number(p.num) || 0,
    byWeight: p.weight_flag === "1",
  };
}

/** Check lines for the listed purchases, fetched in parallel. A failed check keeps its purchase, just without items. */
export async function withItems(purchases: Purchase[], deps: Pick<Deps, "poster" | "log">): Promise<Purchase[]> {
  return Promise.all(
    purchases.map(async (p) => {
      try {
        return { ...p, items: (await deps.poster.getTransactionProducts(p.id)).map(toItem) };
      } catch (err) {
        deps.log("warn", "transaction products failed", { transactionId: p.id, error: err instanceof Error ? err.name : "unknown" });
        return p;
      }
    }),
  );
}

/** `historyFromMs`: purchases closed before it are left out of the list but still count in the total. */
export function toLoyalty(c: PosterClientRecord, tx: PosterTransaction[], historyFromMs: number): Loyalty {
  const closed = tx.filter((t) => t.client_id === c.client_id && t.status === "2");
  const returned = closed.filter(isReturned);
  const paid = kop(c.total_payed_sum) - returned.reduce((sum, t) => sum + kop(t.payed_sum), 0);
  const paidWithBonus = closed.filter((t) => !isReturned(t)).reduce((sum, t) => sum + kop(t.payed_bonus), 0);
  return {
    exists: true,
    clientId: Number(c.client_id),
    name: [c.firstname, c.lastname].map((s) => (s ?? "").trim()).filter(Boolean).join(" "),
    bonusUah: uah(kop(c.bonus)),
    program: c.loyalty_type === "2" ? "discount" : "bonus",
    percent: Math.max(Number(c.discount_per) || 0, Number(c.client_groups_discount) || 0),
    groupName: c.client_groups_name ?? "",
    totalPaidUah: uah(Math.max(0, paid)),
    totalWithBonusUah: uah(Math.max(0, paid) + paidWithBonus),
    cardNumber: c.card_number?.trim() || c.phone_number,
    purchases: closed
      .filter((t) => Number(t.date_close) >= historyFromMs)
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
export async function resolveClient(uid: string, digits: string, deps: Deps): Promise<{ client: PosterClientRecord | null; profile: Profile | null }> {
  const profile = await deps.store.getProfile(uid);
  if (profile) {
    const c = await deps.poster.getClient(profile.posterClientId);
    if (c && c.phone_number === digits && c.delete !== "1") return { client: c, profile };
    deps.log("warn", "stored poster link is stale", { clientId: profile.posterClientId });
  }
  return { client: await findClientByPhone(deps.poster, digits, deps), profile };
}

/**
 * The till finds a client by scanning their card number, so a client without one can't be
 * picked by the cabinet QR. Give them their phone digits as the card number; never overwrite a real card.
 */
export async function ensureCardNumber(client: PosterClientRecord, deps: Pick<Deps, "poster" | "log">): Promise<PosterClientRecord> {
  if (client.card_number?.trim()) return client;
  try {
    await deps.poster.setClientCardNumber(Number(client.client_id), client.phone_number);
    return { ...client, card_number: client.phone_number };
  } catch (err) {
    deps.log("error", "set card number failed", { clientId: client.client_id, error: err instanceof Error ? err.name : "unknown" });
    return client;
  }
}

/** Bonus rules must never break the cabinet: failures are logged, the page still loads. */
export async function safeWelcome(uid: string, clientId: number, source: Profile["source"], deps: Deps): Promise<boolean> {
  try {
    return (await maybeWelcome(uid, clientId, source, deps)) === "awarded";
  } catch (err) {
    deps.log("error", "welcome bonus failed", { clientId, error: err instanceof Error ? err.name : "unknown" });
    return false;
  }
}

export async function getMyLoyalty(uid: string, digits: string, deps: Deps): Promise<LoyaltyResult> {
  const now = deps.now();
  await enforceRate(deps.store, uid, "loyalty", now);

  const cached = await deps.store.getCache<LoyaltyResult>(uid);
  if (cached && now.getTime() - cached.storedAt.getTime() < CACHE_TTL_MS) return cached.data;

  const resolved = await resolveClient(uid, digits, deps);
  let client = resolved.client;
  const profile = resolved.profile;
  let result: LoyaltyResult = { exists: false };
  if (client) {
    const clientId = Number(client.client_id);
    if (!profile || profile.posterClientId !== clientId) {
      // First login of an existing Poster client (or a re-link): remember uid → client_id.
      await deps.store.setProfile(uid, { posterClientId: clientId, source: profile?.source ?? "linked", createdAt: profile?.createdAt ?? now });
      if (!profile && (await safeWelcome(uid, clientId, "linked", deps))) client = (await deps.poster.getClient(clientId)) ?? client;
    }
    client = await ensureCardNumber(client, deps);
    const tx = await deps.poster.getClientTransactions(Number(client.client_id), ALL_TIME_FROM, kyivYmd(now));
    const loyalty = toLoyalty(client, tx, now.getTime() - HISTORY_DAYS * 86_400_000);
    result = { ...loyalty, purchases: await withItems(loyalty.purchases, deps) };
  }
  await deps.store.setCache(uid, result, now);
  return result;
}
