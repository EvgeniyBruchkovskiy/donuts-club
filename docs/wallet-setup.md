# Карта лояльности в Apple Wallet и Google Wallet

## Как это работает

- В кабинете (`/account`) две кнопки: «Додати в Apple Wallet» и «Додати в Google Wallet».
  Они вызывают callable `createWalletLink` и открывают ссылку, которую он вернул.
- **Apple:** ссылка ведёт на `appleWallet/download/{token}` (живёт 10 минут). Оттуда скачивается
  подписанный `.pkpass`. Затем iPhone регистрируется в веб-сервисе `appleWallet/v1/...` и сам
  забирает новые версии карты после push-уведомления.
- **Google:** ссылка `pay.google.com/gp/v/save/<JWT>`, подписанная ключом сервисного аккаунта.
  После изменений объект `loyaltyObject` обновляется через REST API.
- **Когда обновляется баланс:**
  - задача `walletSync` раз в 5 минут с 07:00 до 22:55 (по Киеву) берёт из Poster чеки,
    закрытые с прошлого запуска, и обновляет карты этих клиентов;
  - в 10:00 она обновляет все карты, чтобы подтянуть начисления без чека (например,
    бонус на день рождения от самого Poster);
  - каждый вход в кабинет тоже обновляет карту.

  Apple показывает уведомление «Бонусів на рахунку: …» на экране блокировки.
- Данные в Firestore: `walletPasses`, `walletDownloads`, `walletRegistrations`, `config/walletSync`.
  Клиентам все эти коллекции закрыты.

## Что нужно один раз (все команды — в Cloud Shell, проект `named-vine-322614`)

### Apple (нужен аккаунт Apple Developer)

1. developer.apple.com → Certificates, IDs & Profiles → Identifiers → «+» → **Pass Type IDs**.
   Description: `DONUTS CLUB card`, Identifier: `pass.ua.kr.donutsclub.card`.
2. Создать ключ и CSR в Cloud Shell. Ключ никуда не уходит, хранится только в Secret Manager:
   ```bash
   mkdir -p /tmp/wallet && cd /tmp/wallet
   openssl genrsa -out pass.key 2048
   openssl req -new -key pass.key -out pass.csr -subj "/CN=DONUTS CLUB Pass/C=UA"
   ```
   Скачать `pass.csr` (Cloud Shell → ⋮ → Download).
3. Открыть созданный Pass Type ID → **Create Certificate** → загрузить `pass.csr` → скачать `pass.cer`
   → загрузить его в Cloud Shell (⋮ → Upload) в `/tmp/wallet`.
4. Сохранить сертификат и ключ в секреты и удалить файлы:
   ```bash
   openssl x509 -inform der -in pass.cer -out pass.pem
   firebase functions:secrets:set APPLE_PASS_CERT --data-file pass.pem --project named-vine-322614
   firebase functions:secrets:set APPLE_PASS_KEY --data-file pass.key --project named-vine-322614
   rm -rf /tmp/wallet
   ```
5. Team ID: developer.apple.com → Membership details.

Сертификат действует год. За месяц до окончания нужно повторить шаги 2–4 (Pass Type ID остаётся прежним).
Промежуточный сертификат Apple WWDR G4 публичный и лежит в `functions/assets/wallet/AppleWWDRCAG4.crt`
(действует до 2030 года).

### Google (Google Pay & Wallet Console)

1. pay.google.com/business/console → **Google Wallet API**. Скопировать **Issuer ID**.
2. Включить API и создать сервисный аккаунт без ролей с JSON-ключом:
   ```bash
   gcloud services enable walletobjects.googleapis.com --project named-vine-322614
   gcloud iam service-accounts create donuts-wallet --display-name "DONUTS CLUB Wallet" --project named-vine-322614
   gcloud iam service-accounts keys create /tmp/wallet-key.json --iam-account donuts-wallet@named-vine-322614.iam.gserviceaccount.com
   firebase functions:secrets:set GOOGLE_WALLET_KEY --data-file /tmp/wallet-key.json --project named-vine-322614
   rm /tmp/wallet-key.json
   ```
3. В Wallet Console → **Users** → пригласить `donuts-wallet@named-vine-322614.iam.gserviceaccount.com`
   с ролью **Developer**.
4. Пока Google не одобрил аккаунт, карту могут сохранить только тестовые аккаунты, добавленные в
   Wallet Console. Чтобы карта работала у всех, в консоли нужно запросить **Publishing access**
   (Google проверяет класс карты, обычно несколько дней).

### Идентификаторы и деплой

1. Вписать в `functions/.env` значения `APPLE_PASS_TYPE_ID`, `APPLE_TEAM_ID` и `GOOGLE_WALLET_ISSUER_ID`.
   Это не секреты, файл хранится в git.
2. Задеплоить: `firebase deploy --only functions,hosting:donuts-club-krop`.
   В hosting лежат картинки для Google (`/img/wallet/*.png`).

⚠️ Секреты `APPLE_PASS_CERT`, `APPLE_PASS_KEY` и `GOOGLE_WALLET_KEY` подключены к `getMyLoyalty`.
Если хотя бы одного из них нет в Secret Manager, деплой функций упадёт. Поэтому в `main` вливаем
только после того, как созданы все три.

## Проверка после деплоя

- Логи `walletSync`: при работающей синхронизации там есть записи `wallet sync` с числом обновлённых карт.
  Вызов `dash.getTransactions` без `type` на живом аккаунте ещё не проверялся. Если Poster вернёт
  ошибку, она будет в логах как `poster api error`.
- iPhone: кнопка → «Добавить» → карта в Wallet. После покупки в течение 5 минут приходит
  уведомление с новым балансом.
- Android: кнопка → «Сохранить» → карта в Google Wallet, баланс обновляется так же.

## Картинки

`node scripts/gen-wallet-assets.mjs` генерирует иконку, логотип и полосу с пончиками для Apple
(`functions/assets/wallet`), а также логотип и hero-картинку для Google (`web/public/img/wallet`).
Изменения дизайна класса Google (цвет, логотип) применяются только к новому классу: существующий
класс функция не перезаписывает, потому что он мог уже пройти проверку. Менять его нужно в Wallet Console.
