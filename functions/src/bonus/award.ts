import { PosterError } from "../poster/client.js";
import type { PosterApi } from "../poster/types.js";
import type { Store } from "../store.js";
import { ledgerKey, type RuleName } from "./rules.js";

export interface AwardDeps {
  poster: PosterApi;
  store: Store;
  now: () => Date;
  log: (level: "info" | "warn" | "error", message: string, data: Record<string, unknown>) => void;
}

export interface AwardRequest {
  uid: string;
  clientId: number;
  rule: RuleName;
  period: string;
  amountUah: number;
}

export type AwardResult = "awarded" | "already" | "failed" | "uncertain";

/**
 * Credits Poster bonuses at most once per ledger key:
 *   1. atomically claim `bonusLedger/{key}` (status "pending"); if it exists — stop;
 *   2. call clients.changeClientBonus;
 *   3. mark "done". A definite Poster rejection marks "failed" (may be retried later);
 *      a timeout / network / 5xx marks "uncertain" — never retried automatically, because
 *      the bonus may already be credited. Those need a manual look (logged as error).
 */
export async function awardOnce(req: AwardRequest, deps: AwardDeps): Promise<AwardResult> {
  const key = ledgerKey(req.uid, req.rule, req.period);
  const claimed = await deps.store.claimLedger(key, {
    uid: req.uid,
    clientId: req.clientId,
    rule: req.rule,
    period: req.period,
    amountUah: req.amountUah,
    createdAt: deps.now(),
  });
  if (!claimed) return "already";

  try {
    const balance = await deps.poster.changeClientBonus(req.clientId, req.amountUah);
    await deps.store.finishLedger(key, { status: "done", finishedAt: deps.now(), newBalanceUah: balance });
    deps.log("info", "bonus awarded", { rule: req.rule, period: req.period, clientId: req.clientId, amountUah: req.amountUah });
    return "awarded";
  } catch (err) {
    const definite = err instanceof PosterError && typeof err.code === "number";
    const code = err instanceof PosterError ? err.code : "unknown";
    await deps.store.finishLedger(key, { status: definite ? "failed" : "uncertain", finishedAt: deps.now(), error: String(code) });
    deps.log(definite ? "warn" : "error", definite ? "bonus rejected by poster" : "bonus outcome uncertain — check manually", {
      rule: req.rule,
      period: req.period,
      clientId: req.clientId,
      code,
    });
    return definite ? "failed" : "uncertain";
  }
}
