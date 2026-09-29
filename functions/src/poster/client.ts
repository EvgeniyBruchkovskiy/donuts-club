import type { CreateClientInput, PosterApi, PosterClientRecord, PosterTransaction } from "./types.js";

const BASE_URL = "https://joinposter.com/api";

export class PosterError extends Error {
  constructor(
    message: string,
    /** Poster API error code, or "http_<status>" / "network" / "timeout". */
    readonly code: number | string,
    readonly method: string,
  ) {
    super(message);
    this.name = "PosterError";
  }
}

export type PosterLog = (level: "info" | "warn" | "error", message: string, data: Record<string, unknown>) => void;

export interface PosterClientOptions {
  token: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  /** Extra attempts for GET requests on network errors / 5xx / 429. POSTs are never retried. */
  retries?: number;
  log?: PosterLog;
  sleep?: (ms: number) => Promise<void>;
}

/**
 * Thin Poster Web API wrapper. Logs carry only the method name, status and timing —
 * never the URL (it contains the token and the phone) nor response bodies.
 */
export class PosterClient implements PosterApi {
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;
  private readonly retries: number;
  private readonly log: PosterLog;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(private readonly opts: PosterClientOptions) {
    if (!opts.token) throw new Error("POSTER_TOKEN is empty");
    this.fetchImpl = opts.fetchImpl ?? fetch;
    this.timeoutMs = opts.timeoutMs ?? 8000;
    this.retries = opts.retries ?? 2;
    this.log = opts.log ?? (() => {});
    this.sleep = opts.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  }

  async request<T>(method: string, query: Record<string, string | number> = {}, body?: object): Promise<T> {
    const params = new URLSearchParams({ format: "json", token: this.opts.token });
    for (const [k, v] of Object.entries(query)) params.set(k, String(v));
    const url = `${BASE_URL}/${method}?${params}`;
    const attempts = body ? 1 : this.retries + 1;

    for (let attempt = 1; ; attempt++) {
      const started = Date.now();
      let status = 0;
      try {
        const res = await this.fetchImpl(url, {
          method: body ? "POST" : "GET",
          headers: body ? { "Content-Type": "application/json" } : undefined,
          body: body ? JSON.stringify(body) : undefined,
          signal: AbortSignal.timeout(this.timeoutMs),
        });
        status = res.status;
        if (status >= 500 || status === 429) throw new PosterError(`Poster HTTP ${status}`, `http_${status}`, method);
        if (!res.ok) throw new PosterError(`Poster HTTP ${status}`, `http_${status}`, method);

        const json = (await res.json()) as { response?: T; error?: { code?: number; message?: string } | number };
        if (json.error !== undefined) {
          const code = typeof json.error === "object" ? (json.error.code ?? "unknown") : json.error;
          this.log("warn", "poster api error", { method, code, ms: Date.now() - started });
          throw new PosterError(`Poster error ${code}`, code, method);
        }
        this.log("info", "poster ok", { method, status, attempt, ms: Date.now() - started });
        return json.response as T;
      } catch (err) {
        const pe = toPosterError(err, method);
        const retryable = pe.code === "network" || pe.code === "timeout" || /^http_(5\d\d|429)$/.test(String(pe.code));
        if (!retryable || attempt >= attempts) {
          if (retryable) this.log("error", "poster request failed", { method, code: pe.code, attempt, ms: Date.now() - started });
          throw pe;
        }
        this.log("warn", "poster retry", { method, code: pe.code, attempt });
        await this.sleep(300 * 2 ** (attempt - 1));
      }
    }
  }

  async findClientsByPhone(phone: string): Promise<PosterClientRecord[]> {
    // Poster matches `phone` by prefix, so callers must filter for an exact phone_number.
    return (await this.request<PosterClientRecord[]>("clients.getClients", { phone, num: 50, offset: 0 })) ?? [];
  }

  async getClient(clientId: number): Promise<PosterClientRecord | null> {
    try {
      const res = await this.request<PosterClientRecord[]>("clients.getClient", { client_id: clientId });
      return res?.[0] ?? null;
    } catch (err) {
      if (err instanceof PosterError && (err.code === 32 || err.code === 404)) return null;
      throw err;
    }
  }

  async createClient(input: CreateClientInput): Promise<number> {
    return Number(await this.request<number | string>("clients.createClient", {}, input));
  }

  async changeClientBonus(clientId: number, amountUah: number): Promise<number> {
    return Number(await this.request<number | string>("clients.changeClientBonus", {}, { client_id: clientId, count: amountUah }));
  }

  async getClientTransactions(clientId: number, dateFrom: string, dateTo: string): Promise<PosterTransaction[]> {
    return (
      (await this.request<PosterTransaction[]>("dash.getTransactions", {
        type: "clients",
        id: clientId,
        dateFrom,
        dateTo,
        status: 2,
        timezone: "client",
      })) ?? []
    );
  }
}

function toPosterError(err: unknown, method: string): PosterError {
  if (err instanceof PosterError) return err;
  // Deliberately not propagating the original message: fetch errors can echo the URL (token, phone).
  const name = err instanceof Error ? err.name : "";
  if (name === "TimeoutError" || name === "AbortError") return new PosterError("Poster timeout", "timeout", method);
  return new PosterError("Poster network error", "network", method);
}
