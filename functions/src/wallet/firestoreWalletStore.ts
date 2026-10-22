import { Timestamp, type DocumentData, type Firestore } from "firebase-admin/firestore";
import type { PassData } from "./passData.js";
import type { WalletPass, WalletStore } from "./store.js";

// Collections (closed to clients by firestore.rules):
//   walletPasses/{serial}                    a client's card: Poster client_id, Apple auth token, last shown data
//   walletDownloads/{token}                  10-minute .pkpass download links
//   walletRegistrations/{deviceId}_{serial}  Apple devices holding a card, with their push token
//   config/walletSync                        date_close of the last Poster check the sync job saw
export class FirestoreWalletStore implements WalletStore {
  constructor(private readonly db: Firestore) {}

  private toPass(serial: string, d: DocumentData): WalletPass {
    return {
      serial,
      clientId: d.clientId,
      authToken: d.authToken,
      data: d.data as PassData,
      updatedAt: (d.updatedAt as Timestamp).toDate(),
      google: d.google === true,
    };
  }

  async getPass(serial: string) {
    const s = await this.db.doc(`walletPasses/${serial}`).get();
    return s.exists ? this.toPass(s.id, s.data()!) : null;
  }

  async getPassByClient(clientId: number) {
    const q = await this.db.collection("walletPasses").where("clientId", "==", clientId).limit(1).get();
    return q.empty ? null : this.toPass(q.docs[0].id, q.docs[0].data());
  }

  async savePass(p: WalletPass) {
    const { serial, ...rest } = p;
    await this.db.doc(`walletPasses/${serial}`).set({ ...rest, updatedAt: Timestamp.fromDate(p.updatedAt) });
  }

  async listPasses() {
    const q = await this.db.collection("walletPasses").get();
    return q.docs.map((d) => this.toPass(d.id, d.data()));
  }

  async createDownload(token: string, serial: string, expiresAt: Date) {
    await this.db.doc(`walletDownloads/${token}`).set({ serial, expiresAt: Timestamp.fromDate(expiresAt) });
  }

  async getDownload(token: string) {
    const s = await this.db.doc(`walletDownloads/${token}`).get();
    return s.exists ? { serial: s.get("serial") as string, expiresAt: (s.get("expiresAt") as Timestamp).toDate() } : null;
  }

  async register(deviceId: string, serial: string, pushToken: string, now: Date) {
    const ref = this.db.doc(`walletRegistrations/${deviceId}_${serial}`);
    return this.db.runTransaction(async (tx) => {
      const existed = (await tx.get(ref)).exists;
      tx.set(ref, { deviceId, serial, pushToken, updatedAt: Timestamp.fromDate(now) }, { merge: true });
      return !existed;
    });
  }

  async unregister(deviceId: string, serial: string) {
    await this.db.doc(`walletRegistrations/${deviceId}_${serial}`).delete();
  }

  async serialsForDevice(deviceId: string) {
    const regs = await this.db.collection("walletRegistrations").where("deviceId", "==", deviceId).get();
    const passes = await Promise.all(regs.docs.map((r) => this.getPass(r.get("serial") as string)));
    return passes.filter((p): p is WalletPass => p !== null).map((p) => ({ serial: p.serial, updatedAt: p.updatedAt }));
  }

  async pushTokensFor(serial: string) {
    const regs = await this.db.collection("walletRegistrations").where("serial", "==", serial).get();
    return regs.docs.map((r) => ({ deviceId: r.get("deviceId") as string, pushToken: r.get("pushToken") as string }));
  }

  async forgetDevice(deviceId: string) {
    const regs = await this.db.collection("walletRegistrations").where("deviceId", "==", deviceId).get();
    await Promise.all(regs.docs.map((r) => r.ref.delete()));
  }

  async getSyncCursor() {
    const s = await this.db.doc("config/walletSync").get();
    return s.exists ? Number(s.get("lastCloseMs")) || null : null;
  }

  async setSyncCursor(closeMs: number) {
    await this.db.doc("config/walletSync").set({ lastCloseMs: closeMs }, { merge: true });
  }
}
