import { initializeApp } from "firebase/app";
import { initializeAppCheck, ReCaptchaEnterpriseProvider } from "firebase/app-check";
import { connectFunctionsEmulator, getFunctions } from "firebase/functions";
import { firebaseConfig, functionsRegion, recaptchaSiteKey } from "../config";

declare global {
  var FIREBASE_APPCHECK_DEBUG_TOKEN: string | boolean | undefined;
}

export const useEmulators = import.meta.env.VITE_USE_EMULATORS === "1";

// Local dev / e2e: App Check debug token from web/.env.local (never committed).
if (import.meta.env.DEV || useEmulators) {
  self.FIREBASE_APPCHECK_DEBUG_TOKEN = import.meta.env.VITE_APPCHECK_DEBUG_TOKEN || true;
}

/** App + App Check + Functions, shared by every page that calls our callables. */
export const app = initializeApp(firebaseConfig);

if (recaptchaSiteKey && !useEmulators) {
  initializeAppCheck(app, { provider: new ReCaptchaEnterpriseProvider(recaptchaSiteKey), isTokenAutoRefreshEnabled: true });
}

export const functions = getFunctions(app, functionsRegion);

if (useEmulators) connectFunctionsEmulator(functions, "127.0.0.1", 5001);
