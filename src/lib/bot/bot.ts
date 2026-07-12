import { Telegraf, Context, Markup } from "telegraf";
import axios from "axios";
import {
  getOrCreateUser,
  getUserByTelegramId,
  getReferralLink,
  getAllReferralLinksWithStats,
  getTopEarners,
  getEarningsByTelegramId,
  getTotalStats,
  getAllUsers,
  recordPurchase,
  logAction,
  formatMoney,
  displayName,
  incrementLinkClick,
  getRecentPurchases,
  getActiveProducts,
  getProductById,
  createProduct,
  updateProduct,
  deleteProduct,
  createOrder,
  getRecentOrders,
  getUserState,
  setUserState,
  clearUserState,
  calcStarsByUsername,
  calcStarsByGift,
} from "./helpers";

const TOKEN = process.env.TELEGRAM_BOT_TOKEN ?? "";
const ADMIN_IDS = (process.env.ADMIN_TELEGRAM_IDS ?? "")
  .split(",")
  .map((s) => parseInt(s.trim()))
  .filter((n) => !isNaN(n) && n > 0);
const BOT_USERNAME = process.env.TELEGRAM_BOT_USERNAME ?? "myrefbot";

// Юзернейм/ID аккаунта куда слать звёзды (настраивается через конфиг)
const STARS_RECIPIENT_USERNAME = process.env.STARS_RECIPIENT_USERNAME ?? "";
// Курс Fragment: сколько рублей стоит 1 звезда (по умолчанию ~1.12 ₽)
const FRAGMENT_RATE = parseFloat(process.env.FRAGMENT_RATE_RUB ?? "1.12");

// CryptoBot
const CRYPTOBOT_TOKEN = process.env.CRYPTOBOT_TOKEN ?? "";
const CRYPTOBOT_API = "https://pay.crypt.bot/api";

// Плати (SBP)
const PLATIKA_SHOP_ID = process.env.PLATIKA_SHOP_ID ?? "";
const PLATIKA_SECRET_KEY = process.env.PLATIKA_SECRET_KEY ?? "";
const WEBHOOK_BASE_URL = process.env.WEBHOOK_BASE_URL ?? "";

function isAdmin(telegramId: number): boolean {
  return ADMIN_IDS.includes(telegramId);
}

const MEDALS = ["🥇", "🥈", "🥉", "4️⃣", "5️⃣"];

// ─── CryptoBot helpers ───────────────────────────────────────────────────────

async function createCryptoBotInvoice(
  amount: number,
  currency: string,
  description: string,
  payload: string
): Promise<{ invoiceUrl: string; invoiceId: string } | null> {
  if (!CRYPTOBOT_TOKEN) return null;
  try {
    const res = await axios.post(
      `${CRYPTOBOT_API}/createInvoice`,
      {
        asset: currency,
        amount: amount.toString(),
        description,
        payload,
        paid_btn_name: "callback",
        paid_btn_url: `${WEBHOOK_BASE_URL}/api/payment/cryptobot`,
      },
      { headers: { "Crypto-Pay-API-Token": CRYPTOBOT_TOKEN } }
    );
    const inv = res.data.result;
    return { invoiceUrl: inv.pay_url, invoiceId: String(inv.invoice_id) };
  } catch (e) {
    console.error("CryptoBot error:", e);
    return null;
  }
}

// ─── Плати (СБП) helpers ─────────────────────────────────────────────────────

async function createPlatikaSBPInvoice(
  amount: number,
  orderId: string,
  description: string
): Promise<{ paymentUrl: string; paymentId: string } | null> {
  if (!PLATIKA_SHOP_ID || !PLATIKA_SECRET_KEY) return null;
  try {
    const res = await axios.post(
      "https://api.platika.ru/v1/payment/create",
      {
        shop_id: PLATIKA_SHOP_ID,
        amount: Math.round(amount * 100), // в копейках
        order_id: orderId,
        description,
        payment_method: "sbp",
        callback_url: `${WEBHOOK_BASE_URL}/api/payment/sbp`,
        success_url: `https://t.me/${BOT_USERNAME}`,
        fail_url: `https://t.me/${BOT_USERNAME}`,
      },
      {
        headers: {
          "X-Api-Key": PLATIKA_SECRET_KEY,
          "Content-Type": "application/json",
        },
      }
    );
    return {
      paymentUrl: res.data.payment_url,
      paymentId: res.data.payment_id,
    };
  } catch (e) {
    console.error("Platika SBP error:", e);
    return null;
  }
}

// ─── Главная функция создания бота ───────────────────────────────────────────

export function createBot() {
  if (!TOKEN) {
    console.warn("TELEGRAM_BOT_TOKEN не задан — бот не запустится");
    return null;
  }

  const bot = new Telegraf(TOKEN);

  // ─── /start ──────────────────────────────────────────────────────────────
  bot.start(async (ctx) => {
    const { id, username, first_name, last_name } = ctx.from;
    const payload = ctx.startPayload;

    if (payload) {
      await incrementLinkClick(payload).catch(() => {});
    }

    const user = await getOrCreateUser(id, username, first_name, last_name, payload || undefined);
    const link = await getReferralLink(id);
    const refUrl = link ? `https://t.me/${BOT_USERNAME}?start=${link.code}` : "—";

    const adminHint = isAdmin(id)
      ? `\n\n🔧 <b>Вы администратор</b>\nИспользуйте /admin для управления ботом.`
      : "";

    const msg =
      `👋 Привет, <b>${first_name}</b>!\n\n` +
      `🔗 Ваша реферальная ссылка:\n<code>${refUrl}</code>\n\n` +
      `📢 Делитесь ссылкой и получайте <b>50% комиссии</b> с каждой покупки ваших рефералов!\n\n` +
      `📋 Команды:\n` +
      `/shop — 🛒 Магазин товаров\n` +
      `/mylink — 🔗 Ваша реферальная ссылка\n` +
      `/mystats — 📈 Ваша статистика\n` +
      `/statistics — 🏆 Топ-5 по заработку` +
      adminHint;

    await ctx.replyWithHTML(msg);

    if (user.referredBy && payload) {
      const referrer = await getUserByTelegramId(user.referredBy);
      const referrerName = displayName(referrer?.username, referrer?.firstName);
      const newUserName = displayName(username, first_name);

      for (const adminId of ADMIN_IDS) {
        try {
          await ctx.telegram.sendMessage(
            adminId,
            `🆕 <b>Новый реферал!</b>\n\n` +
              `👤 Пользователь: ${newUserName} (<code>${id}</code>)\n` +
              `🔗 Пришёл от: <b>${referrerName}</b> (код: <code>${payload}</code>)\n` +
              `📅 ${new Date().toLocaleString("ru-RU")}`,
            { parse_mode: "HTML" }
          );
        } catch {
          // Администратор недоступен
        }
      }
    }
  });

  // ─── /shop — Каталог товаров ──────────────────────────────────────────────
  bot.command("shop", async (ctx) => {
    const { id, username, first_name } = ctx.from;
    await getOrCreateUser(id, username, first_name);

    const prods = await getActiveProducts();
    if (prods.length === 0) {
      await ctx.reply("🛒 Товаров пока нет. Загляните позже!");
      return;
    }

    await ctx.replyWithHTML(
      "🛒 <b>Наш магазин</b>\n\nВыберите товар:",
      Markup.inlineKeyboard(
        prods.map((p) => [
          Markup.button.callback(
            `${p.name} — ${formatMoney(p.price)}`,
            `product_${p.id}`
          ),
        ])
      )
    );
  });

  // ─── Просмотр товара ─────────────────────────────────────────────────────
  bot.action(/^product_(\d+)$/, async (ctx) => {
    await ctx.answerCbQuery();
    const productId = parseInt((ctx.match as RegExpMatchArray)[1]);
    const product = await getProductById(productId);

    if (!product || !product.isActive) {
      await ctx.reply("❌ Товар не найден или снят с продажи.");
      return;
    }

    const text =
      `📦 <b>${product.name}</b>\n\n` +
      (product.description ? `📝 ${product.description}\n\n` : "") +
      `💰 Цена: <b>${formatMoney(product.price)}</b>\n\n` +
      `Выберите способ оплаты:`;

    await ctx.replyWithHTML(
      text,
      Markup.inlineKeyboard([
        [Markup.button.callback("💳 СБП (Плати)", `pay_sbp_${productId}`)],
        [Markup.button.callback("🪙 CryptoBot (USDT)", `pay_crypto_${productId}`)],
        [Markup.button.callback("⭐ Звёзды по юзернейму", `pay_stars_username_${productId}`)],
        [Markup.button.callback("🎁 Оплата подарками (Stars)", `pay_stars_gift_${productId}`)],
        [Markup.button.callback("◀️ Назад", "back_to_shop")],
      ])
    );
  });

  bot.action("back_to_shop", async (ctx) => {
    await ctx.answerCbQuery();
    const prods = await getActiveProducts();
    if (prods.length === 0) {
      await ctx.reply("🛒 Товаров пока нет.");
      return;
    }
    await ctx.replyWithHTML(
      "🛒 <b>Наш магазин</b>\n\nВыберите товар:",
      Markup.inlineKeyboard(
        prods.map((p) => [
          Markup.button.callback(
            `${p.name} — ${formatMoney(p.price)}`,
            `product_${p.id}`
          ),
        ])
      )
    );
  });

  // ─── Оплата СБП ──────────────────────────────────────────────────────────
  bot.action(/^pay_sbp_(\d+)$/, async (ctx) => {
    await ctx.answerCbQuery();
    const productId = parseInt((ctx.match as RegExpMatchArray)[1]);
    const product = await getProductById(productId);
    if (!product) return;

    const { id: telegramId, username, first_name } = ctx.from;
    await getOrCreateUser(telegramId, username, first_name);

    const amount = parseFloat(product.price);
    const order = await createOrder({
      buyerTelegramId: telegramId,
      productId,
      amount,
      paymentMethod: "sbp",
    });

    if (!PLATIKA_SHOP_ID) {
      await ctx.replyWithHTML(
        `💳 <b>Оплата через СБП</b>\n\n` +
        `Товар: <b>${product.name}</b>\n` +
        `Сумма: <b>${formatMoney(amount)}</b>\n\n` +
        `⚠️ СБП пока не настроен. Обратитесь к администратору.\n` +
        `ID заказа: <code>${order.id}</code>`
      );
      return;
    }

    const invoice = await createPlatikaSBPInvoice(
      amount,
      `order_${order.id}`,
      `Оплата товара: ${product.name}`
    );

    if (!invoice) {
      await ctx.reply("❌ Ошибка создания платежа. Попробуйте позже.");
      return;
    }

    // Сохраним external ID
    const { db } = await import("@/db");
    const { orders: ordersTable } = await import("@/db/schema");
    const { eq } = await import("drizzle-orm");
    await db.update(ordersTable).set({ externalPaymentId: invoice.paymentId }).where(eq(ordersTable.id, order.id));

    await ctx.replyWithHTML(
      `💳 <b>Оплата через СБП</b>\n\n` +
      `Товар: <b>${product.name}</b>\n` +
      `Сумма: <b>${formatMoney(amount)}</b>\n\n` +
      `Нажмите кнопку ниже для оплаты:`,
      Markup.inlineKeyboard([
        [Markup.button.url("💳 Оплатить через СБП", invoice.paymentUrl)],
      ])
    );
  });

  // ─── Оплата CryptoBot ────────────────────────────────────────────────────
  bot.action(/^pay_crypto_(\d+)$/, async (ctx) => {
    await ctx.answerCbQuery();
    const productId = parseInt((ctx.match as RegExpMatchArray)[1]);
    const product = await getProductById(productId);
    if (!product) return;

    const { id: telegramId, username, first_name } = ctx.from;
    await getOrCreateUser(telegramId, username, first_name);

    const amountRub = parseFloat(product.price);
    const order = await createOrder({
      buyerTelegramId: telegramId,
      productId,
      amount: amountRub,
      paymentMethod: "cryptobot",
    });

    if (!CRYPTOBOT_TOKEN) {
      await ctx.replyWithHTML(
        `🪙 <b>Оплата через CryptoBot</b>\n\n` +
        `Товар: <b>${product.name}</b>\n` +
        `Сумма: <b>${formatMoney(amountRub)}</b>\n\n` +
        `⚠️ CryptoBot пока не настроен. Обратитесь к администратору.\n` +
        `ID заказа: <code>${order.id}</code>`
      );
      return;
    }

    // Конвертируем рубли в USDT (примерно, нужно настроить курс)
    const usdRate = parseFloat(process.env.USD_TO_RUB_RATE ?? "90");
    const amountUSDT = +(amountRub / usdRate).toFixed(2);

    const invoice = await createCryptoBotInvoice(
      amountUSDT,
      "USDT",
      `Оплата: ${product.name}`,
      `order_${order.id}`
    );

    if (!invoice) {
      await ctx.reply("❌ Ошибка создания платежа. Попробуйте позже.");
      return;
    }

    const { db } = await import("@/db");
    const { orders: ordersTable } = await import("@/db/schema");
    const { eq } = await import("drizzle-orm");
    await db.update(ordersTable).set({ externalPaymentId: invoice.invoiceId }).where(eq(ordersTable.id, order.id));

    await ctx.replyWithHTML(
      `🪙 <b>Оплата через CryptoBot</b>\n\n` +
      `Товар: <b>${product.name}</b>\n` +
      `Сумма: <b>${amountUSDT} USDT</b> (~${formatMoney(amountRub)})\n\n` +
      `Нажмите кнопку для оплаты:`,
      Markup.inlineKeyboard([
        [Markup.button.url("🪙 Оплатить в CryptoBot", invoice.invoiceUrl)],
      ])
    );
  });

  // ─── Оплата Stars по юзернейму (Fragment) ────────────────────────────────
  bot.action(/^pay_stars_username_(\d+)$/, async (ctx) => {
    await ctx.answerCbQuery();
    const productId = parseInt((ctx.match as RegExpMatchArray)[1]);
    const product = await getProductById(productId);
    if (!product) return;

    const { id: telegramId, username, first_name } = ctx.from;
    await getOrCreateUser(telegramId, username, first_name);

    const amountRub = parseFloat(product.price);
    const starsNeeded = calcStarsByUsername(amountRub, FRAGMENT_RATE);

    const order = await createOrder({
      buyerTelegramId: telegramId,
      productId,
      amount: amountRub,
      paymentMethod: "stars_username",
    });

    const recipient = STARS_RECIPIENT_USERNAME || "администратору";

    await ctx.replyWithHTML(
      `⭐ <b>Оплата звёздами (по юзернейму)</b>\n\n` +
      `Товар: <b>${product.name}</b>\n` +
      `Цена: <b>${formatMoney(amountRub)}</b>\n\n` +
      `📊 Расчёт:\n` +
      `• Курс Fragment: <b>${FRAGMENT_RATE} ₽/⭐</b>\n` +
      `• Комиссия Fragment: <b>7%</b>\n` +
      `• Итого звёзд: <b>${starsNeeded} ⭐</b>\n\n` +
      `📤 Отправьте <b>${starsNeeded} ⭐ звёзд</b> на аккаунт:\n` +
      `<b>@${recipient}</b>\n\n` +
      `📎 В комментарии укажите:\n` +
      `<code>order_${order.id}</code>\n\n` +
      `После подтверждения оплаты администратором вы получите доступ к товару.\n\n` +
      `ID заказа: <code>${order.id}</code>`,
      {
        reply_markup: Markup.inlineKeyboard([
          [Markup.button.url("⭐ Отправить звёзды", `https://t.me/${recipient}`)],
          [Markup.button.callback("✅ Я отправил, жду подтверждения", `stars_sent_${order.id}`)],
        ]).reply_markup,
      }
    );
  });

  // ─── Оплата Stars подарками ───────────────────────────────────────────────
  bot.action(/^pay_stars_gift_(\d+)$/, async (ctx) => {
    await ctx.answerCbQuery();
    const productId = parseInt((ctx.match as RegExpMatchArray)[1]);
    const product = await getProductById(productId);
    if (!product) return;

    const { id: telegramId, username, first_name } = ctx.from;
    await getOrCreateUser(telegramId, username, first_name);

    const amountRub = parseFloat(product.price);
    const starsNeeded = calcStarsByGift(amountRub, FRAGMENT_RATE);

    const order = await createOrder({
      buyerTelegramId: telegramId,
      productId,
      amount: amountRub,
      paymentMethod: "stars_gift",
    });

    const recipient = STARS_RECIPIENT_USERNAME || "администратору";

    await ctx.replyWithHTML(
      `🎁 <b>Оплата подарками (Stars)</b>\n\n` +
      `Товар: <b>${product.name}</b>\n` +
      `Цена: <b>${formatMoney(amountRub)}</b>\n\n` +
      `📊 Расчёт с учётом комиссий:\n` +
      `• Курс Fragment: <b>${FRAGMENT_RATE} ₽/⭐</b>\n` +
      `• Комиссия Fragment: <b>7%</b>\n` +
      `• Комиссия ТГ (конвертация подарков→⭐): <b>30%</b>\n` +
      `• Итого звёзд в подарках: <b>${starsNeeded} ⭐</b>\n\n` +
      `🎁 Отправьте подарки на сумму <b>${starsNeeded} ⭐</b> на аккаунт:\n` +
      `<b>@${recipient}</b>\n\n` +
      `📎 Подарки должны быть конвертируемые (с возможностью обмена на звёзды)\n\n` +
      `ID заказа: <code>${order.id}</code>`,
      {
        reply_markup: Markup.inlineKeyboard([
          [Markup.button.url("🎁 Отправить подарок", `https://t.me/${recipient}`)],
          [Markup.button.callback("✅ Я отправил подарок", `stars_sent_${order.id}`)],
        ]).reply_markup,
      }
    );
  });

  // ─── Подтверждение отправки Stars ────────────────────────────────────────
  bot.action(/^stars_sent_(\d+)$/, async (ctx) => {
    await ctx.answerCbQuery("✅ Заявка отправлена администратору!");
    const orderId = parseInt((ctx.match as RegExpMatchArray)[1]);

    const { id: telegramId, username, first_name } = ctx.from;

    await ctx.reply(
      `⏳ Ваша заявка на подтверждение оплаты отправлена.\n` +
      `ID заказа: <code>${orderId}</code>\n\n` +
      `Администратор проверит оплату и выдаст доступ.`,
      { parse_mode: "HTML" }
    );

    // Уведомить администраторов
    for (const adminId of ADMIN_IDS) {
      try {
        await ctx.telegram.sendMessage(
          adminId,
          `💰 <b>Заявка на подтверждение Stars-оплаты!</b>\n\n` +
          `👤 Пользователь: ${displayName(username, first_name)} (<code>${telegramId}</code>)\n` +
          `🆔 Заказ: <code>${orderId}</code>\n\n` +
          `Проверьте получение звёзд/подарков и подтвердите:`,
          {
            parse_mode: "HTML",
            reply_markup: Markup.inlineKeyboard([
              [Markup.button.callback("✅ Подтвердить оплату", `admin_confirm_order_${orderId}_${telegramId}`)],
              [Markup.button.callback("❌ Отклонить", `admin_reject_order_${orderId}_${telegramId}`)],
            ]).reply_markup,
          }
        );
      } catch {
        // администратор недоступен
      }
    }
  });

  // ─── Подтверждение заказа администратором ────────────────────────────────
  bot.action(/^admin_confirm_order_(\d+)_(\d+)$/, async (ctx) => {
    await ctx.answerCbQuery("✅ Обрабатываем...");
    const { id: adminTgId } = ctx.from;
    if (!isAdmin(adminTgId)) return;

    const orderId = parseInt((ctx.match as RegExpMatchArray)[1]);
    const buyerTelegramId = parseInt((ctx.match as RegExpMatchArray)[2]);

    await deliverOrder(ctx, orderId, buyerTelegramId);
  });

  bot.action(/^admin_reject_order_(\d+)_(\d+)$/, async (ctx) => {
    await ctx.answerCbQuery("❌ Отклонено");
    const { id: adminTgId } = ctx.from;
    if (!isAdmin(adminTgId)) return;

    const orderId = parseInt((ctx.match as RegExpMatchArray)[1]);
    const buyerTelegramId = parseInt((ctx.match as RegExpMatchArray)[2]);

    const { db } = await import("@/db");
    const { orders: ordersTable } = await import("@/db/schema");
    const { eq } = await import("drizzle-orm");
    await db.update(ordersTable).set({ status: "failed" }).where(eq(ordersTable.id, orderId));

    await ctx.reply(`❌ Заказ #${orderId} отклонён.`);

    try {
      await ctx.telegram.sendMessage(
        buyerTelegramId,
        `❌ <b>Ваш заказ #${orderId} был отклонён.</b>\n\nЕсли вы считаете, что произошла ошибка — обратитесь в поддержку.`,
        { parse_mode: "HTML" }
      );
    } catch {
      // пользователь недоступен
    }
  });

  // ─── /mylink ─────────────────────────────────────────────────────────────
  bot.command("mylink", async (ctx) => {
    const { id, username, first_name } = ctx.from;
    await getOrCreateUser(id, username, first_name);

    const link = await getReferralLink(id);
    if (!link) {
      await ctx.reply("⚠️ Реферальная ссылка не найдена. Используйте /start.");
      return;
    }

    const refUrl = `https://t.me/${BOT_USERNAME}?start=${link.code}`;

    await ctx.replyWithHTML(
      `🔗 <b>Ваша реферальная ссылка</b>\n\n` +
        `<code>${refUrl}</code>\n\n` +
        `📊 <b>Статистика</b>\n` +
        `👆 Переходов: <b>${link.clickCount}</b>\n` +
        `👥 Зарегистрировалось: <b>${link.referredCount}</b>\n\n` +
        `💡 Делитесь ссылкой и зарабатывайте <b>50%</b> с каждой покупки реферала!`
    );
  });

  // ─── /mystats ────────────────────────────────────────────────────────────
  bot.command("mystats", async (ctx) => {
    const { id, username, first_name } = ctx.from;
    await getOrCreateUser(id, username, first_name);

    const [link, earned] = await Promise.all([
      getReferralLink(id),
      getEarningsByTelegramId(id),
    ]);

    const refUrl = link ? `https://t.me/${BOT_USERNAME}?start=${link.code}` : "—";

    await ctx.replyWithHTML(
      `📈 <b>Ваша статистика</b>\n\n` +
        `🔗 Ссылка: <code>${refUrl}</code>\n` +
        `👥 Привели пользователей: <b>${link?.referredCount ?? 0}</b>\n` +
        `👆 Переходов по ссылке: <b>${link?.clickCount ?? 0}</b>\n\n` +
        `💰 <b>Заработано всего: ${formatMoney(earned?.totalEarned ?? 0)}</b>\n\n` +
        `ℹ️ Вы получаете 50% с каждой покупки ваших рефералов.`
    );
  });

  // ─── /statistics ─────────────────────────────────────────────────────────
  bot.command("statistics", async (ctx) => {
    const { id, username, first_name } = ctx.from;
    await getOrCreateUser(id, username, first_name);

    const top = await getTopEarners(5);

    if (top.length === 0) {
      await ctx.replyWithHTML(
        "📊 <b>Топ участников</b>\n\nПока нет заработков. Будь первым!"
      );
      return;
    }

    let text = "🏆 <b>Топ-5 по заработку</b>\n\n";
    top.forEach((row, i) => {
      const name = displayName(row.username, row.firstName);
      text += `${MEDALS[i]} ${name} — <b>${formatMoney(row.totalEarned)}</b>\n`;
    });

    text += "\n💡 Поделитесь своей ссылкой (/mylink) и попадите в топ!";

    await ctx.replyWithHTML(text);
  });

  // ─── /admin ──────────────────────────────────────────────────────────────
  bot.command("admin", async (ctx) => {
    const { id } = ctx.from;
    if (!isAdmin(id)) {
      await ctx.reply("⛔ Доступ запрещён.");
      return;
    }

    await ctx.replyWithHTML(
      "🔧 <b>Панель администратора</b>\n\n" +
        "📦 <b>Товары:</b>\n" +
        "/admin_products — список товаров\n" +
        "/admin_add_product — добавить товар\n\n" +
        "📊 <b>Статистика:</b>\n" +
        "/admin_stats — общая статистика\n" +
        "/admin_links — реферальные ссылки\n" +
        "/admin_users — все пользователи\n" +
        "/admin_orders — последние заказы\n" +
        "/admin_purchases — покупки\n" +
        "/admin_top — топ по заработку\n\n" +
        "💰 <b>Ручная оплата:</b>\n" +
        "/admin_add_purchase [userId] [сумма] [описание]\n\n" +
        "⚙️ <b>Настройки:</b>\n" +
        "/admin_set_stars_recipient — юзернейм для приёма звёзд\n" +
        "/admin_set_fragment_rate — курс Fragment"
    );
    await logAction(id, ctx.from.username, "ADMIN_PANEL");
  });

  // ─── /admin_products ─────────────────────────────────────────────────────
  bot.command("admin_products", async (ctx) => {
    const { id } = ctx.from;
    if (!isAdmin(id)) return ctx.reply("⛔ Доступ запрещён.");

    const prods = await getActiveProducts();
    if (prods.length === 0) {
      await ctx.replyWithHTML("📦 Товаров нет.\n\nДобавьте: /admin_add_product");
      return;
    }

    let text = `📦 <b>Товары (${prods.length})</b>\n\n`;
    for (const p of prods) {
      text += `• [${p.id}] <b>${p.name}</b> — ${formatMoney(p.price)}\n`;
      text += `  Тип: ${p.productType}`;
      if (p.channelId) text += ` | Канал: <code>${p.channelId}</code>`;
      text += "\n\n";
    }

    text += "Управление: /admin_edit_product [id] | /admin_del_product [id]";

    await ctx.replyWithHTML(text);
  });

  // ─── /admin_add_product ──────────────────────────────────────────────────
  bot.command("admin_add_product", async (ctx) => {
    const { id } = ctx.from;
    if (!isAdmin(id)) return ctx.reply("⛔ Доступ запрещён.");

    await setUserState(id, "admin_add_product_name");
    await ctx.reply(
      "📦 Добавление нового товара\n\n" +
      "Шаг 1/4: Введите <b>название</b> товара:",
      { parse_mode: "HTML" }
    );
  });

  // ─── /admin_del_product [id] ─────────────────────────────────────────────
  bot.command("admin_del_product", async (ctx) => {
    const { id } = ctx.from;
    if (!isAdmin(id)) return ctx.reply("⛔ Доступ запрещён.");

    const parts = ctx.message.text.split(" ").slice(1);
    const productId = parseInt(parts[0]);
    if (isNaN(productId)) {
      await ctx.reply("⚠️ Укажите ID товара: /admin_del_product [id]");
      return;
    }

    await deleteProduct(productId);
    await ctx.reply(`✅ Товар #${productId} деактивирован.`);
  });

  // ─── /admin_stats ─────────────────────────────────────────────────────────
  bot.command("admin_stats", async (ctx) => {
    const { id } = ctx.from;
    if (!isAdmin(id)) return ctx.reply("⛔ Доступ запрещён.");

    const stats = await getTotalStats();

    await ctx.replyWithHTML(
      `📊 <b>Общая статистика бота</b>\n\n` +
        `👥 Пользователей: <b>${stats.users}</b>\n` +
        `🔗 Реферальных ссылок: <b>${stats.links}</b>\n` +
        `🛒 Покупок (реф.): <b>${stats.purchases}</b>\n` +
        `✅ Оплаченных заказов: <b>${stats.paidOrders}</b>\n` +
        `💵 Выручка (заказы): <b>${formatMoney(stats.ordersRevenue)}</b>\n` +
        `💸 Комиссии выплачено: <b>${formatMoney(stats.totalCommissions)}</b>\n` +
        `📅 ${new Date().toLocaleString("ru-RU")}`
    );
    await logAction(id, ctx.from.username, "ADMIN_STATS");
  });

  // ─── /admin_links ─────────────────────────────────────────────────────────
  bot.command("admin_links", async (ctx) => {
    const { id } = ctx.from;
    if (!isAdmin(id)) return ctx.reply("⛔ Доступ запрещён.");

    const links = await getAllReferralLinksWithStats();
    if (links.length === 0) {
      await ctx.reply("Реферальных ссылок пока нет.");
      return;
    }

    let text = `🔗 <b>Реферальные ссылки (${links.length})</b>\n\n`;
    links.slice(0, 30).forEach((l, i) => {
      const owner = displayName(l.ownerUsername, null);
      const url = `https://t.me/${BOT_USERNAME}?start=${l.code}`;
      text +=
        `${i + 1}. ${owner} — код: <code>${l.code}</code>\n` +
        `   👆 Переходов: ${l.clickCount} | 👥 Пришло: ${l.referredCount}\n\n`;
    });

    if (links.length > 30) text += `… и ещё ${links.length - 30}.`;

    await ctx.replyWithHTML(text, { disable_web_page_preview: true } as never);
    await logAction(id, ctx.from.username, "ADMIN_LINKS");
  });

  // ─── /admin_users ─────────────────────────────────────────────────────────
  bot.command("admin_users", async (ctx) => {
    const { id } = ctx.from;
    if (!isAdmin(id)) return ctx.reply("⛔ Доступ запрещён.");

    const allUsers = await getAllUsers();
    if (allUsers.length === 0) {
      await ctx.reply("Пользователей пока нет.");
      return;
    }

    let text = `👥 <b>Все пользователи (${allUsers.length})</b>\n\n`;
    allUsers.slice(0, 25).forEach((u, i) => {
      const name = displayName(u.username, u.firstName);
      const ref = u.referredBy ? `реф: ${u.referredBy}` : "органика";
      text += `${i + 1}. ${name} <code>${u.telegramId}</code> (${ref})\n`;
    });
    if (allUsers.length > 25) text += `\n… и ещё ${allUsers.length - 25}.`;

    await ctx.replyWithHTML(text);
    await logAction(id, ctx.from.username, "ADMIN_USERS");
  });

  // ─── /admin_orders ────────────────────────────────────────────────────────
  bot.command("admin_orders", async (ctx) => {
    const { id } = ctx.from;
    if (!isAdmin(id)) return ctx.reply("⛔ Доступ запрещён.");

    const recent = await getRecentOrders(15);
    if (recent.length === 0) {
      await ctx.reply("Заказов пока нет.");
      return;
    }

    let text = `🛒 <b>Последние заказы (${recent.length})</b>\n\n`;
    for (const o of recent) {
      const statusEmoji = o.status === "paid" ? "✅" : o.status === "pending" ? "⏳" : "❌";
      text +=
        `${statusEmoji} #${o.id} | ${o.paymentMethod.toUpperCase()}\n` +
        `👤 <code>${o.buyerTelegramId}</code> | 💵 ${formatMoney(o.amount)}\n` +
        `📅 ${new Date(o.createdAt).toLocaleString("ru-RU")}\n\n`;
    }

    await ctx.replyWithHTML(text);
  });

  // ─── /admin_purchases ─────────────────────────────────────────────────────
  bot.command("admin_purchases", async (ctx) => {
    const { id } = ctx.from;
    if (!isAdmin(id)) return ctx.reply("⛔ Доступ запрещён.");

    const recent = await getRecentPurchases(20);
    if (recent.length === 0) {
      await ctx.reply("Покупок пока нет.");
      return;
    }

    let text = `🛒 <b>Последние покупки (${recent.length})</b>\n\n`;
    recent.forEach((p) => {
      text +=
        `👤 Покупатель: <code>${p.buyerTelegramId}</code>\n` +
        `💵 Сумма: <b>${formatMoney(p.amount)}</b> | Комиссия: <b>${formatMoney(p.commission)}</b>\n` +
        (p.referrerTelegramId ? `🔗 Реферер: <code>${p.referrerTelegramId}</code>\n` : "") +
        (p.description ? `📝 ${p.description}\n` : "") +
        `📅 ${new Date(p.createdAt).toLocaleString("ru-RU")}\n\n`;
    });

    await ctx.replyWithHTML(text);
    await logAction(id, ctx.from.username, "ADMIN_PURCHASES");
  });

  // ─── /admin_add_purchase ──────────────────────────────────────────────────
  bot.command("admin_add_purchase", async (ctx) => {
    const { id } = ctx.from;
    if (!isAdmin(id)) return ctx.reply("⛔ Доступ запрещён.");

    const parts = ctx.message.text.split(" ").slice(1);
    const buyerId = parseInt(parts[0]);
    const amount = parseFloat(parts[1]);
    const desc = parts.slice(2).join(" ") || undefined;

    if (isNaN(buyerId) || isNaN(amount) || amount <= 0) {
      await ctx.reply(
        "⚠️ Использование: /admin_add_purchase [telegramId] [сумма] [описание]\n" +
          "Пример: /admin_add_purchase 123456789 500 Подписка Premium"
      );
      return;
    }

    const buyer = await getUserByTelegramId(buyerId);
    if (!buyer) {
      await ctx.reply(`⚠️ Пользователь ${buyerId} не найден в базе.`);
      return;
    }

    const { commission, referrerTelegramId } = await recordPurchase(buyerId, amount, desc);

    let msg =
      `✅ <b>Покупка записана!</b>\n\n` +
      `👤 Покупатель: ${displayName(buyer.username, buyer.firstName)} (<code>${buyerId}</code>)\n` +
      `💵 Сумма: <b>${formatMoney(amount)}</b>\n` +
      `💸 Комиссия (50%): <b>${formatMoney(commission)}</b>\n`;

    if (referrerTelegramId) {
      const referrer = await getUserByTelegramId(referrerTelegramId);
      const rName = displayName(referrer?.username, referrer?.firstName);
      msg += `🔗 Начислено рефереру: ${rName} (<code>${referrerTelegramId}</code>)`;

      try {
        await ctx.telegram.sendMessage(
          referrerTelegramId,
          `🎉 <b>Вы получили комиссию!</b>\n\n` +
            `Ваш реферал ${displayName(buyer.username, buyer.firstName)} сделал покупку на <b>${formatMoney(amount)}</b>.\n` +
            `💰 Ваша комиссия (50%): <b>${formatMoney(commission)}</b>\n\n` +
            `Используйте /mystats чтобы увидеть общий заработок!`,
          { parse_mode: "HTML" }
        );
      } catch {
        // реферер не запустил бота
      }
    } else {
      msg += `ℹ️ Реферера нет — органический пользователь.`;
    }

    await ctx.replyWithHTML(msg);
    await logAction(id, ctx.from.username, "ADMIN_ADD_PURCHASE", `buyer=${buyerId} amount=${amount}`);
  });

  // ─── /admin_top ───────────────────────────────────────────────────────────
  bot.command("admin_top", async (ctx) => {
    const { id } = ctx.from;
    if (!isAdmin(id)) return ctx.reply("⛔ Доступ запрещён.");

    const top = await getTopEarners(10);
    if (top.length === 0) {
      await ctx.reply("Заработков ещё нет.");
      return;
    }

    let text = "🏆 <b>Топ участников (Админ)</b>\n\n";
    top.forEach((row, i) => {
      const name = displayName(row.username, row.firstName);
      text += `${i + 1}. ${name} <code>${row.telegramId}</code> — <b>${formatMoney(row.totalEarned)}</b>\n`;
    });

    await ctx.replyWithHTML(text);
    await logAction(id, ctx.from.username, "ADMIN_TOP");
  });

  // ─── /admin_confirm_order [orderId] ──────────────────────────────────────
  bot.command("admin_confirm_order", async (ctx) => {
    const { id } = ctx.from;
    if (!isAdmin(id)) return ctx.reply("⛔ Доступ запрещён.");

    const parts = ctx.message.text.split(" ").slice(1);
    const orderId = parseInt(parts[0]);
    if (isNaN(orderId)) {
      await ctx.reply("⚠️ Укажите ID заказа: /admin_confirm_order [id]");
      return;
    }

    const { db } = await import("@/db");
    const { orders: ordersTable } = await import("@/db/schema");
    const { eq } = await import("drizzle-orm");

    const orderRows = await db.select().from(ordersTable).where(eq(ordersTable.id, orderId)).limit(1);
    if (!orderRows[0]) {
      await ctx.reply(`❌ Заказ #${orderId} не найден.`);
      return;
    }

    await deliverOrder(ctx, orderId, orderRows[0].buyerTelegramId);
  });

  // ─── FSM — обработка текстовых сообщений ─────────────────────────────────
  bot.on("text", async (ctx) => {
    const { id, username, first_name } = ctx.from;

    // Если начинается с команды — пропускаем
    if (ctx.message.text.startsWith("/")) {
      if (!isAdmin(id)) {
        await ctx.reply(
          "❓ Неизвестная команда.\n/shop /mylink /mystats /statistics"
        );
      } else {
        await ctx.reply(
          "❓ Неизвестная команда.\nИспользуйте /admin для списка команд."
        );
      }
      return;
    }

    // Проверяем состояние FSM
    const stateRow = await getUserState(id);
    if (!stateRow) return;

    const state = stateRow.state;
    const data = (stateRow.data as Record<string, unknown>) ?? {};
    const text = ctx.message.text.trim();

    // ─── Добавление товара — многошаговый FSM ────────────────────────────
    if (state === "admin_add_product_name") {
      if (!isAdmin(id)) { await clearUserState(id); return; }
      data.name = text;
      await setUserState(id, "admin_add_product_desc", data);
      await ctx.reply("Шаг 2/4: Введите <b>описание</b> товара (или напишите «-» чтобы пропустить):", { parse_mode: "HTML" });
      return;
    }

    if (state === "admin_add_product_desc") {
      if (!isAdmin(id)) { await clearUserState(id); return; }
      data.description = text === "-" ? null : text;
      await setUserState(id, "admin_add_product_price", data);
      await ctx.reply("Шаг 3/4: Введите <b>цену</b> в рублях (например: 1500):", { parse_mode: "HTML" });
      return;
    }

    if (state === "admin_add_product_price") {
      if (!isAdmin(id)) { await clearUserState(id); return; }
      const price = parseFloat(text.replace(",", "."));
      if (isNaN(price) || price <= 0) {
        await ctx.reply("⚠️ Введите корректную цену числом, например: 1500");
        return;
      }
      data.price = price;
      await setUserState(id, "admin_add_product_channel", data);
      await ctx.reply(
        "Шаг 4/4: Введите <b>ID канала/группы</b> для выдачи ссылки после оплаты.\n" +
        "Например: <code>-1001234567890</code>\n\n" +
        "Или напишите «-» если товар цифровой (текст/инструкция):",
        { parse_mode: "HTML" }
      );
      return;
    }

    if (state === "admin_add_product_channel") {
      if (!isAdmin(id)) { await clearUserState(id); return; }

      let productType = "invite_link";
      let channelId: string | undefined;
      let digitalContent: string | undefined;

      if (text === "-") {
        productType = "digital";
        await clearUserState(id);
        await setUserState(id, "admin_add_product_digital", data);
        await ctx.reply(
          "Введите <b>цифровой контент</b> (текст, который получит пользователь после оплаты):",
          { parse_mode: "HTML" }
        );
        return;
      } else {
        channelId = text;
        data.channelId = channelId;
        data.productType = productType;

        const product = await createProduct({
          name: data.name as string,
          description: data.description as string | undefined,
          price: data.price as number,
          productType,
          channelId,
          digitalContent,
        });

        await clearUserState(id);
        await ctx.replyWithHTML(
          `✅ <b>Товар добавлен!</b>\n\n` +
          `🆔 ID: <code>${product.id}</code>\n` +
          `📦 Название: <b>${product.name}</b>\n` +
          `💵 Цена: <b>${formatMoney(product.price)}</b>\n` +
          `📡 Канал: <code>${channelId}</code>\n\n` +
          `⚠️ Убедитесь, что бот является <b>администратором</b> в канале <code>${channelId}</code>!\n\n` +
          `Список товаров: /admin_products`
        );
      }
      return;
    }

    if (state === "admin_add_product_digital") {
      if (!isAdmin(id)) { await clearUserState(id); return; }
      const product = await createProduct({
        name: data.name as string,
        description: data.description as string | undefined,
        price: data.price as number,
        productType: "digital",
        digitalContent: text,
      });

      await clearUserState(id);
      await ctx.replyWithHTML(
        `✅ <b>Товар добавлен!</b>\n\n` +
        `🆔 ID: <code>${product.id}</code>\n` +
        `📦 Название: <b>${product.name}</b>\n` +
        `💵 Цена: <b>${formatMoney(product.price)}</b>\n` +
        `📝 Тип: Цифровой контент\n\n` +
        `Список товаров: /admin_products`
      );
      return;
    }
  });

  return bot;
}

// ─── Выдача товара после оплаты ──────────────────────────────────────────────

export async function deliverOrder(
  ctx: Context,
  orderId: number,
  buyerTelegramId: number
) {
  const { db } = await import("@/db");
  const { orders: ordersTable } = await import("@/db/schema");
  const { eq } = await import("drizzle-orm");
  const { markOrderPaid, getProductById, recordPurchase, getUserByTelegramId, displayName, formatMoney } = await import("./helpers");

  const orderRows = await db.select().from(ordersTable).where(eq(ordersTable.id, orderId)).limit(1);
  const order = orderRows[0];

  if (!order) {
    await ctx.reply(`❌ Заказ #${orderId} не найден.`);
    return;
  }

  if (order.status === "paid") {
    await ctx.reply(`ℹ️ Заказ #${orderId} уже выполнен.`);
    return;
  }

  const product = await getProductById(order.productId);
  if (!product) {
    await ctx.reply(`❌ Товар не найден.`);
    return;
  }

  let deliveredContent = "";

  if (product.productType === "invite_link" && product.channelId) {
    try {
      // Создаём одноразовую ссылку в канал
      const inviteLink = await ctx.telegram.createChatInviteLink(
        product.channelId,
        {
          creates_join_request: false,
          member_limit: 1,
        }
      );
      deliveredContent = inviteLink.invite_link;
    } catch (e) {
      console.error("Ошибка создания ссылки:", e);
      deliveredContent = "❌ Не удалось создать ссылку. Обратитесь к администратору.";
    }
  } else if (product.productType === "digital" && product.digitalContent) {
    deliveredContent = product.digitalContent;
  }

  await markOrderPaid(orderId, deliveredContent);

  // Записать покупку для реферальной системы
  await recordPurchase(buyerTelegramId, parseFloat(order.amount), product.name);

  // Отправить товар покупателю
  try {
    if (product.productType === "invite_link") {
      await ctx.telegram.sendMessage(
        buyerTelegramId,
        `✅ <b>Оплата подтверждена!</b>\n\n` +
        `📦 Товар: <b>${product.name}</b>\n\n` +
        `🔗 Ваша одноразовая ссылка:\n${deliveredContent}\n\n` +
        `⚠️ Ссылка одноразовая — не передавайте её другим!`,
        { parse_mode: "HTML" }
      );
    } else {
      await ctx.telegram.sendMessage(
        buyerTelegramId,
        `✅ <b>Оплата подтверждена!</b>\n\n` +
        `📦 Товар: <b>${product.name}</b>\n\n` +
        `📋 <b>Ваш контент:</b>\n${deliveredContent}`,
        { parse_mode: "HTML" }
      );
    }
  } catch (e) {
    console.error("Ошибка отправки товара покупателю:", e);
  }

  // Уведомить администратора об успешной выдаче
  await ctx.reply(
    `✅ Заказ #${orderId} выполнен.\n` +
    `Пользователю <code>${buyerTelegramId}</code> отправлен товар «${product.name}».`,
    { parse_mode: "HTML" }
  );

  // Реферальное уведомление
  const buyer = await getUserByTelegramId(buyerTelegramId);
  if (buyer?.referredBy) {
    const referrer = await getUserByTelegramId(buyer.referredBy);
    if (referrer) {
      const commission = parseFloat(order.amount) * 0.5;
      try {
        await ctx.telegram.sendMessage(
          buyer.referredBy,
          `🎉 <b>Вы получили комиссию!</b>\n\n` +
          `Ваш реферал ${displayName(buyer.username, buyer.firstName)} купил «${product.name}».\n` +
          `💰 Ваша комиссия (50%): <b>${formatMoney(commission)}</b>\n\n` +
          `/mystats — ваш заработок`,
          { parse_mode: "HTML" }
        );
      } catch {
        // реферер недоступен
      }
    }
  }
}
