import { connectAuthEmulator, getAuth } from "firebase/auth";
import { httpsCallable } from "firebase/functions";
import { app, functions, useEmulators } from "../lib/firebaseApp";
import type { LoyaltyResult } from "./types";

export const auth = getAuth(app);
auth.languageCode = "uk"; // SMS text and reCAPTCHA in Ukrainian

// Automated tests only: skips reCAPTCHA. Works solely with Firebase *test* phone numbers and is
// compiled out of production builds (import.meta.env.DEV is false there).
if (import.meta.env.DEV && import.meta.env.VITE_E2E_DISABLE_APP_VERIFICATION === "1") {
  auth.settings.appVerificationDisabledForTesting = true;
}

if (useEmulators) connectAuthEmulator(auth, "http://127.0.0.1:9099", { disableWarnings: true });

export const api = {
  getMyLoyalty: httpsCallable<void, LoyaltyResult>(functions, "getMyLoyalty"),
  registerMe: httpsCallable<{ name: string; birthday?: string }, { created: boolean; loyalty: LoyaltyResult }>(functions, "registerMe"),
};
