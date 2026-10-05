import { createHash, randomInt, timingSafeEqual } from "node:crypto";
import { MSG, UserError } from "./errors.js";
import type { Deps } from "./loyalty.js";
import { maskPhone, normalizePhone } from "./phone.js";
import { rateStep, type Feedback, type Promo, type Store } from "./store.js";

/** A free-donut code lives 30 days, and one phone gets a new code at most once per 30 days. */
export const PROMO_TTL_MS = 30 * 24 * 3600_000;
const COMMENT_MAX = 1000;
const NAME_RE = /^\p{L}[\p{L}\s'’ʼ-]*$/u;
// No 0/O, 1/I/L — the code is read aloud and typed by a barista.
const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
const CODE_LEN = 6;

/** Reviews need no Poster — only state, clock and logs. */
export type FeedbackDeps = Pick<Deps, "store" | "now" | "log">;

const RATE = {
  feedback: { limit: 5, windowMs: 3600_000 },
  staffFail: { limit: 8, windowMs: 15 * 60_000 },
};

export interface FeedbackInput {
  clean: number;
  staff: number;
  comment: string;
  name?: string;
  phone?: string;
}

export type PromoStatus = "valid" | "used" | "expired";

export interface SubmitResult {
  /** Present when a contact was left and the 30-day limit allows a donut. */
  promo?: { code: string; expiresAt: string; repeat: boolean };
  /** A code was already used within 30 days — the next one is available from this date. */
  nextPromoAt?: string;
}

function rating(v: unknown): number {
  if (typeof v !== "number" || !Number.isInteger(v) || v < 1 || v > 5) throw new UserError("invalid-argument", MSG.badRating);
  return v;
}

export function validateFeedback(raw: unknown): FeedbackInput {
  const r = (raw ?? {}) as Record<string, unknown>;
  const out: FeedbackInput = { clean: rating(r.clean), staff: rating(r.staff), comment: "" };

  if (r.comment !== undefined && r.comment !== null) {
    if (typeof r.comment !== "string") throw new UserError("invalid-argument", MSG.badComment);
    out.comment = r.comment.trim().replace(/\r\n/g, "\n").replace(/\n{3,}/g, "\n\n");
    if (out.comment.length > COMMENT_MAX) throw new UserError("invalid-argument", MSG.badComment);
  }

  const name = typeof r.name === "string" ? r.name.trim().replace(/\s+/g, " ") : "";
  if (name) {
    if (name.length < 2 || name.length > 50 || !NAME_RE.test(name)) throw new UserError("invalid-argument", MSG.badName);
    out.name = name;
  }

  if (typeof r.phone === "string" && r.phone.trim()) {
    const digits = normalizePhone(r.phone);
    if (!digits) throw new UserError("invalid-argument", MSG.unsupportedPhone);
    if (!out.name) throw new UserError("invalid-argument", MSG.badName); // the barista greets the guest by name
    out.phone = digits;
  }
  return out;
}

export function promoStatus(p: Promo, now: Date): PromoStatus {
  if (p.redeemedAt) return "used";
  return now.getTime() >= p.expiresAt.getTime() ? "expired" : "valid";
}

/**
 * What a phone gets for a new review, given its latest code (pure — unit tested):
 * "new" — no code in the last 30 days; "repeat" — that code is still unused, show it again;
 * "wait" — it was already redeemed, the next donut comes 30 days after it was issued.
 */
export function promoDecision(prev: Promo | null, now: Date): "new" | "repeat" | "wait" {
  if (!prev || now.getTime() - prev.issuedAt.getTime() >= PROMO_TTL_MS) return "new";
  return prev.redeemedAt ? "wait" : "repeat";
}

export function newPromoCode(rand: (max: number) => number = randomInt): string {
  let s = "";
  for (let i = 0; i < CODE_LEN; i++) s += CODE_ALPHABET[rand(CODE_ALPHABET.length)];
  return s;
}

/** "dc-7kq 4mx" → "7KQ4MX"; anything that can't be one of our codes → null. */
export function normalizeCode(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  let s = raw.toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (s.length === CODE_LEN + 2 && s.startsWith("DC")) s = s.slice(2);
  s = s.replace(/O/g, "0").replace(/[IL]/g, "1"); // so a misread letter is reported as "not found", not silently matched
  return s.length === CODE_LEN && [...s].every((c) => CODE_ALPHABET.includes(c)) ? s : null;
}

/** Anonymous visitors are rate-limited by a hash of their IP (the raw IP is never stored). */
export function ipKey(ip: string | undefined): string {
  return createHash("sha256").update(ip || "unknown").digest("hex").slice(0, 24);
}

async function limit(store: Store, key: string, kind: keyof typeof RATE, now: Date): Promise<boolean> {
  const { limit, windowMs } = RATE[kind];
  return store.hitRateLimit(`${kind}:${key}`, (prev) => rateStep(prev, now.getTime(), limit, windowMs));
}

export async function submitFeedback(raw: unknown, ip: string, deps: FeedbackDeps): Promise<SubmitResult> {
  const now = deps.now();
  const input = validateFeedback(raw);
  if (!(await limit(deps.store, ip, "feedback", now))) throw new UserError("resource-exhausted", MSG.tooManyRequests);

  let result: SubmitResult = {};
  let promoCode: string | undefined;
  if (input.phone) {
    const phone = input.phone;
    for (let attempt = 0; ; attempt++) {
      const code = newPromoCode();
      const r = await deps.store.claimPromo(phone, code, (prev) =>
        promoDecision(prev, now) === "new"
          ? { code, phone, name: input.name ?? "", issuedAt: now, expiresAt: new Date(now.getTime() + PROMO_TTL_MS) }
          : null,
      );
      if (r === "collision") {
        if (attempt < 4) continue;
        throw new Error("promo code collisions");
      }
      if (r.created) {
        promoCode = r.created.code;
        result = { promo: { code: r.created.code, expiresAt: r.created.expiresAt.toISOString(), repeat: false } };
      } else if (r.prev && promoDecision(r.prev, now) === "repeat") {
        result = { promo: { code: r.prev.code, expiresAt: r.prev.expiresAt.toISOString(), repeat: true } };
      } else if (r.prev) {
        result = { nextPromoAt: new Date(r.prev.issuedAt.getTime() + PROMO_TTL_MS).toISOString() };
      }
      break;
    }
  }

  const feedback: Feedback = { ...input, createdAt: now, ...(promoCode ? { promoCode } : {}) };
  await deps.store.addFeedback(feedback);
  deps.log("info", "feedback received", { clean: input.clean, staff: input.staff, phone: input.phone ? maskPhone(input.phone) : null, promo: !!promoCode });
  return result;
}

/* ---------- staff page (PIN-protected) ---------- */

export interface PromoView {
  status: PromoStatus | "missing";
  code: string;
  name?: string;
  phone?: string;
  issuedAt?: string;
  expiresAt?: string;
  redeemedAt?: string;
  /** This very call redeemed it (vs. it was already used — e.g. on another device). */
  redeemedNow?: true;
}

export interface FeedbackView {
  id: string;
  createdAt: string;
  clean: number;
  staff: number;
  comment: string;
  name?: string;
  phone?: string;
  promoCode?: string;
  promoStatus?: PromoStatus;
}

export interface FeedbackList {
  items: FeedbackView[];
  /** Last 30 days. */
  stats: { count: number; clean: number | null; staff: number | null };
}

export type StaffResult = { ok: true } | { promo: PromoView } | FeedbackList;

function samePin(given: string, expected: string): boolean {
  const a = createHash("sha256").update(given).digest();
  const b = createHash("sha256").update(expected).digest();
  return timingSafeEqual(a, b);
}

function promoView(code: string, p: Promo | null, now: Date): PromoView {
  if (!p) return { status: "missing", code };
  return {
    status: promoStatus(p, now),
    code: p.code,
    name: p.name,
    phone: p.phone,
    issuedAt: p.issuedAt.toISOString(),
    expiresAt: p.expiresAt.toISOString(),
    ...(p.redeemedAt ? { redeemedAt: p.redeemedAt.toISOString() } : {}),
  };
}

const avg = (xs: number[]) => (xs.length ? Math.round((xs.reduce((a, b) => a + b, 0) / xs.length) * 10) / 10 : null);

/**
 * One callable for the barista page: `login` | `check` | `redeem` | `feedback`.
 * Wrong PINs are counted per IP; after 8 in 15 minutes even the right PIN is refused until the window passes.
 */
export async function staffAction(raw: unknown, ip: string, pin: string, deps: FeedbackDeps): Promise<StaffResult> {
  const now = deps.now();
  const r = (raw ?? {}) as Record<string, unknown>;
  const { limit: max, windowMs } = RATE.staffFail;
  const locked = !(await deps.store.hitRateLimit(`staffFail:${ip}`, (prev) => {
    const fresh = !prev || now.getTime() - prev.windowStart >= windowMs;
    return { allowed: fresh || prev.count < max, next: prev ?? { windowStart: now.getTime(), count: 0 } };
  }));
  if (locked) throw new UserError("resource-exhausted", MSG.staffLocked);
  if (!pin || typeof r.pin !== "string" || !samePin(r.pin, pin)) {
    await limit(deps.store, ip, "staffFail", now);
    deps.log("warn", "staff: wrong pin", { ip });
    throw new UserError("failed-precondition", MSG.badPin);
  }

  switch (r.action) {
    case "login":
      return { ok: true };
    case "check":
    case "redeem": {
      const code = normalizeCode(r.code);
      if (!code) return { promo: { status: "missing", code: typeof r.code === "string" ? r.code.slice(0, 20) : "" } };
      if (r.action === "check") return { promo: promoView(code, await deps.store.getPromo(code), now) };
      let redeemedNow = false;
      const p = await deps.store.redeemPromo(code, (prev) => {
        redeemedNow = !!prev && promoStatus(prev, now) === "valid";
        return redeemedNow ? now : null;
      });
      if (!redeemedNow) return { promo: promoView(code, p, now) };
      deps.log("info", "promo redeemed", { code });
      return { promo: { ...promoView(code, p, now), redeemedNow: true } };
    }
    case "feedback": {
      const list = await deps.store.listFeedback(150);
      const codes = [...new Set(list.map((f) => f.promoCode).filter((c): c is string => !!c))];
      const promos = await deps.store.getPromos(codes);
      const recent = list.filter((f) => now.getTime() - f.createdAt.getTime() < PROMO_TTL_MS);
      return {
        items: list.map((f) => {
          const p = f.promoCode ? promos.get(f.promoCode) : undefined;
          return {
            id: f.id,
            createdAt: f.createdAt.toISOString(),
            clean: f.clean,
            staff: f.staff,
            comment: f.comment,
            ...(f.name ? { name: f.name } : {}),
            ...(f.phone ? { phone: f.phone } : {}),
            ...(f.promoCode ? { promoCode: f.promoCode } : {}),
            ...(p ? { promoStatus: promoStatus(p, now) } : {}),
          };
        }),
        stats: { count: recent.length, clean: avg(recent.map((f) => f.clean)), staff: avg(recent.map((f) => f.staff)) },
      };
    }
    default:
      throw new UserError("invalid-argument", MSG.badAction);
  }
}
