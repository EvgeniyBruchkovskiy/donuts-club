import type { PosterClientRecord } from "../poster/types.js";
import type { AwardDeps, AwardResult } from "./award.js";
import { awardOnce } from "./award.js";
import { parseRules } from "./rules.js";

/** Kyiv calendar date parts. */
export function kyivDate(d: Date): { year: string; mmdd: string } {
  const p = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Kyiv", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(d);
  const get = (t: string) => p.find((x) => x.type === t)!.value;
  return { year: get("year"), mmdd: get("month") + get("day") };
}

const isLeap = (y: number) => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;

/** Birthdays celebrated today: Feb 29 birthdays move to Feb 28 in non-leap years. */
export function birthdayQueries(year: string, mmdd: string): string[] {
  return mmdd === "0228" && !isLeap(Number(year)) ? ["0228", "0229"] : [mmdd];
}

/** Poster already congratulates this client (its group has a birthday bonus) — skip to avoid doubling. */
export function posterHandlesBirthday(c: PosterClientRecord): boolean {
  return (Number(c.birthday_bonus) || 0) > 0;
}

export interface BirthdayReport {
  enabled: boolean;
  candidates: number;
  results: Partial<Record<AwardResult | "skipped-poster-bonus" | "skipped-not-on-site", number>>;
}

/** Daily job: credit the birthday rule to site members whose birthday is today (Kyiv). */
export async function runBirthdayBonuses(deps: AwardDeps): Promise<BirthdayReport> {
  const { rules, problems } = parseRules(await deps.store.getBonusRulesRaw());
  if (problems.length) deps.log("error", "invalid config/bonusRules — rule disabled", { problems });
  const report: BirthdayReport = { enabled: rules.birthday.enabled, candidates: 0, results: {} };
  if (!rules.birthday.enabled) return report;

  const bump = (k: keyof BirthdayReport["results"]) => (report.results[k] = (report.results[k] ?? 0) + 1);
  const { year, mmdd } = kyivDate(deps.now());
  const seen = new Set<string>();
  for (const q of birthdayQueries(year, mmdd)) {
    for (const c of await deps.poster.findClientsByBirthday(q)) {
      if (seen.has(c.client_id) || c.delete === "1" || c.birthday.slice(5).replace("-", "") !== q) continue;
      seen.add(c.client_id);
      report.candidates++;
      if (posterHandlesBirthday(c)) {
        bump("skipped-poster-bonus");
        continue;
      }
      const uid = await deps.store.findUidByClientId(Number(c.client_id));
      if (!uid) {
        bump("skipped-not-on-site");
        continue;
      }
      bump(await awardOnce({ uid, clientId: Number(c.client_id), rule: "birthday", period: year, amountUah: rules.birthday.amountUah }, deps));
    }
  }
  deps.log("info", "birthday bonuses run", { ...report, day: mmdd });
  return report;
}
