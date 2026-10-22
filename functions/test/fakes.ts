import type { Deps } from "../src/loyalty.js";
import type { CreateClientInput, PosterApi, PosterClientRecord, PosterTransaction, PosterTransactionProduct } from "../src/poster/types.js";
import { walletConfig } from "../src/wallet/config.js";
import type { PushResult, WalletDeps } from "../src/wallet/service.js";
import type { WalletPass, WalletStore } from "../src/wallet/store.js";
import { canClaim, type CacheEntry, type Feedback, type LedgerEntry, type LedgerOutcome, type LedgerStatus, type Profile, type RateWindow, type Store } from "../src/store.js";

export function client(over: Partial<PosterClientRecord> = {}): PosterClientRecord {
  return {
    client_id: "7",
    firstname: "",
    lastname: "Олена",
    patronymic: "",
    discount_per: "0",
    bonus: "5320",
    total_payed_sum: "123450",
    phone: "+380 99 123 4567",
    phone_number: "380991234567",
    birthday: "0000-00-00",
    client_groups_id: "2",
    client_groups_name: "Нові клієнти бонуси",
    client_groups_discount: "1",
    loyalty_type: "1",
    delete: "0",
    ...over,
  };
}

export function tx(id: string, closeMs: number, over: Partial<PosterTransaction> = {}): PosterTransaction {
  return { transaction_id: id, date_close: String(closeMs), status: "2", client_id: "7", sum: "21000", payed_sum: "21000", payed_bonus: "0", ...over };
}

/** In-memory Poster whose getClients mimics the real prefix match. */
export class FakePoster implements PosterApi {
  clients: PosterClientRecord[] = [];
  transactions: PosterTransaction[] = [];
  calls: string[] = [];
  created: CreateClientInput[] = [];
  failCreateWith?: Error;
  bonusChanges: { clientId: number; amountUah: number }[] = [];
  failBonusWith?: Error;

  async findClientsByPhone(phone: string) {
    this.calls.push("getClients");
    const q = phone.replace(/\D/g, "");
    return this.clients.filter((c) => c.phone_number.startsWith(q) && c.delete !== "1");
  }
  async getClient(id: number) {
    this.calls.push("getClient");
    return this.clients.find((c) => c.client_id === String(id)) ?? null;
  }
  async createClient(input: CreateClientInput) {
    this.calls.push("createClient");
    if (this.failCreateWith) throw this.failCreateWith;
    this.created.push(input);
    const id = String(100 + this.created.length);
    this.clients.push(client({ client_id: id, lastname: input.client_name, phone_number: input.phone.replace(/\D/g, ""), card_number: input.card_number ?? "", bonus: "5000", total_payed_sum: "0" }));
    return Number(id);
  }
  cardNumberChanges: { clientId: number; cardNumber: string }[] = [];
  failCardNumberWith?: Error;
  async setClientCardNumber(clientId: number, cardNumber: string) {
    this.calls.push("updateClient");
    if (this.failCardNumberWith) throw this.failCardNumberWith;
    this.cardNumberChanges.push({ clientId, cardNumber });
    this.clients.find((x) => x.client_id === String(clientId))!.card_number = cardNumber;
  }
  async findClientsByBirthday(mmdd: string) {
    this.calls.push("getClientsByBirthday");
    return this.clients.filter((c) => c.birthday.slice(5).replace("-", "") === mmdd);
  }
  async changeClientBonus(clientId: number, amountUah: number): Promise<number> {
    this.calls.push("changeClientBonus");
    if (this.failBonusWith) throw this.failBonusWith;
    this.bonusChanges.push({ clientId, amountUah });
    const c = this.clients.find((x) => x.client_id === String(clientId))!;
    c.bonus = String(Number(c.bonus) + amountUah * 100);
    return Number(c.bonus) / 100;
  }
  async getTransactions() {
    this.calls.push("getAllTransactions");
    return this.transactions;
  }
  async getClientTransactions(id: number) {
    this.calls.push("getTransactions");
    return this.transactions.filter((t) => t.client_id === String(id));
  }
  products: Record<string, PosterTransactionProduct[]> = {};
  failProductsFor = new Set<string>();
  async getTransactionProducts(transactionId: string) {
    this.calls.push("getTransactionProducts");
    if (this.failProductsFor.has(transactionId)) throw new Error("boom");
    return this.products[transactionId] ?? [];
  }
}

export class MemoryStore implements Store {
  profiles = new Map<string, Profile>();
  cache = new Map<string, CacheEntry<unknown>>();
  windows = new Map<string, RateWindow>();
  rulesRaw: unknown = null;
  ledger = new Map<string, LedgerEntry & Omit<Partial<LedgerOutcome>, "status"> & { status: LedgerStatus; attempts: number }>();
  async getBonusRulesRaw() {
    return this.rulesRaw;
  }
  async claimLedger(key: string, entry: LedgerEntry) {
    const prev = this.ledger.get(key);
    if (!canClaim(prev?.status ?? null)) return false;
    this.ledger.set(key, { ...entry, status: "pending", attempts: (prev?.attempts ?? 0) + 1 });
    return true;
  }
  async finishLedger(key: string, o: LedgerOutcome) {
    this.ledger.set(key, { ...this.ledger.get(key)!, ...o });
  }
  async findUidByClientId(clientId: number) {
    for (const [uid, p] of this.profiles) if (p.posterClientId === clientId) return uid;
    return null;
  }
  async getProfile(uid: string) {
    return this.profiles.get(uid) ?? null;
  }
  async setProfile(uid: string, p: Profile) {
    this.profiles.set(uid, p);
  }
  async getCache<T>(uid: string) {
    return (this.cache.get(uid) as CacheEntry<T>) ?? null;
  }
  async setCache<T>(uid: string, data: T, now: Date) {
    this.cache.set(uid, { data, storedAt: now });
  }
  async clearCache(uid: string) {
    this.cache.delete(uid);
  }
  async hitRateLimit(key: string, step: (prev: RateWindow | null) => { allowed: boolean; next: RateWindow }) {
    const { allowed, next } = step(this.windows.get(key) ?? null);
    this.windows.set(key, next);
    return allowed;
  }
  feedback: (Feedback & { id: string })[] = [];
  async addFeedback(f: Feedback) {
    this.feedback.push({ ...f, id: `f${this.feedback.length + 1}` });
  }
  async listFeedback(limit: number) {
    return [...this.feedback].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime()).slice(0, limit);
  }
}

export function makeDeps(now = new Date("2026-09-29T10:00:00Z")) {
  const poster = new FakePoster();
  const store = new MemoryStore();
  const logs: { level: string; message: string; data: Record<string, unknown> }[] = [];
  const clock = { now };
  const deps: Deps = { poster, store, now: () => clock.now, log: (level, message, data) => logs.push({ level, message, data }) };
  return { deps, poster, store, logs, clock };
}

export class MemoryWalletStore implements WalletStore {
  passes = new Map<string, WalletPass>();
  downloads = new Map<string, { serial: string; expiresAt: Date }>();
  regs = new Map<string, { deviceId: string; serial: string; pushToken: string; updatedAt: Date }>();
  cursor: number | null = null;
  async getPass(serial: string) {
    return this.passes.get(serial) ?? null;
  }
  async getPassByClient(clientId: number) {
    return [...this.passes.values()].find((p) => p.clientId === clientId) ?? null;
  }
  async savePass(p: WalletPass) {
    this.passes.set(p.serial, p);
  }
  async listPasses() {
    return [...this.passes.values()];
  }
  async createDownload(token: string, serial: string, expiresAt: Date) {
    this.downloads.set(token, { serial, expiresAt });
  }
  async getDownload(token: string) {
    return this.downloads.get(token) ?? null;
  }
  async register(deviceId: string, serial: string, pushToken: string, now: Date) {
    const key = `${deviceId}_${serial}`;
    const existed = this.regs.has(key);
    this.regs.set(key, { deviceId, serial, pushToken, updatedAt: now });
    return !existed;
  }
  async unregister(deviceId: string, serial: string) {
    this.regs.delete(`${deviceId}_${serial}`);
  }
  async serialsForDevice(deviceId: string) {
    return [...this.regs.values()].filter((r) => r.deviceId === deviceId).map((r) => ({ serial: r.serial, updatedAt: this.passes.get(r.serial)!.updatedAt }));
  }
  async pushTokensFor(serial: string) {
    return [...this.regs.values()].filter((r) => r.serial === serial).map(({ deviceId, pushToken }) => ({ deviceId, pushToken }));
  }
  async forgetDevice(deviceId: string) {
    for (const [k, r] of this.regs) if (r.deviceId === deviceId) this.regs.delete(k);
  }
  async getSyncCursor() {
    return this.cursor;
  }
  async setSyncCursor(ms: number) {
    this.cursor = ms;
  }
}

export function makeWalletDeps(now = new Date("2026-10-22T10:00:00Z")) {
  const base = makeDeps(now);
  const wallet = new MemoryWalletStore();
  const pushed: string[][] = [];
  const pushResults: PushResult[] = [];
  const googleUpdates: WalletPass[] = [];
  const cfg = walletConfig({ APPLE_PASS_TYPE_ID: "pass.ua.donutsclub.card", APPLE_TEAM_ID: "TEAM123456", GOOGLE_WALLET_ISSUER_ID: "3388000000000000000" });
  const deps: WalletDeps = {
    ...base.deps,
    wallet,
    cfg,
    apple: {
      pkpass: (p) => Buffer.from(`pkpass:${p.serial}:${p.data.bonusUah}`),
      push: async (tokens) => {
        pushed.push(tokens);
        return tokens.map((_, i) => pushResults[i] ?? "sent");
      },
    },
    google: {
      saveUrl: async (p) => `https://pay.google.com/gp/v/save/jwt-${p.serial}`,
      update: async (p) => {
        googleUpdates.push(p);
        return true;
      },
    },
  };
  return { ...base, deps, wallet, pushed, pushResults, googleUpdates, cfg };
}
