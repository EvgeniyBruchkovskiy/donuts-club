export const RATING_WORDS = ["", "Дуже погано", "Погано", "Нормально", "Добре", "Чудово!"] as const;

/** Closing words: a low score gets an apology and a promise, a high one — warm thanks. */
export function thanksCopy(unhappy: boolean, withContacts: boolean): { icon: string; title: string; text: string } {
  if (unhappy) {
    return {
      icon: "🙏",
      title: "Дякуємо за чесність",
      text:
        "Нам дуже шкода, що цього разу щось було не так. Ваш відгук уже отримала наша команда — ми розберемося і виправимо." +
        (withContacts ? " Якщо знадобляться деталі — зв'яжемося з вами." : " Сподіваємося, наступного разу ви побачите різницю 🍩"),
    };
  }
  return {
    icon: "💖",
    title: "Дякуємо, що ви з нами!",
    text: "Ваш відгук уже в нас — ми читаємо кожен. Раді, що вам сподобалось, і чекаємо знову на каву з пончиком ☕",
  };
}
