import type { AwardDeps, AwardResult } from "./award.js";
import { awardOnce } from "./award.js";
import { parseRules } from "./rules.js";

/**
 * «Welcome to the online club»: once per person, only for clients who already existed in Poster
 * (source "linked"). Clients created from the site already get Poster's own welcome bonus.
 */
export async function maybeWelcome(uid: string, clientId: number, source: "created" | "linked", deps: AwardDeps): Promise<AwardResult | "disabled" | "not-eligible"> {
  if (source !== "linked") return "not-eligible";
  const { rules, problems } = parseRules(await deps.store.getBonusRulesRaw());
  if (problems.length) deps.log("error", "invalid config/bonusRules — rule disabled", { problems });
  if (!rules.welcome.enabled) return "disabled";
  return awardOnce({ uid, clientId, rule: "welcome", period: "once", amountUah: rules.welcome.amountUah }, deps);
}
