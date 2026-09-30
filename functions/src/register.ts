import { MSG, UserError } from "./errors.js";
import { enforceRate, findClientByPhone, getMyLoyalty, safeWelcome, type Deps, type LoyaltyResult } from "./loyalty.js";
import { toPosterPhone } from "./phone.js";
import { PosterError } from "./poster/client.js";

/** «Нові клієнти бонуси» — bonus program 1%, 100 ₴ on birthday (confirmed by the owner). */
export const WEB_CLIENT_GROUP_ID = 2;

export interface RegisterInput {
  name: string;
  birthday?: string;
}

const NAME_RE = /^\p{L}[\p{L}\s'’ʼ-]*$/u;

export function validateRegisterInput(raw: unknown, now: Date): Required<Pick<RegisterInput, "name">> & { birthday?: string } {
  const r = (raw ?? {}) as Record<string, unknown>;
  const name = typeof r.name === "string" ? r.name.trim().replace(/\s+/g, " ") : "";
  if (name.length < 2 || name.length > 50 || !NAME_RE.test(name)) throw new UserError("invalid-argument", MSG.badName);

  if (r.birthday === undefined || r.birthday === null || r.birthday === "") return { name };
  if (typeof r.birthday !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(r.birthday)) throw new UserError("invalid-argument", MSG.badBirthday);
  const d = new Date(r.birthday + "T00:00:00Z");
  const [y, m, day] = r.birthday.split("-").map(Number);
  const valid = d.getUTCFullYear() === y && d.getUTCMonth() + 1 === m && d.getUTCDate() === day;
  const age = now.getUTCFullYear() - y;
  if (!valid || d > now || age < 5 || age > 110) throw new UserError("invalid-argument", MSG.badBirthday);
  return { name, birthday: r.birthday };
}

/**
 * Creates the Poster client for the verified phone (or links an existing one) and stores uid → client_id.
 * Poster itself adds its configured welcome bonus (50 ₴) on creation.
 */
export async function registerMe(uid: string, digits: string, raw: unknown, deps: Deps): Promise<{ created: boolean; loyalty: LoyaltyResult }> {
  const now = deps.now();
  const input = validateRegisterInput(raw, now);
  await enforceRate(deps.store, uid, "register", now);

  let created = false;
  let client = await findClientByPhone(deps.poster, digits, deps);
  let clientId = client ? Number(client.client_id) : 0;
  if (!client) {
    try {
      clientId = await deps.poster.createClient({
        client_name: input.name,
        client_groups_id_client: WEB_CLIENT_GROUP_ID,
        phone: toPosterPhone(digits),
        card_number: digits,
        ...(input.birthday ? { birthday: input.birthday } : {}),
      });
      created = true;
    } catch (err) {
      // 99 = duplicate: someone registered this phone at the till in the meantime.
      if (!(err instanceof PosterError && err.code === 99)) throw err;
      client = await findClientByPhone(deps.poster, digits, deps);
      if (!client) throw err;
      clientId = Number(client.client_id);
    }
  }

  await deps.store.setProfile(uid, { posterClientId: clientId, source: created ? "created" : "linked", createdAt: now });
  if (!created) await safeWelcome(uid, clientId, "linked", deps); // created ones got Poster's own welcome bonus
  await deps.store.clearCache(uid);
  deps.log("info", created ? "poster client created" : "poster client linked", { clientId });
  return { created, loyalty: await getMyLoyalty(uid, digits, deps) };
}
