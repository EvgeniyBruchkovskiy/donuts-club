import type { PassData } from "./passData.js";

/** One card per Poster client, shared by Apple and Google. `serial` is random and unguessable. */
export interface WalletPass {
  serial: string;
  clientId: number;
  /** Apple's per-pass secret: devices send it back as `Authorization: ApplePass <token>`. */
  authToken: string;
  data: PassData;
  updatedAt: Date;
  /** A Google save link was issued, so the object may exist in Google Wallet. */
  google: boolean;
}

export interface WalletStore {
  getPass(serial: string): Promise<WalletPass | null>;
  getPassByClient(clientId: number): Promise<WalletPass | null>;
  /** Creates or overwrites the card (keyed by serial). */
  savePass(p: WalletPass): Promise<void>;
  /** Short-lived link for the first .pkpass download (Safari needs a plain GET URL). */
  createDownload(token: string, serial: string, expiresAt: Date): Promise<void>;
  getDownload(token: string): Promise<{ serial: string; expiresAt: Date } | null>;
  /** Apple device registrations. Returns false when the device already had this pass. */
  register(deviceId: string, serial: string, pushToken: string, now: Date): Promise<boolean>;
  unregister(deviceId: string, serial: string): Promise<void>;
  /** Serials this device holds, with their last update time. */
  serialsForDevice(deviceId: string): Promise<{ serial: string; updatedAt: Date }[]>;
  pushTokensFor(serial: string): Promise<{ deviceId: string; pushToken: string }[]>;
  /** Drops a device whose push token APNs rejected as gone. */
  forgetDevice(deviceId: string): Promise<void>;
  getSyncCursor(): Promise<number | null>;
  setSyncCursor(closeMs: number): Promise<void>;
  /** Every issued card (the daily full refresh). */
  listPasses(): Promise<WalletPass[]>;
}
