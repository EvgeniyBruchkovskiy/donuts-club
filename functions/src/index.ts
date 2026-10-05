import { initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { setGlobalOptions } from "firebase-functions/v2";
import { HttpsError, onCall, type CallableRequest } from "firebase-functions/v2/https";
import { onSchedule } from "firebase-functions/v2/scheduler";
import * as logger from "firebase-functions/logger";
import { defineSecret } from "firebase-functions/params";
import { MSG, UserError } from "./errors.js";
import { FirestoreStore } from "./firestoreStore.js";
import { getMyLoyalty as getMyLoyaltyImpl, type Deps } from "./loyalty.js";
import { normalizePhone } from "./phone.js";
import { PosterClient, PosterError } from "./poster/client.js";
import { runBirthdayBonuses } from "./bonus/birthday.js";
import { ipKey, staffAction as staffActionImpl, submitFeedback as submitFeedbackImpl, type FeedbackDeps } from "./feedback.js";
import { registerMe as registerMeImpl } from "./register.js";

initializeApp();
setGlobalOptions({ region: "europe-central2", maxInstances: 5 });

const POSTER_TOKEN = defineSecret("POSTER_TOKEN");
/** PIN of the barista page /staff (set with `firebase functions:secrets:set STAFF_PIN`). */
const STAFF_PIN = defineSecret("STAFF_PIN");
const isEmulator = process.env.FUNCTIONS_EMULATOR === "true";

/** Only our Hosting site (incl. preview channels) and local dev may call the functions. */
const ALLOWED_ORIGINS: (string | RegExp)[] = [
  "https://donutsclub.kr.ua",
  "https://www.donutsclub.kr.ua",
  "https://donuts-club-krop.web.app",
  "https://donuts-club-krop.firebaseapp.com",
  /^https:\/\/donuts-club-krop--[a-z0-9-]+\.web\.app$/,
  /^http:\/\/localhost:\d+$/,
  /^http:\/\/127\.0\.0\.1:\d+$/,
];

const callableOpts = {
  enforceAppCheck: !isEmulator,
  secrets: [POSTER_TOKEN],
  cors: ALLOWED_ORIGINS,
  memory: "256MiB" as const,
  timeoutSeconds: 30,
};

function deps(): Deps {
  const log = (level: "info" | "warn" | "error", message: string, data: Record<string, unknown>) => logger[level](message, data);
  return {
    poster: new PosterClient({ token: POSTER_TOKEN.value(), log }),
    store: new FirestoreStore(getFirestore()),
    now: () => new Date(),
    log,
  };
}

function feedbackDeps(): FeedbackDeps {
  return {
    store: new FirestoreStore(getFirestore()),
    now: () => new Date(),
    log: (level, message, data) => logger[level](message, data),
  };
}

/** Client IP behind Google's front end (first hop of X-Forwarded-For), hashed before use. */
function clientIp(req: CallableRequest): string {
  const fwd = req.rawRequest.headers["x-forwarded-for"];
  const first = (Array.isArray(fwd) ? fwd[0] : fwd)?.split(",")[0]?.trim();
  return ipKey(first || req.rawRequest.ip);
}

/** The phone comes only from the verified ID token, never from request data. */
function caller(req: CallableRequest): { uid: string; digits: string } {
  if (!req.auth) throw new HttpsError("unauthenticated", "Потрібно увійти.");
  const phone = req.auth.token.phone_number;
  if (!phone) throw new HttpsError("failed-precondition", "Увійдіть за номером телефону.");
  const digits = normalizePhone(phone);
  if (!digits) throw new HttpsError("failed-precondition", MSG.unsupportedPhone);
  return { uid: req.auth.uid, digits };
}

async function run<T>(name: string, fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof HttpsError) throw err;
    if (err instanceof UserError) throw new HttpsError(err.code, err.message);
    if (err instanceof PosterError) {
      logger.error(`${name}: poster failure`, { method: err.method, code: err.code });
      throw new HttpsError("unavailable", MSG.posterDown);
    }
    logger.error(`${name}: unexpected`, { error: err instanceof Error ? err.name : "unknown" });
    throw new HttpsError("internal", MSG.posterDown);
  }
}

export const getMyLoyalty = onCall(callableOpts, (req) =>
  run("getMyLoyalty", () => {
    const { uid, digits } = caller(req);
    return getMyLoyaltyImpl(uid, digits, deps());
  }),
);

export const registerMe = onCall(callableOpts, (req) =>
  run("registerMe", () => {
    const { uid, digits } = caller(req);
    return registerMeImpl(uid, digits, req.data, deps());
  }),
);

/** Guest review from /feedback — no sign-in; App Check + per-IP limit keep bots out. */
export const submitFeedback = onCall({ ...callableOpts, secrets: [] }, (req) =>
  run("submitFeedback", () => submitFeedbackImpl(req.data, clientIp(req), feedbackDeps())),
);

/** Barista page /staff: check and redeem free-donut codes, read reviews. PIN-protected. */
export const staffAction = onCall({ ...callableOpts, secrets: [STAFF_PIN] }, (req) =>
  run("staffAction", () => staffActionImpl(req.data, clientIp(req), STAFF_PIN.value(), feedbackDeps())),
);

/**
 * Daily at 09:00 Kyiv: birthday rule from config/bonusRules (disabled by default).
 * No client-callable way to credit bonuses exists — only this job and the welcome rule inside callables.
 */
export const birthdayBonuses = onSchedule(
  { schedule: "0 9 * * *", timeZone: "Europe/Kyiv", secrets: [POSTER_TOKEN], memory: "256MiB", timeoutSeconds: 300, retryCount: 0 },
  async () => {
    await runBirthdayBonuses(deps());
  },
);
