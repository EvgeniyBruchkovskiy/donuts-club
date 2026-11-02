# Donuts Post — відкладені публікації в Instagram і Threads

iOS-застосунок `ios/DonutsPost` (лише для команди, вхід за PIN) + Cloud Functions `socialAction` і `socialPublisher`.

```
iPhone ──PIN──▶ socialAction ──▶ Firestore socialPosts/{id}
   │                                   ▲
   └──PUT (signed URL)──▶ gs://named-vine-322614-social/social/{draft}/n.jpg|mp4
                                       │
socialPublisher (щохвилини) ──signed GET URL──▶ Instagram API / Threads API
```

- Медіа завантажуються з телефона прямо в приватний бакет за підписаними посиланнями (30 хв).
- Щохвилини `socialPublisher` бере пости, час яких настав, створює контейнери Meta, чекає обробки
  відео (між тіками стан зберігається) і публікує. Після успіху оригінали видаляються, мініатюра лишається.
- Невдала платформа не зупиняє іншу; «Повторити» перезапускає лише невдалі.
- Збій посеред виклику publish позначається як помилка «невідомо, чи вийшло» — подвійних публікацій немає.
- Токени Meta (60 днів) живуть у `socialConfig/accounts` і продовжуються кожні 5 днів (перевірка щогодини).

Формати: фото, карусель (2–10), Reels/відео, сторіс (лише Instagram), текст (лише Threads).

## 1. Firebase (Cloud Shell, один раз)

```bash
bash scripts/social-infra.sh   # бакет, правило 90 днів, IAM для підписаних посилань

firebase functions:secrets:set SOCIAL_PIN --project=named-vine-322614     # PIN застосунку (не PIN баристи)
firebase deploy --only functions:socialAction,functions:socialPublisher --project=named-vine-322614
```

Вартість: бакет у europe-central2 майже порожній (файли видаляються після публікації),
`socialPublisher` — третє завдання Cloud Scheduler (3 безкоштовні на білінг-акаунт), щохвилинний запит
читає лише пости, що чекають. У межах бюджету $5.

## 2. Meta for Developers (один раз)

Акаунт Instagram — професійний (бізнес/автор). Застосунок Meta лишається в режимі розробки:
для власних акаунтів з роллю тестувальника App Review не потрібен.

**Instagram**

1. https://developers.facebook.com/apps → Create app → use case
   «Manage messaging & content on Instagram» (Instagram API with Instagram login).
2. Permissions: `instagram_business_basic`, `instagram_business_content_publish`.
3. API setup with Instagram login → Generate access tokens → Add account → увійти в Instagram Donuts Club
   → Generate token → скопіювати.
4. Donuts Post → Налаштування → Instagram → Підключити → вставити токен.

**Threads** (Meta може вимагати окремий застосунок саме з цим use case)

1. Create app → use case «Access the Threads API».
2. Permissions: `threads_basic`, `threads_content_publish`.
3. App roles → Roles → Add people → Threads Tester → акаунт Donuts Club; прийняти запрошення в Threads:
   Налаштування → Акаунт → Дозволи вебсайтів → Запрошення.
4. Use cases → Threads API → Settings → User Token Generator → Generate access token → скопіювати.
5. Donuts Post → Налаштування → Threads → Підключити → вставити токен.

Якщо токен не продовжився (червоний напис у налаштуваннях) — згенеруйте новий і підключіть знову.

## 3. iOS-застосунок

```bash
cd ios/DonutsPost && xcodegen generate && open DonutsPost.xcodeproj
```

Team J9LW2QV3T6, bundle `ua.kr.donutsclub.post`. Встановлення: Xcode → свій iPhone, або Archive → TestFlight
(Internal testing, без рев'ю Apple). Іконка: `PW_CHANNEL=chrome node scripts/gen-ios-icon.mjs`.
Debug-збірка з аргументом `-demo` показує екрани на прикладах без сервера.
