import { timingSafeEqual } from "node:crypto";
import type { WalletDeps } from "./service.js";

/**
 * Apple Wallet web service (developer.apple.com → "Wallet Passes web service"), plus the first download.
 * Paths are relative to the function URL that is the pass's webServiceURL:
 *   GET    /download/{token}                                         first install from the cabinet
 *   POST   /v1/devices/{device}/registrations/{passType}/{serial}    device added the pass
 *   DELETE /v1/devices/{device}/registrations/{passType}/{serial}    device removed it
 *   GET    /v1/devices/{device}/registrations/{passType}?passesUpdatedSince=tag
 *   GET    /v1/passes/{passType}/{serial}                            latest version of a pass
 *   POST   /v1/log                                                   device error reports
 */
export interface WsRequest {
  method: string;
  path: string;
  query: Record<string, string | undefined>;
  headers: Record<string, string | undefined>;
  body: unknown;
}

export interface WsResponse {
  status: number;
  headers?: Record<string, string>;
  body?: Uint8Array | string | object;
}

const PKPASS = "application/vnd.apple.pkpass";
const seconds = (d: Date) => Math.floor(d.getTime() / 1000);

function sameSecret(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

export async function handleAppleRequest(req: WsRequest, deps: WalletDeps): Promise<WsResponse> {
  const parts = req.path.split("/").filter(Boolean);
  const m = req.method.toUpperCase();

  if (m === "GET" && parts.length === 2 && parts[0] === "download") {
    const d = await deps.wallet.getDownload(parts[1]);
    if (!d || d.expiresAt.getTime() < deps.now().getTime()) {
      return { status: 410, headers: { "Content-Type": "text/plain; charset=utf-8" }, body: "Посилання застаріло. Поверніться в кабінет і натисніть «Додати в Apple Wallet» ще раз." };
    }
    const p = await deps.wallet.getPass(d.serial);
    if (!p) return { status: 404 };
    return {
      status: 200,
      headers: { "Content-Type": PKPASS, "Content-Disposition": 'attachment; filename="donuts-club.pkpass"', "Cache-Control": "no-store" },
      body: deps.apple.pkpass(p),
    };
  }

  if (parts[0] !== "v1") return { status: 404 };
  if (m === "POST" && parts[1] === "log") {
    const logs = (req.body as { logs?: unknown[] } | null)?.logs;
    deps.log("warn", "apple wallet device log", { logs: Array.isArray(logs) ? logs.slice(0, 5).map(String) : [] });
    return { status: 200 };
  }

  const passType = parts[1] === "devices" ? parts[4] : parts[2];
  if (passType !== deps.cfg.apple.passTypeId) return { status: 404 };

  // GET /v1/devices/{device}/registrations/{passType} — not authenticated (no pass in the request).
  if (m === "GET" && parts[1] === "devices" && parts[3] === "registrations" && parts.length === 5) {
    const since = Number(req.query.passesUpdatedSince) || 0;
    const held = await deps.wallet.serialsForDevice(parts[2]);
    const changed = held.filter((h) => h.updatedAt.getTime() > since);
    if (!changed.length) return { status: 204 };
    return {
      status: 200,
      body: { serialNumbers: changed.map((h) => h.serial), lastUpdated: String(Math.max(...changed.map((h) => h.updatedAt.getTime()))) },
    };
  }

  const serial = parts[1] === "devices" ? parts[5] : parts[3];
  if (!serial) return { status: 404 };
  const p = await deps.wallet.getPass(serial);
  if (!p) return { status: 401 };
  if (!sameSecret(req.headers.authorization ?? "", `ApplePass ${p.authToken}`)) return { status: 401 };

  if (parts[1] === "devices" && parts[3] === "registrations" && parts.length === 6) {
    const device = parts[2];
    if (m === "DELETE") {
      await deps.wallet.unregister(device, serial);
      return { status: 200 };
    }
    if (m === "POST") {
      const pushToken = (req.body as { pushToken?: unknown } | null)?.pushToken;
      if (typeof pushToken !== "string" || !pushToken) return { status: 400 };
      return { status: (await deps.wallet.register(device, serial, pushToken, deps.now())) ? 201 : 200 };
    }
  }

  if (m === "GET" && parts[1] === "passes" && parts.length === 4) {
    const since = Date.parse(req.headers["if-modified-since"] ?? "");
    if (!Number.isNaN(since) && seconds(p.updatedAt) <= Math.floor(since / 1000)) return { status: 304 };
    return {
      status: 200,
      headers: { "Content-Type": PKPASS, "Last-Modified": p.updatedAt.toUTCString(), "Cache-Control": "no-store" },
      body: deps.apple.pkpass(p),
    };
  }
  return { status: 404 };
}
