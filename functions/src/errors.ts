/** Errors the callable layer turns into HttpsError with a Ukrainian message for the UI. */
export class UserError extends Error {
  constructor(
    readonly code: "invalid-argument" | "failed-precondition" | "resource-exhausted" | "unavailable",
    message: string,
  ) {
    super(message);
    this.name = "UserError";
  }
}

export const MSG = {
  unsupportedPhone: "Підтримуються лише українські номери телефону.",
  tooManyRequests: "Забагато запитів. Спробуйте за хвилину.",
  posterDown: "Сервіс бонусів тимчасово недоступний. Спробуйте пізніше.",
  badName: "Вкажіть ім'я (від 2 до 50 літер).",
  badBirthday: "Перевірте дату народження.",
  badRating: "Оцініть, будь ласка, обидва пункти — від 1 до 5 зірок.",
  badComment: "Коментар задовгий — до 1000 символів.",
  badPin: "Невірний PIN.",
  staffLocked: "Забагато невдалих спроб. Спробуйте через 15 хвилин.",
  badAction: "Невідома дія.",
} as const;
