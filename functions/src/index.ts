import { initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { setGlobalOptions } from "firebase-functions/v2";
import { HttpsError, onCall, onRequest, type CallableRequest } from "firebase-functions/v2/https";
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
import { buildPkpass, passImages, passJson, pushUpdates, wwdrPem, type AppleSigner } from "./wallet/apple.js";
import { handleAppleRequest } from "./wallet/appleWebService.js";
import { walletConfig } from "./wallet/config.js";
import { stripImages } from "./wallet/strip.js";
import { FirestoreWalletStore } from "./wallet/firestoreWalletStore.js";
import { GoogleWalletApi, loyaltyClass, loyaltyObject, parseServiceAccount, saveUrl } from "./wallet/google.js";
import { createWalletLink as createWalletLinkImpl, runWalletSync, safeRefreshCard, type WalletDeps } from "./wallet/service.js";

initializeApp();
setGlobalOptions({ region: "europe-central2", maxInstances: 5 });

const POSTER_TOKEN = defineSecret("POSTER_TOKEN");
/** PIN of the barista page /staff (set with `firebase functions:secrets:set STAFF_PIN`). */
const STAFF_PIN = defineSecret("STAFF_PIN");
/** Apple Pass Type ID certificate and its key, PEM (docs/wallet-setup.md). */
const APPLE_PASS_CERT = defineSecret("APPLE_PASS_CERT");
const APPLE_PASS_KEY = defineSecret("APPLE_PASS_KEY");
/** Google Wallet service account JSON key. */
const GOOGLE_WALLET_KEY = defineSecret("GOOGLE_WALLET_KEY");
const WALLET_SECRETS = [APPLE_PASS_CERT, APPLE_PASS_KEY, GOOGLE_WALLET_KEY];
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

// Kept per instance: images are read once, the Google OAuth token and class check are reused.
let walletShared: { images: Record<string, Uint8Array>; google: GoogleWalletApi; googleKeyJson: string } | null = null;

function walletDeps(): WalletDeps {
  const base = deps();
  const cfg = walletConfig();
  const signer: AppleSigner = { certPem: APPLE_PASS_CERT.value(), keyPem: APPLE_PASS_KEY.value(), wwdrPem: wwdrPem() };
  const googleKeyJson = GOOGLE_WALLET_KEY.value();
  const key = parseServiceAccount(googleKeyJson);
  if (walletShared?.googleKeyJson !== googleKeyJson) walletShared = { images: passImages(), google: new GoogleWalletApi(key), googleKeyJson };
  const { images, google } = walletShared;
  const origins = ALLOWED_ORIGINS.filter((o): o is string => typeof o === "string");
  const d: WalletDeps = {
    ...base,
    wallet: new FirestoreWalletStore(getFirestore()),
    cfg,
    apple: {
      pkpass: (p) => buildPkpass(passJson(cfg, p.serial, p.authToken, p.data), { ...images, ...stripImages(p.data) }, signer),
      push: (tokens) => pushUpdates(tokens, cfg, signer),
    },
    google: {
      saveUrl: async (p) => {
        await google.ensureClass(loyaltyClass(cfg));
        const obj = loyaltyObject(cfg, p.serial, p.data);
        await google.updateObject(obj); // a re-added card shows today's balance, not the one it was saved with
        return saveUrl(key, obj, origins);
      },
      update: (p) => google.updateObject(loyaltyObject(cfg, p.serial, p.data)),
    },
  };
  d.onClientLoaded = (c) => safeRefreshCard(c, d);
  return d;
}

const walletReady = () => {
  const c = walletConfig();
  return Boolean(c.apple.passTypeId && c.apple.teamId && c.google.issuerId);
};

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

/** Wallet secrets ride along so a cabinet visit also refreshes the client's wallet card. */
export const getMyLoyalty = onCall({ ...callableOpts, secrets: [POSTER_TOKEN, ...WALLET_SECRETS] }, (req) =>
  run("getMyLoyalty", () => {
    const { uid, digits } = caller(req);
    return getMyLoyaltyImpl(uid, digits, walletReady() ? walletDeps() : deps());
  }),
);

/** Cabinet buttons «Додати в Apple Wallet / Google Wallet»: returns the link to open. */
export const createWalletLink = onCall({ ...callableOpts, secrets: [POSTER_TOKEN, ...WALLET_SECRETS] }, (req) =>
  run("createWalletLink", () => {
    const { uid, digits } = caller(req);
    if (!walletReady()) throw new UserError("failed-precondition", MSG.walletOff);
    return createWalletLinkImpl(uid, digits, req.data, walletDeps());
  }),
);

/**
 * The pass's webServiceURL: Apple devices register here, fetch updated passes and report errors;
 * the cabinet's download link lives here too. Authenticated per pass (Authorization: ApplePass <token>).
 */
export const appleWallet = onRequest({ secrets: [POSTER_TOKEN, ...WALLET_SECRETS], memory: "256MiB", timeoutSeconds: 30 }, async (req, res) => {
  try {
    const out = await handleAppleRequest(
      {
        method: req.method,
        path: req.path,
        query: Object.fromEntries(Object.entries(req.query).map(([k, v]) => [k, typeof v === "string" ? v : undefined])),
        headers: { authorization: req.get("authorization"), "if-modified-since": req.get("if-modified-since") },
        body: req.body,
      },
      walletDeps(),
    );
    res.status(out.status).set(out.headers ?? {});
    if (out.body === undefined) res.end();
    else if (out.body instanceof Uint8Array) res.send(Buffer.from(out.body));
    else res.send(out.body);
  } catch (err) {
    logger.error("appleWallet: unexpected", { path: req.path.replace(/[0-9a-f]{16,}/g, "…"), error: err instanceof Error ? err.name : "unknown" });
    res.status(500).end();
  }
});

/**
 * Every 5 minutes while the café is open: refreshes wallet cards of clients whose checks just closed
 * (Apple gets a push, Google an object update). At 10:00 it refreshes every card instead — that
 * catches bonuses Poster credits without a check (its birthday bonus).
 */
export const walletSync = onSchedule(
  { schedule: "*/5 7-22 * * *", timeZone: "Europe/Kyiv", secrets: [POSTER_TOKEN, ...WALLET_SECRETS], memory: "256MiB", timeoutSeconds: 240, retryCount: 0 },
  async (event) => {
    if (!walletReady()) return;
    const at = new Date(event.scheduleTime);
    const kyiv = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Kyiv", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(at);
    await runWalletSync(walletDeps(), kyiv === "10:00");
  },
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
