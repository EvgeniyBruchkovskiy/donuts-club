import { initializeApp } from "firebase/app";
import { initializeAppCheck, ReCaptchaEnterpriseProvider } from "firebase/app-check";
import { connectAuthEmulator, getAuth } from "firebase/auth";
import { connectFunctionsEmulator, getFunctions, httpsCallable } from "firebase/functions";
import { firebaseConfig, functionsRegion, recaptchaSiteKey } from "../config";
import type { LoyaltyResult } from "./types";

declare global {
  // eslint-disable-next-line no-var
  var FIREBASE_APPCHECK_DEBUG_TOKEN: string | boolean | undefined;
}

const useEmulators = import.meta.env.VITE_USE_EMULATORS === "1";

// Local dev / e2e: App Check debug token from web/.env.local (never committed).
if (import.meta.env.DEV || useEmulators) {
  self.FIREBASE_APPCHECK_DEBUG_TOKEN = import.meta.env.VITE_APPCHECK_DEBUG_TOKEN || true;
}

export const app = initializeApp(firebaseConfig);

if (recaptchaSiteKey && !useEmulators) {
  initializeAppCheck(app, { provider: new ReCaptchaEnterpriseProvider(recaptchaSiteKey), isTokenAutoRefreshEnabled: true });
}

export const auth = getAuth(app);
auth.languageCode = "uk"; // SMS text and reCAPTCHA in Ukrainian

const functions = getFunctions(app, functionsRegion);

if (useEmulators) {
  connectAuthEmulator(auth, "http://127.0.0.1:9099", { disableWarnings: true });
  connectFunctionsEmulator(functions, "127.0.0.1", 5001);
}

export const api = {
  getMyLoyalty: httpsCallable<void, LoyaltyResult>(functions, "getMyLoyalty"),
  registerMe: httpsCallable<{ name: string; birthday?: string }, { created: boolean; loyalty: LoyaltyResult }>(functions, "registerMe"),
};
