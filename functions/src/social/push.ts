import { createPrivateKey, createSign } from "node:crypto";
import http2 from "node:http2";
import type { PostKind, SocialDevice, SocialPost } from "./model.js";

export interface PushMessage {
  title: string;
  body: string;
  postId: string;
}

const TITLES: Record<PostKind, string> = { image: "Фото", carousel: "Карусель", video: "Reels", story: "Сторіс", text: "Пост" };
const NAMES = { instagram: "Instagram", threads: "Threads" } as const;

const clip = (s: string, n: number) => {
  const t = s.replace(/\s+/g, " ").trim();
  return t.length > n ? `${t.slice(0, n - 1)}…` : t;
};

/** What the team sees on the lock screen once a post has gone out (or has not). */
export function pushFor(id: string, p: SocialPost): PushMessage {
  const ok = p.platforms.filter((x) => p.results[x]?.state === "published").map((x) => NAMES[x]);
  const bad = p.platforms.filter((x) => p.results[x]?.state === "failed");
  const what = TITLES[p.kind];
  const text = clip(p.caption || p.threadsText || "", 90);
  if (!bad.length) {
    return { postId: id, title: `${what} опубліковано в ${ok.join(" і ")}`, body: text || (p.createdBy ? `Запланував(ла): ${p.createdBy}` : "Готово 🍩") };
  }
  const err = clip(p.results[bad[0]]?.error ?? "", 120);
  return {
    postId: id,
    title: `${what} не вийшло в ${bad.map((x) => NAMES[x]).join(" і ")}`,
    body: [text && `«${clip(text, 50)}»`, err].filter(Boolean).join(" — ") || "Відкрийте застосунок, щоб повторити.",
  };
}

const HOSTS = { production: "https://api.push.apple.com", sandbox: "https://api.sandbox.push.apple.com" };

/** Sends over APNs HTTP/2 with a token-based (.p8) key; tokens Apple calls dead are dropped. */
export class ApnsSender {
  private jwt?: { value: string; at: number };

  constructor(
    private readonly cfg: { keyPem: string; keyId: string; teamId: string; topic: string },
    private readonly devices: { listDevices(): Promise<SocialDevice[]>; setDevice(token: string, d: null): Promise<void> },
    private readonly log: (level: "info" | "warn", message: string, data: Record<string, unknown>) => void,
  ) {}

  private token(): string {
    const now = Math.floor(Date.now() / 1000);
    // Apple accepts a provider token for up to an hour and throttles refreshes under 20 minutes.
    if (this.jwt && now - this.jwt.at < 40 * 60) return this.jwt.value;
    const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString("base64url");
    const data = `${b64({ alg: "ES256", kid: this.cfg.keyId })}.${b64({ iss: this.cfg.teamId, iat: now })}`;
    const sig = createSign("SHA256").update(data).sign({ key: createPrivateKey(this.cfg.keyPem), dsaEncoding: "ieee-p1363" }).toString("base64url");
    this.jwt = { value: `${data}.${sig}`, at: now };
    return this.jwt.value;
  }

  async send(m: PushMessage): Promise<void> {
    const list = await this.devices.listDevices();
    for (const env of ["production", "sandbox"] as const) {
      const targets = list.filter((d) => d.env === env);
      if (!targets.length) continue;
      const session = http2.connect(HOSTS[env]);
      try {
        const body = JSON.stringify({ aps: { alert: { title: m.title, body: m.body }, sound: "default" }, postId: m.postId });
        await Promise.all(targets.map((d) => this.one(session, d.token, body)));
      } finally {
        session.close();
      }
    }
  }

  private one(session: http2.ClientHttp2Session, device: string, body: string): Promise<void> {
    return new Promise((resolve) => {
      const req = session.request({
        ":method": "POST",
        ":path": `/3/device/${device}`,
        authorization: `bearer ${this.token()}`,
        "apns-topic": this.cfg.topic,
        "apns-push-type": "alert",
        "apns-priority": "10",
      });
      let status = 0;
      let reply = "";
      req.setTimeout(10_000, () => req.close());
      req.on("response", (h) => (status = Number(h[":status"])));
      req.on("data", (c) => (reply += c));
      req.on("error", (e) => {
        this.log("warn", "social: apns error", { error: e.message });
        resolve();
      });
      req.on("close", async () => {
        if (status !== 200) {
          const reason = (() => {
            try {
              return String(JSON.parse(reply).reason);
            } catch {
              return reply;
            }
          })();
          this.log("warn", "social: apns rejected", { status, reason });
          if (status === 410 || reason === "BadDeviceToken" || reason === "DeviceTokenNotForTopic") await this.devices.setDevice(device, null).catch(() => {});
        }
        resolve();
      });
      req.end(body);
    });
  }
}
