import { randomBytes } from "node:crypto";
import { MSG, UserError } from "../errors.js";
import { ensureCardNumber, enforceRate, kyivYmd, resolveClient, type Deps } from "../loyalty.js";
import type { PosterClientRecord } from "../poster/types.js";
import type { WalletConfig } from "./config.js";
import { sameCard, toPassData } from "./passData.js";
import type { WalletPass, WalletStore } from "./store.js";

export type PushResult = "sent" | "gone" | "failed";

/** Apple side, built in index.ts from the certificate secrets (fakes in tests). */
export interface AppleBackend {
  pkpass(p: WalletPass): Uint8Array;
  push(pushTokens: string[]): Promise<PushResult[]>;
}

/** Google side, built in index.ts from the service account secret. */
export interface GoogleBackend {
  /** Creates the class if needed and returns the "Add to Google Wallet" link. */
  saveUrl(p: WalletPass): Promise<string>;
  /** false — the client never saved the card. */
  update(p: WalletPass): Promise<boolean>;
}

export interface WalletDeps extends Deps {
  wallet: WalletStore;
  cfg: WalletConfig;
  apple: AppleBackend;
  google: GoogleBackend;
}

export type Platform = "apple" | "google";
export const DOWNLOAD_TTL_MS = 10 * 60_000;
/** First sync run (no cursor yet) looks this far back. */
export const SYNC_LOOKBACK_MS = 30 * 60_000;

const token = (bytes: number) => randomBytes(bytes).toString("hex");
const errName = (err: unknown) => (err instanceof Error ? err.name : "unknown");

export function parsePlatform(raw: unknown): Platform {
  const p = (raw as { platform?: unknown } | null)?.platform;
  if (p !== "apple" && p !== "google") throw new UserError("invalid-argument", MSG.badAction);
  return p;
}

/** Pushes the new card to every Apple device holding it and to Google. Never throws. */
export async function notify(p: WalletPass, deps: WalletDeps): Promise<void> {
  try {
    const regs = await deps.wallet.pushTokensFor(p.serial);
    const results = await deps.apple.push(regs.map((r) => r.pushToken));
    await Promise.all(results.map((r, i) => (r === "gone" ? deps.wallet.forgetDevice(regs[i].deviceId) : null)));
    if (results.includes("failed")) deps.log("warn", "apns push failed", { clientId: p.clientId, failed: results.filter((r) => r === "failed").length });
  } catch (err) {
    deps.log("error", "apple wallet update failed", { clientId: p.clientId, error: errName(err) });
  }
  if (!p.google) return;
  try {
    await deps.google.update(p);
  } catch (err) {
    deps.log("error", "google wallet update failed", { clientId: p.clientId, error: errName(err) });
  }
}

/** Brings the client's card (if they have one) up to date with a fresh Poster record. */
export async function refreshCard(client: PosterClientRecord, deps: WalletDeps): Promise<"none" | "same" | "updated"> {
  const p = await deps.wallet.getPassByClient(Number(client.client_id));
  if (!p) return "none";
  const data = toPassData(client);
  if (sameCard(p.data, data)) return "same";
  const next = { ...p, data, updatedAt: deps.now() };
  await deps.wallet.savePass(next);
  await notify(next, deps);
  return "updated";
}

/** For the cabinet: a wallet failure must never break the page. */
export async function safeRefreshCard(client: PosterClientRecord, deps: WalletDeps): Promise<void> {
  try {
    await refreshCard(client, deps);
  } catch (err) {
    deps.log("error", "wallet refresh failed", { clientId: client.client_id, error: errName(err) });
  }
}

async function cardFor(client: PosterClientRecord, deps: WalletDeps): Promise<WalletPass> {
  const existing = await deps.wallet.getPassByClient(Number(client.client_id));
  if (existing) {
    await refreshCard(client, deps);
    return (await deps.wallet.getPass(existing.serial)) ?? existing;
  }
  const p: WalletPass = { serial: token(16), clientId: Number(client.client_id), authToken: token(24), data: toPassData(client), updatedAt: deps.now(), google: false };
  await deps.wallet.savePass(p);
  return p;
}

/** Callable: the link that adds the signed-in client's card to Apple or Google Wallet. */
export async function createWalletLink(uid: string, digits: string, raw: unknown, deps: WalletDeps): Promise<{ url: string }> {
  const platform = parsePlatform(raw);
  const now = deps.now();
  await enforceRate(deps.store, uid, "wallet", now);
  const { client: found } = await resolveClient(uid, digits, deps);
  if (!found) throw new UserError("failed-precondition", MSG.notMember);
  const client = await ensureCardNumber(found, deps);
  let p = await cardFor(client, deps);

  if (platform === "apple") {
    const t = token(24);
    await deps.wallet.createDownload(t, p.serial, new Date(now.getTime() + DOWNLOAD_TTL_MS));
    return { url: `${deps.cfg.apple.webServiceUrl}/download/${t}` };
  }
  if (!p.google) {
    p = { ...p, google: true };
    await deps.wallet.savePass(p);
  }
  return { url: await deps.google.saveUrl(p) };
}

export interface SyncReport {
  mode: "recent" | "full";
  checks: number;
  clients: number;
  updated: number;
}

/**
 * Scheduled: refreshes cards of clients whose checks closed since the last run (`full` — every card,
 * which also catches bonuses Poster credits without a check, e.g. its birthday bonus).
 */
export async function runWalletSync(deps: WalletDeps, full = false): Promise<SyncReport> {
  const now = deps.now();
  const report: SyncReport = { mode: full ? "full" : "recent", checks: 0, clients: 0, updated: 0 };
  let clientIds: number[];
  if (full) {
    clientIds = (await deps.wallet.listPasses()).map((p) => p.clientId);
  } else {
    const cursor = (await deps.wallet.getSyncCursor()) ?? now.getTime() - SYNC_LOOKBACK_MS;
    const fresh = (await deps.poster.getTransactions(kyivYmd(new Date(cursor)), kyivYmd(now))).filter((t) => Number(t.date_close) > cursor);
    report.checks = fresh.length;
    clientIds = [...new Set(fresh.map((t) => Number(t.client_id)).filter((id) => id > 0))];
    const withCard = await Promise.all(clientIds.map(async (id) => ((await deps.wallet.getPassByClient(id)) ? id : 0)));
    clientIds = withCard.filter((id) => id > 0);
    const last = Math.max(cursor, ...fresh.map((t) => Number(t.date_close)));
    await deps.wallet.setSyncCursor(last);
  }
  report.clients = clientIds.length;
  for (const id of clientIds) {
    try {
      const c = await deps.poster.getClient(id);
      if (c && (await refreshCard(c, deps)) === "updated") report.updated++;
    } catch (err) {
      deps.log("error", "wallet sync: client failed", { clientId: id, error: errName(err) });
    }
  }
  if (report.clients) deps.log("info", "wallet sync", { ...report });
  return report;
}
