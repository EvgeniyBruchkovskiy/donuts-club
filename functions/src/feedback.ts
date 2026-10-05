import { createHash, timingSafeEqual } from "node:crypto";
import { MSG, UserError } from "./errors.js";
import type { Deps } from "./loyalty.js";
import { maskPhone, normalizePhone } from "./phone.js";
import { rateStep, type Feedback, type Store } from "./store.js";

/** The staff page averages the last 30 days. */
const STATS_WINDOW_MS = 30 * 24 * 3600_000;
const COMMENT_MAX = 1000;
const NAME_RE = /^\p{L}[\p{L}\s'’ʼ-]*$/u;

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
    out.phone = digits;
  }
  return out;
}

/** Anonymous visitors are rate-limited by a hash of their IP (the raw IP is never stored). */
export function ipKey(ip: string | undefined): string {
  return createHash("sha256").update(ip || "unknown").digest("hex").slice(0, 24);
}

async function limit(store: Store, key: string, kind: keyof typeof RATE, now: Date): Promise<boolean> {
  const { limit, windowMs } = RATE[kind];
  return store.hitRateLimit(`${kind}:${key}`, (prev) => rateStep(prev, now.getTime(), limit, windowMs));
}

export async function submitFeedback(raw: unknown, ip: string, deps: FeedbackDeps): Promise<{ ok: true }> {
  const now = deps.now();
  const input = validateFeedback(raw);
  if (!(await limit(deps.store, ip, "feedback", now))) throw new UserError("resource-exhausted", MSG.tooManyRequests);

  const feedback: Feedback = { ...input, createdAt: now };
  await deps.store.addFeedback(feedback);
  deps.log("info", "feedback received", { clean: input.clean, staff: input.staff, phone: input.phone ? maskPhone(input.phone) : null });
  return { ok: true };
}

/* ---------- staff page (PIN-protected) ---------- */

export interface FeedbackView {
  id: string;
  createdAt: string;
  clean: number;
  staff: number;
  comment: string;
  name?: string;
  phone?: string;
}

export interface FeedbackList {
  items: FeedbackView[];
  /** Last 30 days. */
  stats: { count: number; clean: number | null; staff: number | null };
}

export type StaffResult = { ok: true } | FeedbackList;

function samePin(given: string, expected: string): boolean {
  const a = createHash("sha256").update(given).digest();
  const b = createHash("sha256").update(expected).digest();
  return timingSafeEqual(a, b);
}

const avg = (xs: number[]) => (xs.length ? Math.round((xs.reduce((a, b) => a + b, 0) / xs.length) * 10) / 10 : null);

/**
 * One callable for the staff page: `login` | `feedback`.
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
    case "feedback": {
      const list = await deps.store.listFeedback(150);
      const recent = list.filter((f) => now.getTime() - f.createdAt.getTime() < STATS_WINDOW_MS);
      return {
        items: list.map((f) => ({
          id: f.id,
          createdAt: f.createdAt.toISOString(),
          clean: f.clean,
          staff: f.staff,
          comment: f.comment,
          ...(f.name ? { name: f.name } : {}),
          ...(f.phone ? { phone: f.phone } : {}),
        })),
        stats: { count: recent.length, clean: avg(recent.map((f) => f.clean)), staff: avg(recent.map((f) => f.staff)) },
      };
    }
    default:
      throw new UserError("invalid-argument", MSG.badAction);
  }
}
