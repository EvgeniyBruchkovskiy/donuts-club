import { createHash, generateKeyPairSync, verify } from "node:crypto";
import { unzipSync } from "fflate";
import forge from "node-forge";
import { describe, expect, it } from "vitest";
import { UserError } from "../src/errors.js";
import { getMyLoyalty } from "../src/loyalty.js";
import { PNG } from "pngjs";
import { buildPkpass, passJson, wwdrPem } from "../src/wallet/apple.js";
import { drawableName, fittedValue, donutArt, stripImages, stripValue } from "../src/wallet/strip.js";
import { handleAppleRequest, type WsRequest } from "../src/wallet/appleWebService.js";
import { loyaltyObject, saveUrl, signJwt } from "../src/wallet/google.js";
import { PASS_DESIGN, prettyCardNumber, sameCard, toPassData } from "../src/wallet/passData.js";
import { createWalletLink, refreshCard, runWalletSync, safeRefreshCard, SYNC_LOOKBACK_MS } from "../src/wallet/service.js";
import { client, makeWalletDeps, tx } from "./fakes.js";

const PHONE = "380991234567";

function member(over: Parameters<typeof client>[0] = {}) {
  const w = makeWalletDeps();
  w.poster.clients.push(client({ card_number: PHONE, ...over }));
  return w;
}

/** A throwaway self-signed "Pass Type ID" certificate. */
function testSigner() {
  const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const keyPem = privateKey.export({ type: "pkcs8", format: "pem" }).toString();
  const key = forge.pki.privateKeyFromPem(keyPem);
  const cert = forge.pki.createCertificate();
  cert.publicKey = forge.pki.setRsaPublicKey(key.n, key.e);
  cert.serialNumber = "01";
  cert.validity.notBefore = new Date("2026-01-01");
  cert.validity.notAfter = new Date("2027-01-01");
  const attrs = [{ name: "commonName", value: "Pass Type ID: pass.ua.donutsclub.card" }];
  cert.setSubject(attrs);
  cert.setIssuer(attrs);
  cert.sign(key, forge.md.sha256.create());
  return { certPem: forge.pki.certificateToPem(cert), keyPem, wwdrPem: wwdrPem() };
}

describe("pass data", () => {
  it("maps a Poster client to what the card shows", () => {
    const d = toPassData(client({ card_number: PHONE, bonus: "5320" }));
    expect(d).toEqual({ clientId: 7, name: "Олена", bonusUah: 53.2, program: "bonus", percent: 1, cardNumber: PHONE, design: PASS_DESIGN });
    expect(sameCard(d, { ...d })).toBe(true);
    expect(sameCard(d, { ...d, bonusUah: 54 })).toBe(false);
    expect(sameCard(d, { ...d, design: PASS_DESIGN - 1 })).toBe(false); // a redesign reaches cards already issued
  });

  it("falls back to phone digits as the card number and prints it as a phone", () => {
    expect(toPassData(client({ card_number: "" })).cardNumber).toBe(PHONE);
    expect(prettyCardNumber(PHONE)).toBe("+380 99 123 45 67");
    expect(prettyCardNumber("A-1001")).toBe("A-1001");
  });
});

describe("apple pass", () => {
  const { cfg } = makeWalletDeps();

  it("keeps the balance as a back field with a change message and the card number in the QR", () => {
    const p = passJson(cfg, "s1", "tok", toPassData(client({ card_number: PHONE })));
    expect(p.storeCard.primaryFields).toEqual([]);
    expect(p.storeCard.backFields[0]).toMatchObject({ key: "balance", value: 53.2, currencyCode: "UAH" });
    expect(p.storeCard.backFields[0]).toHaveProperty("changeMessage", "Бонусів на рахунку: %@");
    expect(p).not.toHaveProperty("logoText");
    expect(p.storeCard).not.toHaveProperty("secondaryFields");
    expect(p.storeCard.backFields.find((f) => f.key === "name")?.value).toBe("Олена");
    expect(p.barcodes[0]).toMatchObject({ format: "PKBarcodeFormatQR", message: PHONE });
    expect(p).toMatchObject({ passTypeIdentifier: "pass.ua.donutsclub.card", teamIdentifier: "TEAM123456", serialNumber: "s1", authenticationToken: "tok" });
    expect(p.webServiceURL).toMatch(/^https:\/\/.+\/appleWallet$/);
  });

  it("shows the discount for discount-program clients", () => {
    const p = passJson(cfg, "s1", "tok", toPassData(client({ loyalty_type: "2", client_groups_discount: "5" })));
    expect(p.storeCard.backFields[0]).toMatchObject({ key: "balance", label: "Ваша знижка", value: "5%" });
  });

  it("builds a zip whose manifest hashes every file and whose signature is a detached PKCS#7 by the pass certificate", () => {
    const signer = testSigner();
    const images = { "icon.png": new Uint8Array([1, 2, 3]), "logo.png": new Uint8Array([4, 5]) };
    const files = unzipSync(buildPkpass({ hello: "world" }, images, signer));
    expect(Object.keys(files).sort()).toEqual(["icon.png", "logo.png", "manifest.json", "pass.json", "signature"]);
    const manifest = JSON.parse(Buffer.from(files["manifest.json"]).toString());
    for (const name of ["icon.png", "logo.png", "pass.json"]) {
      expect(manifest[name]).toBe(createHash("sha1").update(files[name]).digest("hex"));
    }
    const p7 = forge.pkcs7.messageFromAsn1(forge.asn1.fromDer(Buffer.from(files.signature).toString("binary"))) as forge.pkcs7.PkcsSignedData;
    expect(p7.certificates.map((c) => c.subject.getField("CN").value)).toEqual([
      "Pass Type ID: pass.ua.donutsclub.card",
      "Apple Worldwide Developer Relations Certification Authority",
    ]);
  });
});

describe("balance strip", () => {
  it("formats the balance like the cabinet", () => {
    const d = toPassData(client());
    expect(stripValue({ ...d, bonusUah: 53.2 })).toBe("53,20\u00A0₴");
    expect(stripValue({ ...d, bonusUah: 1250 })).toBe("1\u00A0250\u00A0₴");
    expect(stripValue({ ...d, program: "discount", percent: 5 })).toBe("5%");
  });

  it("draws names in Ukrainian and Latin, drops unknown characters and cuts long names with an ellipsis", () => {
    expect(drawableName("Олена Ґудзь-Їжак")).toBe("Олена Ґудзь-Їжак");
    expect(drawableName("John O’Neil 🍩")).toBe("John O’Neil");
    const long = drawableName("Олександра Костянтинівна Вишневецька-Святополк");
    expect(long.endsWith("…")).toBe(true);
    expect(long.length).toBeLessThan(40);
  });

  it("fits as many donuts as the balance leaves room for", () => {
    const d = toPassData(client());
    expect(donutArt({ ...d, bonusUah: 53.2 })).toBe("donuts");
    expect(donutArt({ ...d, bonusUah: 153.2 })).toBe("donut");
    expect(donutArt({ ...d, bonusUah: 12345.67 })).toBe(null);
  });

  it("drops kopecks only when the balance would not fit", () => {
    const d = toPassData(client());
    expect(fittedValue({ ...d, bonusUah: 1253.4 })).toBe("1\u00A0253,40\u00A0₴");
    expect(fittedValue({ ...d, bonusUah: 123456.78 })).toBe("123\u00A0456\u00A0₴");
  });

  it("renders a transparent strip at 1x, 2x and 3x with ink where the text goes", () => {
    const imgs = stripImages(toPassData(client()));
    for (const [name, scale] of [["strip.png", 1], ["strip@2x.png", 2], ["strip@3x.png", 3]] as const) {
      const png = PNG.sync.read(Buffer.from(imgs[name]));
      expect([png.width, png.height]).toEqual([375 * scale, 144 * scale]);
      const alpha = (x: number, y: number) => png.data[(y * png.width + x) * 4 + 3];
      expect(alpha(png.width - 1, png.height - 1)).toBe(0);
      let inked = 0;
      for (let i = 3; i < png.data.length; i += 4) if (png.data[i] > 0) inked++;
      expect(inked).toBeGreaterThan(100 * scale * scale);
    }
  });
});

describe("google pass", () => {
  it("signs the save link with the service account key", () => {
    const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
    const key = { client_email: "wallet@x.iam.gserviceaccount.com", private_key: privateKey.export({ type: "pkcs8", format: "pem" }).toString() };
    const url = saveUrl(key, { id: "obj" }, ["https://donutsclub.kr.ua"]);
    const [head, body, sig] = url.replace("https://pay.google.com/gp/v/save/", "").split(".");
    expect(verify("RSA-SHA256", Buffer.from(`${head}.${body}`), publicKey, Buffer.from(sig, "base64url"))).toBe(true);
    expect(JSON.parse(Buffer.from(body, "base64url").toString())).toMatchObject({
      iss: key.client_email,
      aud: "google",
      typ: "savetowallet",
      payload: { loyaltyObjects: [{ id: "obj" }] },
    });
    expect(signJwt({ a: 1 }, key).split(".")).toHaveLength(3);
  });

  it("describes the balance in hryvnias and the QR with the card number", () => {
    const { cfg } = makeWalletDeps();
    const o = loyaltyObject(cfg, "abc", toPassData(client({ card_number: PHONE })));
    expect(o.id).toBe("3388000000000000000.abc");
    expect(o.classId).toBe("3388000000000000000.donuts_club");
    expect(o.loyaltyPoints.balance).toEqual({ money: { micros: 53_200_000, currencyCode: "UAH" } });
    expect(o.barcode).toMatchObject({ type: "QR_CODE", value: PHONE });
  });
});

describe("createWalletLink", () => {
  it("refuses people who are not in Poster yet", async () => {
    const w = makeWalletDeps();
    await expect(createWalletLink("u1", PHONE, { platform: "apple" }, w.deps)).rejects.toBeInstanceOf(UserError);
  });

  it("rejects unknown platforms", async () => {
    const w = member();
    await expect(createWalletLink("u1", PHONE, { platform: "nokia" }, w.deps)).rejects.toBeInstanceOf(UserError);
  });

  it("creates one card per client and a short-lived Apple download link", async () => {
    const w = member();
    const { url } = await createWalletLink("u1", PHONE, { platform: "apple" }, w.deps);
    expect(url).toMatch(/\/appleWallet\/download\/[0-9a-f]{48}$/);
    const [p] = await w.wallet.listPasses();
    expect(p).toMatchObject({ clientId: 7, google: false, data: { bonusUah: 53.2 } });
    expect(p.serial).toMatch(/^[0-9a-f]{32}$/);
    const token = url.split("/").pop()!;
    expect((await w.wallet.getDownload(token))!.expiresAt.getTime() - w.clock.now.getTime()).toBe(600_000);

    await createWalletLink("u1", PHONE, { platform: "google" }, w.deps);
    const passes = await w.wallet.listPasses();
    expect(passes).toHaveLength(1);
    expect(passes[0].google).toBe(true);
  });

  it("returns the Google save link", async () => {
    const w = member();
    const { url } = await createWalletLink("u1", PHONE, { platform: "google" }, w.deps);
    expect(url).toMatch(/^https:\/\/pay\.google\.com\/gp\/v\/save\//);
  });

  it("gives Poster clients without a card number their phone as one first", async () => {
    const w = makeWalletDeps();
    w.poster.clients.push(client({ card_number: "" }));
    await createWalletLink("u1", PHONE, { platform: "apple" }, w.deps);
    expect(w.poster.cardNumberChanges).toEqual([{ clientId: 7, cardNumber: PHONE }]);
  });
});

describe("refreshCard", () => {
  async function withCard() {
    const w = member();
    await createWalletLink("u1", PHONE, { platform: "google" }, w.deps);
    const [p] = await w.wallet.listPasses();
    await w.wallet.register("dev1", p.serial, "push1", w.clock.now);
    await w.wallet.register("dev2", p.serial, "push2", w.clock.now);
    return { ...w, serial: p.serial };
  }

  it("does nothing when nothing visible changed", async () => {
    const w = await withCard();
    expect(await refreshCard(w.poster.clients[0], w.deps)).toBe("same");
    expect(w.pushed).toEqual([]);
  });

  it("stores the new balance, pushes every Apple device, updates Google and forgets gone devices", async () => {
    const w = await withCard();
    w.clock.now = new Date("2026-10-22T11:00:00Z");
    w.poster.clients[0].bonus = "6000";
    w.pushResults.push("sent", "gone");
    expect(await refreshCard(w.poster.clients[0], w.deps)).toBe("updated");
    const p = (await w.wallet.getPass(w.serial))!;
    expect(p.data.bonusUah).toBe(60);
    expect(p.updatedAt).toEqual(w.clock.now);
    expect(w.pushed).toEqual([["push1", "push2"]]);
    expect(await w.wallet.pushTokensFor(w.serial)).toEqual([{ deviceId: "dev1", pushToken: "push1" }]);
    expect(w.googleUpdates.at(-1)!.data.bonusUah).toBe(60);
  });

  it("skips Google for cards never offered there", async () => {
    const w = member();
    await createWalletLink("u1", PHONE, { platform: "apple" }, w.deps);
    w.poster.clients[0].bonus = "100";
    await refreshCard(w.poster.clients[0], w.deps);
    expect(w.googleUpdates).toEqual([]);
  });

  it("survives a broken wallet backend", async () => {
    const w = await withCard();
    w.deps.google.update = async () => {
      throw new Error("down");
    };
    w.poster.clients[0].bonus = "100";
    expect(await refreshCard(w.poster.clients[0], w.deps)).toBe("updated");
    expect(w.logs.some((l) => l.message === "google wallet update failed")).toBe(true);
  });

  it("runs when the cabinet loads the client", async () => {
    const w = await withCard();
    w.poster.clients[0].bonus = "7000";
    w.deps.onClientLoaded = (c) => safeRefreshCard(c, w.deps);
    await getMyLoyalty("u1", PHONE, w.deps);
    expect((await w.wallet.getPass(w.serial))!.data.bonusUah).toBe(70);
  });
});

describe("runWalletSync", () => {
  it("refreshes only card holders with checks closed after the cursor and moves the cursor", async () => {
    const w = member();
    await createWalletLink("u1", PHONE, { platform: "apple" }, w.deps);
    w.poster.clients.push(client({ client_id: "8", phone_number: "380671112233" }));
    const now = w.clock.now.getTime();
    w.wallet.cursor = now - 60_000;
    w.poster.transactions = [
      tx("1", now - 120_000), // before the cursor
      tx("2", now - 30_000), // our card holder
      tx("3", now - 20_000, { client_id: "8" }), // no card
      tx("4", now - 10_000, { client_id: "0" }), // anonymous check
    ];
    w.poster.clients[0].bonus = "9000";
    const r = await runWalletSync(w.deps);
    expect(r).toEqual({ mode: "recent", checks: 3, clients: 1, updated: 1 });
    expect(w.wallet.cursor).toBe(now - 10_000);
    expect(w.poster.calls.filter((c) => c === "getClient")).toHaveLength(1); // only the card holder
  });

  it("starts from a short lookback the first time and keeps the cursor when nothing new closed", async () => {
    const w = member();
    const r = await runWalletSync(w.deps);
    expect(r.checks).toBe(0);
    expect(w.wallet.cursor).toBe(w.clock.now.getTime() - SYNC_LOOKBACK_MS);
  });

  it("full mode refreshes every card", async () => {
    const w = member();
    await createWalletLink("u1", PHONE, { platform: "apple" }, w.deps);
    w.poster.clients[0].bonus = "1";
    expect(await runWalletSync(w.deps, true)).toEqual({ mode: "full", checks: 0, clients: 1, updated: 1 });
  });
});

describe("apple web service", () => {
  async function setup() {
    const w = member();
    const { url } = await createWalletLink("u1", PHONE, { platform: "apple" }, w.deps);
    const [p] = await w.wallet.listPasses();
    const call = (method: string, path: string, over: Partial<WsRequest> = {}) =>
      handleAppleRequest({ method, path, query: {}, headers: { authorization: `ApplePass ${p.authToken}` }, body: undefined, ...over }, w.deps);
    return { ...w, p, call, token: url.split("/").pop()! };
  }
  const reg = (serial: string) => `/v1/devices/dev1/registrations/pass.ua.donutsclub.card/${serial}`;

  it("serves the first download while the link is fresh", async () => {
    const s = await setup();
    const ok = await s.call("GET", `/download/${s.token}`, { headers: {} });
    expect(ok.status).toBe(200);
    expect(ok.headers!["Content-Type"]).toBe("application/vnd.apple.pkpass");
    s.clock.now = new Date(s.clock.now.getTime() + 11 * 60_000);
    expect((await s.call("GET", `/download/${s.token}`, { headers: {} })).status).toBe(410);
    expect((await s.call("GET", "/download/nope", { headers: {} })).status).toBe(410);
  });

  it("registers a device once and lets it unregister", async () => {
    const s = await setup();
    expect((await s.call("POST", reg(s.p.serial), { body: { pushToken: "pt" } })).status).toBe(201);
    expect((await s.call("POST", reg(s.p.serial), { body: { pushToken: "pt" } })).status).toBe(200);
    expect(await s.wallet.pushTokensFor(s.p.serial)).toEqual([{ deviceId: "dev1", pushToken: "pt" }]);
    expect((await s.call("DELETE", reg(s.p.serial))).status).toBe(200);
    expect(await s.wallet.pushTokensFor(s.p.serial)).toEqual([]);
  });

  it("rejects a wrong token, an unknown pass and a foreign pass type", async () => {
    const s = await setup();
    expect((await s.call("POST", reg(s.p.serial), { headers: { authorization: "ApplePass wrong" }, body: { pushToken: "pt" } })).status).toBe(401);
    expect((await s.call("POST", reg("unknown"), { body: { pushToken: "pt" } })).status).toBe(401);
    expect((await s.call("GET", `/v1/passes/pass.other/${s.p.serial}`)).status).toBe(404);
    expect((await s.call("POST", reg(s.p.serial), { body: {} })).status).toBe(400);
  });

  it("lists passes updated since the device's tag", async () => {
    const s = await setup();
    await s.call("POST", reg(s.p.serial), { body: { pushToken: "pt" } });
    const list = "/v1/devices/dev1/registrations/pass.ua.donutsclub.card";
    const first = await s.call("GET", list, { headers: {} });
    expect(first.status).toBe(200);
    const body = first.body as { serialNumbers: string[]; lastUpdated: string };
    expect(body.serialNumbers).toEqual([s.p.serial]);
    expect((await s.call("GET", list, { headers: {}, query: { passesUpdatedSince: body.lastUpdated } })).status).toBe(204);
  });

  it("returns the latest pass, or 304 when the device already has it", async () => {
    const s = await setup();
    const path = `/v1/passes/pass.ua.donutsclub.card/${s.p.serial}`;
    const res = await s.call("GET", path);
    expect(res.status).toBe(200);
    expect(Buffer.from(res.body as Uint8Array).toString()).toBe(`pkpass:${s.p.serial}:53.2`);
    const since = res.headers!["Last-Modified"];
    expect((await s.call("GET", path, { headers: { authorization: `ApplePass ${s.p.authToken}`, "if-modified-since": since } })).status).toBe(304);
  });

  it("accepts device logs", async () => {
    const s = await setup();
    expect((await s.call("POST", "/v1/log", { body: { logs: ["oops"] } })).status).toBe(200);
  });
});
