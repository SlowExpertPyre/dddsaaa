# 🤖 Telegram Shop Bot — Реферальная система + Магазин

Полноценный Telegram-бот на Next.js с магазином, реферальной системой и несколькими способами оплаты.

## 🚀 Быстрый запуск (Windows)

Просто запустите `start.bat` — он сам установит зависимости, применит схему БД и запустит бот.

```
start.bat
```

---

## ⚙️ Настройка .env

Скопируйте `.env.example` в `.env` и заполните:

| Переменная | Описание |
|-----------|----------|
| `TELEGRAM_BOT_TOKEN` | Токен от @BotFather |
| `TELEGRAM_BOT_USERNAME` | Username бота (без @) |
| `ADMIN_TELEGRAM_IDS` | Ваш Telegram ID (узнайте через @userinfobot) |
| `STARS_RECIPIENT_USERNAME` | Username аккаунта для получения Stars |
| `FRAGMENT_RATE_RUB` | Курс Fragment (₽ за 1 ⭐), актуальный на fragment.com/stars |
| `PLATIKA_SHOP_ID` | ID магазина на platika.ru (для СБП) |
| `PLATIKA_SECRET_KEY` | Секретный ключ Platika |
| `CRYPTOBOT_TOKEN` | Токен от @CryptoBot → /pay |
| `USD_TO_RUB_RATE` | Курс доллара для конвертации в USDT |
| `WEBHOOK_BASE_URL` | HTTPS URL вашего сервера |
| `DATABASE_URL` | Строка подключения PostgreSQL |

---

## 🛒 Команды бота

### Для пользователей:
- `/start` — запуск бота + ваша реферальная ссылка
- `/shop` — каталог товаров с кнопками оплаты
- `/mylink` — ваша реферальная ссылка со статистикой
- `/mystats` — ваш заработок от рефералов
- `/statistics` — топ-5 по заработку

### Для администратора:
- `/admin` — главная панель управления
- `/admin_products` — список товаров
- `/admin_add_product` — добавить товар (пошаговый мастер)
- `/admin_del_product [id]` — удалить товар
- `/admin_orders` — последние заказы
- `/admin_stats` — полная статистика
- `/admin_users` — все пользователи
- `/admin_links` — реферальные ссылки
- `/admin_purchases` — покупки
- `/admin_top` — топ по заработку
- `/admin_confirm_order [id]` — подтвердить оплату вручную
- `/admin_add_purchase [userId] [сумма] [описание]` — ручная покупка

---

## 💳 Способы оплаты

### 1. СБП (Platika)
- Платёж создаётся автоматически
- Webhook на `/api/payment/sbp` автоматически подтверждает оплату
- Покупатель получает ссылку/контент сразу после оплаты

### 2. CryptoBot (USDT и другие криптовалюты)
- Webhook на `/api/payment/cryptobot` с проверкой подписи HMAC-SHA256
- Авторассылка товара после подтверждения платежа

### 3. Звёзды по юзернейму (через Fragment)
- Показывает точное количество звёзд с учётом комиссии Fragment (7%)
- Округление вниз до × 50
- Администратор подтверждает оплату вручную через inline-кнопки

### 4. Оплата подарками (Stars)
- Учитывает двойную комиссию: Fragment (7%) + Telegram (30% при конвертации подарков в ⭐)
- Формула: `звёзды = (сумма / курс) × 1 / (0.93 × 0.70)`
- Округление вниз до × 50

---

## 📦 Типы товаров

### Одноразовая ссылка в канал (`invite_link`)
- После оплаты бот автоматически создаёт одноразовую ссылку
- Ссылка действительна только для 1 пользователя
- **Важно:** бот должен быть администратором в целевом канале/группе!

### Цифровой контент (`digital`)
- Текст, инструкция, код — что угодно
- Отправляется пользователю сразу после подтверждения оплаты

---

## 🔗 Настройка Webhook

### Для production (VPS/сервер):
```bash
# Установить webhook
curl -X POST https://your-domain.com/api/telegram/webhook-setup \
  -H "Content-Type: application/json" \
  -d '{"webhookUrl": "https://your-domain.com/api/telegram"}'
```

### Для локальной разработки (ngrok):
```bash
# Установите ngrok: https://ngrok.com
ngrok http 3000

# Скопируйте https URL и установите в .env:
WEBHOOK_BASE_URL=https://xxxx.ngrok.io

# Затем запустите настройку webhook:
curl -X POST http://localhost:3000/api/telegram/webhook-setup \
  -H "Content-Type: application/json" \
  -d '{"webhookUrl": "https://xxxx.ngrok.io/api/telegram"}'
```

---

## 🏗️ Архитектура

```
src/
├── app/
│   ├── api/
│   │   ├── telegram/
│   │   │   ├── route.ts              # Telegram webhook
│   │   │   └── webhook-setup/route.ts # Установка webhook
│   │   ├── payment/
│   │   │   ├── cryptobot/route.ts    # CryptoBot webhook
│   │   │   └── sbp/route.ts          # Platika SBP webhook
│   │   ├── admin/
│   │   │   ├── stats/route.ts
│   │   │   ├── users/route.ts
│   │   │   └── purchase/route.ts
│   │   └── health/route.ts
│   ├── page.tsx                      # Веб-панель управления
│   ├── layout.tsx
│   └── globals.css
├── db/
│   ├── index.ts                      # Подключение к PostgreSQL
│   └── schema.ts                     # Схема таблиц
└── lib/
    └── bot/
        ├── bot.ts                    # Логика бота (Telegraf)
        └── helpers.ts                # Вспомогательные функции
```

---

## 🔄 Реферальная система

- При регистрации через реферальную ссылку пользователь привязывается к рефереру
- При каждой покупке реферера начисляется **50% комиссии** рефереру
- Реферер получает уведомление о комиссии в DM
- Статистика: `/mystats`
- Лидерборд: `/statistics`

---

## 📊 API эндпоинты

| Метод | URL | Описание |
|-------|-----|----------|
| POST | `/api/telegram` | Telegram webhook |
| GET/POST | `/api/telegram/webhook-setup` | Настройка webhook |
| POST | `/api/payment/cryptobot` | CryptoBot webhook |
| POST | `/api/payment/sbp` | Platika SBP webhook |
| GET | `/api/admin/stats` | Статистика (JSON) |
| GET | `/api/admin/users` | Пользователи (JSON) |
| POST | `/api/admin/purchase` | Ручная покупка |
| GET | `/api/health` | Health check |
