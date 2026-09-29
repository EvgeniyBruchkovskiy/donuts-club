import type { Deps } from "../src/loyalty.js";
import type { CreateClientInput, PosterApi, PosterClientRecord, PosterTransaction } from "../src/poster/types.js";
import type { CacheEntry, Profile, RateWindow, Store } from "../src/store.js";

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
    this.clients.push(client({ client_id: id, lastname: input.client_name, phone_number: input.phone.replace(/\D/g, ""), bonus: "5000", total_payed_sum: "0" }));
    return Number(id);
  }
  async changeClientBonus(): Promise<number> {
    throw new Error("not used");
  }
  async getClientTransactions(id: number) {
    this.calls.push("getTransactions");
    return this.transactions.filter((t) => t.client_id === String(id));
  }
}

export class MemoryStore implements Store {
  profiles = new Map<string, Profile>();
  cache = new Map<string, CacheEntry<unknown>>();
  windows = new Map<string, RateWindow>();
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
}

export function makeDeps(now = new Date("2026-09-29T10:00:00Z")) {
  const poster = new FakePoster();
  const store = new MemoryStore();
  const logs: { level: string; message: string; data: Record<string, unknown> }[] = [];
  const clock = { now };
  const deps: Deps = { poster, store, now: () => clock.now, log: (level, message, data) => logs.push({ level, message, data }) };
  return { deps, poster, store, logs, clock };
}
