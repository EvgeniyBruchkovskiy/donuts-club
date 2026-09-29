/** Firebase Auth / Functions error → message for the UI (Ukrainian). */
const AUTH: Record<string, string> = {
  "auth/invalid-phone-number": "Перевірте номер телефону.",
  "auth/missing-phone-number": "Введіть номер телефону.",
  "auth/too-many-requests": "Забагато спроб. Спробуйте трохи пізніше.",
  "auth/quota-exceeded": "Ліміт SMS вичерпано. Спробуйте пізніше.",
  "auth/invalid-verification-code": "Невірний код. Перевірте SMS і спробуйте ще раз.",
  "auth/missing-verification-code": "Введіть код з SMS.",
  "auth/code-expired": "Код застарів. Надішліть новий.",
  "auth/session-expired": "Код застарів. Надішліть новий.",
  "auth/captcha-check-failed": "Не вдалося пройти перевірку. Оновіть сторінку і спробуйте ще раз.",
  "auth/network-request-failed": "Немає з'єднання з інтернетом.",
  "auth/operation-not-allowed": "Вхід за цим номером недоступний. Підтримуються лише українські номери.",
  "auth/user-disabled": "Цей акаунт заблоковано.",
};

const FUNCTIONS: Record<string, string> = {
  "functions/unauthenticated": "Сесія завершилась. Увійдіть ще раз.",
  "functions/permission-denied": "Немає доступу. Оновіть сторінку.",
  "functions/resource-exhausted": "Забагато запитів. Спробуйте за хвилину.",
  "functions/unavailable": "Сервіс бонусів тимчасово недоступний. Спробуйте пізніше.",
  "functions/deadline-exceeded": "Сервіс відповідає занадто довго. Спробуйте ще раз.",
  "functions/internal": "Щось пішло не так. Спробуйте пізніше.",
};

export function errorMessage(err: unknown): string {
  const e = err as { code?: string; message?: string };
  const code = e?.code ?? "";
  if (AUTH[code]) return AUTH[code];
  // Server-side HttpsError messages (invalid-argument, failed-precondition…) are already Ukrainian.
  if ((code === "functions/invalid-argument" || code === "functions/failed-precondition") && e.message) return e.message;
  if (FUNCTIONS[code]) return FUNCTIONS[code];
  return "Щось пішло не так. Спробуйте ще раз.";
}
