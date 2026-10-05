export interface SubmitResult {
  promo?: { code: string; expiresAt: string; repeat: boolean };
  nextPromoAt?: string;
}

export const RATING_WORDS = ["", "Дуже погано", "Погано", "Нормально", "Добре", "Чудово!"] as const;

const dateFmt = new Intl.DateTimeFormat("uk-UA", { day: "numeric", month: "long", timeZone: "Europe/Kyiv" });

/** ISO → "4 листопада" (Kyiv). */
export function shortDate(iso: string): string {
  return dateFmt.format(new Date(iso));
}

/** Closing words when there is no code to show: a low score gets an apology and a promise, a high one — warm thanks. */
export function thanksCopy(unhappy: boolean, withContacts: boolean): { icon: string; title: string; text: string } {
  if (unhappy) {
    return {
      icon: "🙏",
      title: "Дякуємо за чесність",
      text:
        "Нам дуже шкода, що цього разу щось було не так. Ваш відгук уже отримала наша команда — ми розберемося і виправимо." +
        (withContacts ? " Якщо знадобляться деталі — зателефонуємо." : " Сподіваємося, наступного разу ви побачите різницю 🍩"),
    };
  }
  return {
    icon: "💖",
    title: withContacts ? "Дякуємо за відгук!" : "Дякуємо, що ви з нами!",
    text: "Ваш відгук уже в нас — ми читаємо кожен. Раді, що вам сподобалось, і чекаємо знову на каву з пончиком ☕",
  };
}
