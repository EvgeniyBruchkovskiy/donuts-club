import { describe, expect, it, vi } from "vitest";
import { PosterClient, PosterError } from "../src/poster/client.js";

const TOKEN = "000000:deadbeefdeadbeefdeadbeefdeadbeef";
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

function make(responses: (Response | Error)[]) {
  const fetchImpl = vi.fn(async () => {
    const r = responses.shift();
    if (!r) throw new Error("no more responses");
    if (r instanceof Error) throw r;
    return r;
  });
  const logs: unknown[] = [];
  const pc = new PosterClient({ token: TOKEN, fetchImpl: fetchImpl as unknown as typeof fetch, sleep: async () => {}, log: (...a) => logs.push(a) });
  return { pc, fetchImpl, logs };
}

describe("PosterClient", () => {
  it("builds GET url with token, format and params", async () => {
    const { pc, fetchImpl } = make([json({ response: [] })]);
    await pc.findClientsByPhone("+380991234567");
    const url = new URL((fetchImpl.mock.calls[0] as unknown[])[0] as string);
    expect(url.origin + url.pathname).toBe("https://joinposter.com/api/clients.getClients");
    expect(url.searchParams.get("token")).toBe(TOKEN);
    expect(url.searchParams.get("format")).toBe("json");
    expect(url.searchParams.get("phone")).toBe("+380991234567");
  });

  it("retries GET on 5xx and network errors, then succeeds", async () => {
    const { pc, fetchImpl } = make([json({}, 502), new TypeError("fetch failed"), json({ response: [{ client_id: "1" }] })]);
    await expect(pc.getClient(1)).resolves.toEqual({ client_id: "1" });
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it("gives up after retries with a PosterError", async () => {
    const { pc, fetchImpl } = make([json({}, 500), json({}, 500), json({}, 503)]);
    await expect(pc.findClientsByPhone("+380")).rejects.toMatchObject({ code: "http_503" });
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it("never retries POST (createClient must not duplicate)", async () => {
    const { pc, fetchImpl } = make([json({}, 502)]);
    await expect(pc.createClient({ client_name: "A", client_groups_id_client: 2, phone: "+380991234567" })).rejects.toBeInstanceOf(PosterError);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("sends POST body as JSON", async () => {
    const { pc, fetchImpl } = make([json({ response: 51 })]);
    await expect(pc.changeClientBonus(5, 1)).resolves.toBe(51);
    const init = (fetchImpl.mock.calls[0] as unknown[])[1] as RequestInit;
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body as string)).toEqual({ client_id: 5, count: 1 });
  });

  it("maps Poster API errors without retrying", async () => {
    const { pc, fetchImpl } = make([json({ error: { code: 11, message: "Bad access token" } })]);
    await expect(pc.findClientsByPhone("+380")).rejects.toMatchObject({ code: 11, method: "clients.getClients" });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("treats unknown client id as null", async () => {
    const { pc } = make([json({ error: { code: 32 } })]);
    await expect(pc.getClient(999)).resolves.toBeNull();
  });

  it("maps timeouts", async () => {
    const e = new Error("t");
    e.name = "TimeoutError";
    const { pc } = make([e, e, e]);
    await expect(pc.getClient(1)).rejects.toMatchObject({ code: "timeout" });
  });

  it("never logs the token, the phone or the URL", async () => {
    const leak = new TypeError(`fetch failed for https://joinposter.com/api/x?token=${TOKEN}&phone=+380991234567`);
    const { pc, logs } = make([json({ response: [] }), leak, leak, leak]);
    await pc.findClientsByPhone("+380991234567");
    const err = await pc.findClientsByPhone("+380991234567").catch((e) => e);
    const dump = JSON.stringify(logs) + String(err.message);
    expect(dump).not.toContain(TOKEN);
    expect(dump).not.toContain("991234567");
    expect(dump).not.toContain("joinposter.com");
  });

  it("refuses an empty token", () => {
    expect(() => new PosterClient({ token: "" })).toThrow();
  });
});
