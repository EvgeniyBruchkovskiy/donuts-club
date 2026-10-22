/**
 * Wallet identifiers. Not secrets: they end up inside every issued card.
 * Set in functions/.env (APPLE_PASS_TYPE_ID, APPLE_TEAM_ID, GOOGLE_WALLET_ISSUER_ID) — see docs/wallet-setup.md.
 */
export interface WalletConfig {
  apple: { passTypeId: string; teamId: string; webServiceUrl: string };
  google: { issuerId: string; classSuffix: string };
  siteUrl: string;
  /** Public images Google Wallet loads by URL (served by Hosting from web/public/img/wallet). */
  images: { logo: string; hero: string };
}

export const SITE_URL = "https://donutsclub.kr.ua";
export const FUNCTIONS_URL = "https://europe-central2-named-vine-322614.cloudfunctions.net";

export function walletConfig(env: NodeJS.ProcessEnv = process.env): WalletConfig {
  return {
    apple: {
      passTypeId: env.APPLE_PASS_TYPE_ID ?? "",
      teamId: env.APPLE_TEAM_ID ?? "",
      webServiceUrl: `${FUNCTIONS_URL}/appleWallet`,
    },
    google: { issuerId: env.GOOGLE_WALLET_ISSUER_ID ?? "", classSuffix: "donuts_club" },
    siteUrl: SITE_URL,
    images: { logo: `${SITE_URL}/img/wallet/logo-660.png`, hero: `${SITE_URL}/img/wallet/hero.png` },
  };
}

export const BRAND = {
  name: "DONUTS CLUB",
  program: "Клуб DONUTS",
  address: "м. Кропивницький, вул. Гоголя, 80ж",
  /** Cream background, chocolate text, pink labels — the site's palette. */
  apple: { background: "rgb(255,246,236)", foreground: "rgb(59,36,21)", label: "rgb(255,78,147)" },
  googleBackground: "#FF6FA6",
};
