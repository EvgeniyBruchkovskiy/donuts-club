// Public web config: these values ship to every browser by design (not secrets).
// Access is protected by Auth, App Check and server-side checks in Cloud Functions.
export const firebaseConfig = {
  apiKey: "AIzaSyCNnmiOUFsXE95qes6SlPdBNzhIuBleeks",
  authDomain: "named-vine-322614.firebaseapp.com",
  projectId: "named-vine-322614",
  appId: "1:510543265347:web:929337e063bbd09b54def6",
  messagingSenderId: "510543265347",
};

/** reCAPTCHA Enterprise site key used by App Check. */
export const recaptchaSiteKey = "6LeysdUtAAAAAN4cG9wmpJ8KpgVoaiCSrk-LHoE0";

export const functionsRegion = "europe-central2";
