import { createSign } from "node:crypto";
import { BRAND, type WalletConfig } from "./config.js";
import { prettyCardNumber, programLine, type PassData } from "./passData.js";

const API = "https://walletobjects.googleapis.com/walletobjects/v1";
const SCOPE = "https://www.googleapis.com/auth/wallet_object.issuer";

/** The service account JSON key from the Google Pay & Wallet Console (secret GOOGLE_WALLET_KEY). */
export interface ServiceAccountKey {
  client_email: string;
  private_key: string;
}

export function parseServiceAccount(json: string): ServiceAccountKey {
  const k = JSON.parse(json) as Partial<ServiceAccountKey>;
  if (!k.client_email || !k.private_key) throw new Error("GOOGLE_WALLET_KEY is not a service account key");
  return { client_email: k.client_email, private_key: k.private_key };
}

const b64url = (s: string | Buffer) => Buffer.from(s).toString("base64url");

/** RS256 JWT signed with the service account key. */
export function signJwt(claims: object, key: ServiceAccountKey): string {
  const head = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const body = b64url(JSON.stringify(claims));
  const sig = createSign("RSA-SHA256").update(`${head}.${body}`).sign(key.private_key);
  return `${head}.${body}.${b64url(sig)}`;
}

export const classId = (cfg: WalletConfig) => `${cfg.google.issuerId}.${cfg.google.classSuffix}`;
export const objectId = (cfg: WalletConfig, serial: string) => `${cfg.google.issuerId}.${serial}`;

export function loyaltyClass(cfg: WalletConfig) {
  return {
    id: classId(cfg),
    issuerName: BRAND.name,
    programName: BRAND.program,
    programLogo: { sourceUri: { uri: cfg.images.logo }, contentDescription: { defaultValue: { language: "uk", value: BRAND.name } } },
    heroImage: { sourceUri: { uri: cfg.images.hero }, contentDescription: { defaultValue: { language: "uk", value: "Пончики DONUTS CLUB" } } },
    hexBackgroundColor: BRAND.googleBackground,
    reviewStatus: "UNDER_REVIEW",
    multipleDevicesAndHoldersAllowedStatus: "ONE_USER_ALL_DEVICES",
    localizedIssuerName: { defaultValue: { language: "uk", value: BRAND.name } },
    linksModuleData: { uris: [{ uri: cfg.siteUrl, description: "Сайт DONUTS CLUB", id: "site" }] },
  };
}

export function loyaltyObject(cfg: WalletConfig, serial: string, d: PassData) {
  const points =
    d.program === "discount"
      ? { label: "Знижка", balance: { string: `${d.percent}%` } }
      : { label: "Бонуси, ₴", balance: { money: { micros: Math.round(d.bonusUah * 1_000_000), currencyCode: "UAH" } } };
  return {
    id: objectId(cfg, serial),
    classId: classId(cfg),
    state: "ACTIVE",
    accountId: prettyCardNumber(d.cardNumber),
    accountName: d.name || "Учасник клубу",
    loyaltyPoints: points,
    barcode: { type: "QR_CODE", value: d.cardNumber, alternateText: prettyCardNumber(d.cardNumber) },
    textModulesData: [
      { id: "program", header: "Ваша програма", body: programLine(d) },
      { id: "how", header: "Як користуватися", body: "Покажіть QR-код на касі — бонуси нарахуються автоматично. 1 бонус = 1 ₴, ними можна оплатити до 50% чеку." },
      { id: "address", header: "Адреса", body: BRAND.address },
    ],
    linksModuleData: { uris: [{ uri: `${cfg.siteUrl}/account`, description: "Мій кабінет: історія покупок", id: "cabinet" }] },
  };
}

/** "Add to Google Wallet" link: the object travels inside the signed JWT, Google creates it on save. */
export function saveUrl(key: ServiceAccountKey, object: object, origins: string[]): string {
  const jwt = signJwt({ iss: key.client_email, aud: "google", typ: "savetowallet", origins, payload: { loyaltyObjects: [object] } }, key);
  return `https://pay.google.com/gp/v/save/${jwt}`;
}

export class GoogleWalletError extends Error {
  constructor(readonly status: number, readonly op: string) {
    super(`Google Wallet ${op}: HTTP ${status}`);
    this.name = "GoogleWalletError";
  }
}

/** Minimal Wallet Objects REST client (service-account OAuth, no extra dependencies). */
export class GoogleWalletApi {
  private token: { value: string; expiresAt: number } | null = null;
  private classReady = false;

  constructor(
    private readonly key: ServiceAccountKey,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  private async accessToken(): Promise<string> {
    const now = Math.floor(Date.now() / 1000);
    if (this.token && this.token.expiresAt > now + 60) return this.token.value;
    const assertion = signJwt({ iss: this.key.client_email, scope: SCOPE, aud: "https://oauth2.googleapis.com/token", iat: now, exp: now + 3600 }, this.key);
    const res = await this.fetchImpl("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion }),
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) throw new GoogleWalletError(res.status, "token");
    const json = (await res.json()) as { access_token: string; expires_in: number };
    this.token = { value: json.access_token, expiresAt: now + json.expires_in };
    return json.access_token;
  }

  private async call(method: string, path: string, body?: object): Promise<Response> {
    return this.fetchImpl(`${API}/${path}`, {
      method,
      headers: { Authorization: `Bearer ${await this.accessToken()}`, ...(body && { "Content-Type": "application/json" }) },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(8000),
    });
  }

  /** Creates the loyalty class if Google doesn't have it yet. An existing class is left as is (it may be approved). */
  async ensureClass(cls: { id: string }): Promise<void> {
    if (this.classReady) return;
    const get = await this.call("GET", `loyaltyClass/${cls.id}`);
    const res = get.status === 404 ? await this.call("POST", "loyaltyClass", cls) : get;
    if (!res.ok) throw new GoogleWalletError(res.status, "class");
    this.classReady = true;
  }

  /** Pushes a new design to the existing class (used by scripts/update-google-class.mjs after a redesign). */
  async updateClass(cls: { id: string }): Promise<void> {
    const res = await this.call("PATCH", `loyaltyClass/${cls.id}`, cls);
    if (!res.ok) throw new GoogleWalletError(res.status, "class update");
  }

  /** Updates a saved card. Returns false when the client never saved it (Google has no such object). */
  async updateObject(obj: { id: string }): Promise<boolean> {
    const res = await this.call("PUT", `loyaltyObject/${obj.id}`, obj);
    if (res.status === 404) return false;
    if (!res.ok) throw new GoogleWalletError(res.status, "object");
    return true;
  }
}
