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
  calcAmountWithCommission,
  validateCoupon,
  useCoupon,
  createCoupon,
  getAllCoupons,
  deactivateCoupon,
  getUserDetailedStats,
} from "./helpers";

const TOKEN = process.env.TELEGRAM_BOT_TOKEN ?? "";
const ADMIN_IDS = (process.env.ADMIN_TELEGRAM_IDS ?? "")
  .split(",")
  .map((s) => parseInt(s.trim()))
  .filter((n) => !isNaN(n) && n > 0);
const BOT_USERNAME = process.env.TELEGRAM_BOT_USERNAME ?? "myrefbot";

// Звёзды: юзернейм для получения
const STARS_RECIPIENT_USERNAME = process.env.STARS_RECIPIENT_USERNAME ?? "";
// Курс Fragment: сколько рублей стоит 1 звезда
const FRAGMENT_RATE = parseFloat(process.env.FRAGMENT_RATE_RUB ?? "1.12");
// Фиксированное кол-во звёзд для подарка
const GIFT_STARS_AMOUNT = parseInt(process.env.GIFT_STARS_AMOUNT ?? "1400");

// CryptoBot
const CRYPTOBOT_TOKEN = process.env.CRYPTOBOT_TOKEN ?? "";
const CRYPTOBOT_API = "https://pay.crypt.bot/api";

// Platega (СБП + карта)
const PLATEGA_MERCHANT_ID = process.env.PLATEGA_MERCHANT_ID ?? "";
const PLATEGA_SECRET_KEY = process.env.PLATEGA_SECRET_KEY ?? "";
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

// ─── Platega (СБП + карта) helpers ───────────────────────────────────────────

async function createPlategalInvoice(
  amount: number,
  orderId: string,
  description: string,
  paymentMethod: "sbp" | "card"
): Promise<{ paymentUrl: string; paymentId: string } | null> {
  if (!PLATEGA_MERCHANT_ID || !PLATEGA_SECRET_KEY) return null;
  try {
    // Platega API: создаём транзакцию
    // payment_method: 1 = card, 2 = SBP
    const methodId = paymentMethod === "sbp" ? 2 : 1;
    const { v4: uuidv4 } = await import("uuid");
    const txId = uuidv4();

    const body = {
      id: txId,
      merchant_id: PLATEGA_MERCHANT_ID,
      payment_method: methodId,
      payment_details: {
        amount: amount,
        currency: "RUB",
      },
      description: description,
      return_url: `https://t.me/${BOT_USERNAME}`,
      failed_url: `https://t.me/${BOT_USERNAME}`,
      webhook_url: `${WEBHOOK_BASE_URL}/api/payment/platega`,
      order_id: orderId,
    };

    const crypto = await import("crypto");
    // Подпись HMAC-SHA256
    const sign = crypto
      .createHmac("sha256", PLATEGA_SECRET_KEY)
      .update(JSON.stringify(body))
      .digest("hex");

    const res = await axios.post(
      "https://api.platega.io/v1/transaction/create",
      body,
      {
        headers: {
          "Content-Type": "application/json",
          "X-Merchant-ID": PLATEGA_MERCHANT_ID,
          "X-Signature": sign,
        },
      }
    );

    return {
      paymentUrl: res.data.redirect ?? res.data.payment_url ?? res.data.url ?? "",
      paymentId: txId,
    };
  } catch (e) {
    console.error("Platega error:", e);
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
      `📢 Делитесь ссылкой и получайте <b>10% комиссии</b> с каждой покупки ваших рефералов!\n\n` +
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

    const starsUsername = calcStarsByUsername(parseFloat(product.price), FRAGMENT_RATE);
    const starsGift = GIFT_STARS_AMOUNT;

    const text =
      `📦 <b>${product.name}</b>\n\n` +
      (product.description ? `📝 ${product.description}\n\n` : "") +
      `💰 Цена: <b>${formatMoney(product.price)}</b>\n\n` +
      `⭐ Stars (по юзернейму): ~<b>${starsUsername} ⭐</b>\n` +
      `🎁 Stars (подарком): <b>${starsGift} ⭐</b>\n\n` +
      `Выберите способ оплаты:`;

    await ctx.replyWithHTML(
      text,
      Markup.inlineKeyboard([
        [Markup.button.callback("💳 СБП (+10% комиссия)", `pay_sbp_${productId}`)],
        [Markup.button.callback("🏦 Банковская карта (+10%)", `pay_card_${productId}`)],
        [Markup.button.callback("🪙 CryptoBot (USDT)", `pay_crypto_${productId}`)],
        [Markup.button.callback("⭐ Звёзды по юзернейму", `pay_stars_username_${productId}`)],
        [Markup.button.callback("🎁 Звёзды подарком (1400 ⭐)", `pay_stars_gift_${productId}`)],
        [Markup.button.callback("🏷 Применить купон", `coupon_${productId}`)],
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

  // ─── Применение купона ───────────────────────────────────────────────────
  bot.action(/^coupon_(\d+)$/, async (ctx) => {
    await ctx.answerCbQuery();
    const productId = parseInt((ctx.match as RegExpMatchArray)[1]);
    const { id } = ctx.from;

    await setUserState(id, "apply_coupon", { productId });
    await ctx.reply(
      "🏷 Введите код купона:\n\n(Купон применяется к базовой цене товара)"
    );
  });

  // ─── Оплата СБП ──────────────────────────────────────────────────────────
  bot.action(/^pay_sbp_(\d+)$/, async (ctx) => {
    await ctx.answerCbQuery();
    const productId = parseInt((ctx.match as RegExpMatchArray)[1]);
    await initiatePayment(ctx, productId, "sbp");
  });

  // ─── Оплата Карта ────────────────────────────────────────────────────────
  bot.action(/^pay_card_(\d+)$/, async (ctx) => {
    await ctx.answerCbQuery();
    const productId = parseInt((ctx.match as RegExpMatchArray)[1]);
    await initiatePayment(ctx, productId, "card");
  });

  // ─── Оплата СБП с купоном ────────────────────────────────────────────────
  bot.action(/^pay_sbp_coupon_(\d+)_(.+)$/, async (ctx) => {
    await ctx.answerCbQuery();
    const productId = parseInt((ctx.match as RegExpMatchArray)[1]);
    const couponCode = (ctx.match as RegExpMatchArray)[2];
    await initiatePayment(ctx, productId, "sbp", couponCode);
  });

  bot.action(/^pay_card_coupon_(\d+)_(.+)$/, async (ctx) => {
    await ctx.answerCbQuery();
    const productId = parseInt((ctx.match as RegExpMatchArray)[1]);
    const couponCode = (ctx.match as RegExpMatchArray)[2];
    await initiatePayment(ctx, productId, "card", couponCode);
  });

  bot.action(/^pay_crypto_coupon_(\d+)_(.+)$/, async (ctx) => {
    await ctx.answerCbQuery();
    const productId = parseInt((ctx.match as RegExpMatchArray)[1]);
    const couponCode = (ctx.match as RegExpMatchArray)[2];
    await initiatePayment(ctx, productId, "cryptobot", couponCode);
  });

  // ─── Оплата CryptoBot ────────────────────────────────────────────────────
  bot.action(/^pay_crypto_(\d+)$/, async (ctx) => {
    await ctx.answerCbQuery();
    const productId = parseInt((ctx.match as RegExpMatchArray)[1]);
    await initiatePayment(ctx, productId, "cryptobot");
  });

  // ─── Оплата Stars — по юзернейму ─────────────────────────────────────────
  bot.action(/^pay_stars_username_(\d+)$/, async (ctx) => {
    await ctx.answerCbQuery();
    const productId = parseInt((ctx.match as RegExpMatchArray)[1]);
    const product = await getProductById(productId);
    if (!product) return;

    const { id: telegramId, username, first_name } = ctx.from;
    await getOrCreateUser(telegramId, username, first_name);

    const amount = parseFloat(product.price);
    const starsNeeded = calcStarsByUsername(amount, FRAGMENT_RATE);

    const order = await createOrder({
      buyerTelegramId: telegramId,
      productId,
      amount,
      paymentMethod: "stars_username",
    });

    const recipient = STARS_RECIPIENT_USERNAME || "username_not_set";

    await ctx.replyWithHTML(
      `⭐ <b>Оплата звёздами (по юзернейму)</b>\n\n` +
      `📦 Товар: <b>${product.name}</b>\n` +
      `💰 Базовая сумма: <b>${formatMoney(amount)}</b>\n` +
      `⭐ Звёзд к отправке: <b>${starsNeeded} ⭐</b>\n\n` +
      `📨 Отправьте <b>${starsNeeded} ⭐</b> пользователю:\n` +
      `<code>@${recipient}</code>\n\n` +
      `❗ В комментарии к оплате укажите ID заказа: <code>${order.id}</code>\n\n` +
      `После отправки нажмите кнопку ниже:`,
      Markup.inlineKeyboard([
        [Markup.button.callback("✅ Я отправил звёзды", `stars_sent_${order.id}`)],
        [Markup.button.callback("❌ Отмена", "back_to_shop")],
      ])
    );
  });

  // ─── Оплата Stars — подарком ─────────────────────────────────────────────
  bot.action(/^pay_stars_gift_(\d+)$/, async (ctx) => {
    await ctx.answerCbQuery();
    const productId = parseInt((ctx.match as RegExpMatchArray)[1]);
    const product = await getProductById(productId);
    if (!product) return;

    const { id: telegramId, username, first_name } = ctx.from;
    await getOrCreateUser(telegramId, username, first_name);

    const amount = parseFloat(product.price);
    // Фиксированно 1400 звёзд подарком
    const starsNeeded = GIFT_STARS_AMOUNT;

    const order = await createOrder({
      buyerTelegramId: telegramId,
      productId,
      amount,
      paymentMethod: "stars_gift",
    });

    const recipient = STARS_RECIPIENT_USERNAME || "username_not_set";

    await ctx.replyWithHTML(
      `🎁 <b>Оплата звёздами (подарком)</b>\n\n` +
      `📦 Товар: <b>${product.name}</b>\n` +
      `💰 Сумма: <b>${formatMoney(amount)}</b>\n` +
      `⭐ Подарком: <b>${starsNeeded} ⭐</b>\n\n` +
      `🎁 Отправьте подарок на <b>${starsNeeded} ⭐</b> пользователю:\n` +
      `<code>@${recipient}</code>\n\n` +
      `❗ ID заказа: <code>${order.id}</code>\n` +
      `(сообщите его администратору для подтверждения)\n\n` +
      `После отправки нажмите кнопку ниже:`,
      Markup.inlineKeyboard([
        [Markup.button.callback("✅ Я отправил подарок", `stars_sent_${order.id}`)],
        [Markup.button.callback("❌ Отмена", "back_to_shop")],
      ])
    );
  });

  // ─── Подтверждение отправки Stars ────────────────────────────────────────
  bot.action(/^stars_sent_(\d+)$/, async (ctx) => {
    await ctx.answerCbQuery();
    const orderId = parseInt((ctx.match as RegExpMatchArray)[1]);
    const { id } = ctx.from;

    // Оповещаем администраторов
    for (const adminId of ADMIN_IDS) {
      try {
        await ctx.telegram.sendMessage(
          adminId,
          `⭐ <b>Запрос на подтверждение Stars-оплаты</b>\n\n` +
          `👤 Пользователь: <code>${id}</code>\n` +
          `🆔 Заказ: #${orderId}\n\n` +
          `Подтвердите: /admin_confirm_order ${orderId}`,
          { parse_mode: "HTML" }
        );
      } catch {
        // Администратор недоступен
      }
    }

    await ctx.reply(
      `✅ Запрос отправлен администратору!\n\n` +
      `🆔 Номер заказа: #${orderId}\n\n` +
      `Ожидайте подтверждения. Обычно это занимает до 24 часов.`
    );
  });

  // ─── /mylink ─────────────────────────────────────────────────────────────
  bot.command("mylink", async (ctx) => {
    const { id, username, first_name } = ctx.from;
    await getOrCreateUser(id, username, first_name);

    const link = await getReferralLink(id);
    if (!link) {
      await ctx.reply("⚠️ Реферальная ссылка не найдена. Используйте /start");
      return;
    }

    const refUrl = `https://t.me/${BOT_USERNAME}?start=${link.code}`;

    await ctx.replyWithHTML(
      `🔗 <b>Ваша реферальная ссылка</b>\n\n` +
        `<code>${refUrl}</code>\n\n` +
        `📊 <b>Статистика</b>\n` +
        `👆 Кликов: <b>${link.clickCount}</b>\n` +
        `👥 Перешло: <b>${link.referredCount}</b>\n\n` +
        `💡 Делитесь ссылкой и зарабатывайте <b>10%</b> с покупок рефералов!`
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

    const refUrl = link
      ? `https://t.me/${BOT_USERNAME}?start=${link.code}`
      : "—";

    await ctx.replyWithHTML(
      `📈 <b>Ваша статистика</b>\n\n` +
        `🔗 Реф. ссылка: <code>${refUrl}</code>\n` +
        `👥 Привлечено: <b>${link?.referredCount ?? 0}</b>\n` +
        `👆 Кликов: <b>${link?.clickCount ?? 0}</b>\n\n` +
        `💰 <b>Всего заработано: ${formatMoney(earned?.totalEarned ?? 0)}</b>\n\n` +
        `ℹ️ Вы получаете 10% с каждой покупки ваших рефералов.`
    );
  });

  // ─── /statistics ─────────────────────────────────────────────────────────
  bot.command("statistics", async (ctx) => {
    const { id, username, first_name } = ctx.from;
    await getOrCreateUser(id, username, first_name);

    const top = await getTopEarners(5);

    if (top.length === 0) {
      await ctx.replyWithHTML(
        "📊 <b>Топ участников</b>\n\nЗаработков пока нет. Будьте первым!"
      );
      return;
    }

    let text = "🏆 <b>Топ-5 по заработку</b>\n\n";
    top.forEach((row, i) => {
      const name = displayName(row.username, row.firstName);
      text += `${MEDALS[i]} ${name} — <b>${formatMoney(row.totalEarned)}</b>\n`;
    });

    text +=
      "\n💡 Делитесь реферальной ссылкой (/mylink) и зарабатывайте!";

    await ctx.replyWithHTML(text);
  });

  // ─── /admin ───────────────────────────────────────────────────────────────
  bot.command("admin", async (ctx) => {
    const { id } = ctx.from;
    if (!isAdmin(id)) {
      await ctx.reply("⛔ Доступ запрещён.");
      return;
    }

    await ctx.replyWithHTML(
      "🔧 <b>Панель администратора</b>\n\n" +
        "📦 Товары:\n" +
        "/admin_products — список товаров\n" +
        "/admin_add_product — добавить товар\n\n" +
        "🏷 Купоны:\n" +
        "/admin_coupons — все купоны\n" +
        "/admin_add_coupon — создать купон\n\n" +
        "👥 Пользователи:\n" +
        "/admin_users — все пользователи\n" +
        "/admin_purchases — последние покупки\n" +
        "/admin_orders — последние заказы\n\n" +
        "📊 Статистика:\n" +
        "/admin_stats — общая статистика\n" +
        "/admin_top — топ участников\n\n" +
        "✅ Подтверждение:\n" +
        "/admin_confirm_order [id] — подтвердить Stars-оплату\n"
    );
    await logAction(id, ctx.from.username, "ADMIN_PANEL");
  });

  // ─── /admin_stats ─────────────────────────────────────────────────────────
  bot.command("admin_stats", async (ctx) => {
    const { id } = ctx.from;
    if (!isAdmin(id)) { await ctx.reply("⛔ Доступ запрещён."); return; }

    const stats = await getTotalStats();

    await ctx.replyWithHTML(
      `📊 <b>Общая статистика</b>\n\n` +
        `👥 Пользователей: <b>${stats.users}</b>\n` +
        `🔗 Реферальных ссылок: <b>${stats.links}</b>\n` +
        `🛒 Покупок: <b>${stats.purchases}</b>\n` +
        `💵 Выручка (покупки): <b>${formatMoney(stats.totalRevenue)}</b>\n` +
        `✅ Оплаченных заказов: <b>${stats.paidOrders}</b>\n` +
        `💵 Выручка (заказы): <b>${formatMoney(stats.ordersRevenue)}</b>\n` +
        `💸 Реф. комиссии (10%): <b>${formatMoney(stats.totalCommissions)}</b>\n` +
        `📅 ${new Date().toLocaleString("ru-RU")}`
    );
    await logAction(id, ctx.from.username, "ADMIN_STATS");
  });

  // ─── /admin_products ──────────────────────────────────────────────────────
  bot.command("admin_products", async (ctx) => {
    const { id } = ctx.from;
    if (!isAdmin(id)) { await ctx.reply("⛔ Доступ запрещён."); return; }

    const prods = await getActiveProducts();
    if (prods.length === 0) {
      await ctx.reply("Товаров нет. /admin_add_product — добавить.");
      return;
    }

    let text = `📦 <b>Товары (${prods.length})</b>\n\n`;
    prods.forEach((p) => {
      text +=
        `🆔 #${p.id} — <b>${p.name}</b>\n` +
        `💵 ${formatMoney(p.price)} | Тип: ${p.productType}\n` +
        (p.channelId ? `📡 Канал: <code>${p.channelId}</code>\n` : "") +
        `\n`;
    });

    text += `\nУдалить: /admin_delete_product [id]`;
    await ctx.replyWithHTML(text);
    await logAction(id, ctx.from.username, "ADMIN_PRODUCTS");
  });

  // ─── /admin_add_product ───────────────────────────────────────────────────
  bot.command("admin_add_product", async (ctx) => {
    const { id } = ctx.from;
    if (!isAdmin(id)) { await ctx.reply("⛔ Доступ запрещён."); return; }

    await setUserState(id, "admin_add_product_name", {});
    await ctx.reply("Шаг 1/4: Введите <b>название</b> товара:", { parse_mode: "HTML" });
  });

  // ─── /admin_delete_product [id] ───────────────────────────────────────────
  bot.command("admin_delete_product", async (ctx) => {
    const { id } = ctx.from;
    if (!isAdmin(id)) { await ctx.reply("⛔ Доступ запрещён."); return; }

    const parts = ctx.message.text.split(" ").slice(1);
    const productId = parseInt(parts[0]);
    if (isNaN(productId)) {
      await ctx.reply("⚠️ Укажите ID: /admin_delete_product [id]");
      return;
    }
    await deleteProduct(productId);
    await ctx.reply(`✅ Товар #${productId} деактивирован.`);
  });

  // ─── /admin_orders ────────────────────────────────────────────────────────
  bot.command("admin_orders", async (ctx) => {
    const { id } = ctx.from;
    if (!isAdmin(id)) { await ctx.reply("⛔ Доступ запрещён."); return; }

    const recent = await getRecentOrders(15);
    if (recent.length === 0) {
      await ctx.reply("Заказов нет.");
      return;
    }

    let text = `📋 <b>Последние заказы (${recent.length})</b>\n\n`;
    recent.forEach((o) => {
      const methodEmoji: Record<string, string> = {
        sbp: "💳",
        card: "🏦",
        cryptobot: "🪙",
        stars_username: "⭐",
        stars_gift: "🎁",
      };
      const emoji = methodEmoji[o.paymentMethod] ?? "💰";
      text +=
        `#${o.id} ${emoji} ${o.paymentMethod.toUpperCase()}\n` +
        `👤 <code>${o.buyerTelegramId}</code> — <b>${formatMoney(o.amount)}</b>\n` +
        `📊 ${o.status}` +
        (o.couponCode ? ` | 🏷 ${o.couponCode} -${o.discountPercent}%` : "") +
        `\n\n`;
    });

    await ctx.replyWithHTML(text);
  });

  // ─── /admin_purchases ─────────────────────────────────────────────────────
  bot.command("admin_purchases", async (ctx) => {
    const { id } = ctx.from;
    if (!isAdmin(id)) { await ctx.reply("⛔ Доступ запрещён."); return; }

    const recent = await getRecentPurchases(20);
    if (recent.length === 0) {
      await ctx.reply("Покупок нет.");
      return;
    }

    let text = `🛒 <b>Последние покупки (${recent.length})</b>\n\n`;
    recent.forEach((p) => {
      text +=
        `👤 <code>${p.buyerTelegramId}</code>\n` +
        `💵 ${formatMoney(p.amount)} | Комиссия: ${formatMoney(p.commission)}\n` +
        (p.referrerTelegramId ? `🔗 Реф: <code>${p.referrerTelegramId}</code>\n` : "") +
        (p.description ? `📝 ${p.description}\n` : "") +
        `📅 ${new Date(p.createdAt).toLocaleString("ru-RU")}\n\n`;
    });

    await ctx.replyWithHTML(text);
  });

  // ─── /admin_links ─────────────────────────────────────────────────────────
  bot.command("admin_links", async (ctx) => {
    const { id } = ctx.from;
    if (!isAdmin(id)) { await ctx.reply("⛔ Доступ запрещён."); return; }

    const links = await getAllReferralLinksWithStats();
    if (links.length === 0) {
      await ctx.reply("Реферальных ссылок нет.");
      return;
    }

    let text = `🔗 <b>Все реф. ссылки (${links.length})</b>\n\n`;
    links.slice(0, 30).forEach((l, i) => {
      const owner = displayName(l.ownerUsername, null);
      const url = `https://t.me/${BOT_USERNAME}?start=${l.code}`;
      text +=
        `${i + 1}. ${owner} — <code>${l.code}</code>\n` +
        `   👆 ${l.clickCount} кликов | 👥 ${l.referredCount} перешло\n` +
        `   🔗 <a href="${url}">${url}</a>\n\n`;
    });

    if (links.length > 30) text += `… и ещё ${links.length - 30}`;

    await ctx.replyWithHTML(text, { disable_web_page_preview: true } as any);
  });

  // ─── /admin_users ─────────────────────────────────────────────────────────
  bot.command("admin_users", async (ctx) => {
    const { id } = ctx.from;
    if (!isAdmin(id)) { await ctx.reply("⛔ Доступ запрещён."); return; }

    const allUsers = await getAllUsers();
    if (allUsers.length === 0) {
      await ctx.reply("Пользователей нет.");
      return;
    }

    let text = `👥 <b>Все пользователи (${allUsers.length})</b>\n\n`;
    allUsers.slice(0, 20).forEach((u, i) => {
      const name = displayName(u.username, u.firstName);
      const ref = u.referredBy ? `реф: ${u.referredBy}` : "органик";
      text += `${i + 1}. ${name} <code>${u.telegramId}</code> (${ref})\n`;
      text += `   /user_${u.telegramId}\n`;
    });

    if (allUsers.length > 20) text += `\n… и ещё ${allUsers.length - 20}`;

    await ctx.replyWithHTML(text);
    await logAction(id, ctx.from.username, "ADMIN_USERS");
  });

  // ─── /user_[id] — детали пользователя ────────────────────────────────────
  bot.hears(/^\/user_(\d+)$/, async (ctx) => {
    const { id } = ctx.from;
    if (!isAdmin(id)) { await ctx.reply("⛔ Доступ запрещён."); return; }

    const telegramId = parseInt((ctx.match as RegExpMatchArray)[1]);
    const stats = await getUserDetailedStats(telegramId);

    if (!stats) {
      await ctx.reply(`❌ Пользователь ${telegramId} не найден.`);
      return;
    }

    const { user, link, totalEarned, refPurchases, refRevenue, ownOrders, ownOrdersTotal } = stats;
    const name = displayName(user.username, user.firstName);
    const refUrl = link ? `https://t.me/${BOT_USERNAME}?start=${link.code}` : "—";

    await ctx.replyWithHTML(
      `👤 <b>Пользователь: ${name}</b>\n` +
      `🆔 Telegram ID: <code>${telegramId}</code>\n` +
      (user.username ? `📛 Username: @${user.username}\n` : "") +
      `📅 Зарегистрирован: ${new Date(user.joinedAt).toLocaleString("ru-RU")}\n` +
      (user.referredBy ? `🔗 Пришёл от: <code>${user.referredBy}</code>\n` : "") +
      `\n` +
      `🔗 <b>Реферальная ссылка:</b>\n<code>${refUrl}</code>\n` +
      `👆 Кликов: <b>${link?.clickCount ?? 0}</b>\n` +
      `👥 Привлёк: <b>${link?.referredCount ?? 0}</b>\n` +
      `\n` +
      `📊 <b>Статистика покупок:</b>\n` +
      `🛒 Его покупок оплачено: <b>${ownOrders}</b> (${formatMoney(ownOrdersTotal)})\n` +
      `🎯 Покупок через его реф. ссылку: <b>${refPurchases}</b>\n` +
      `💰 Сумма рефер. покупок: <b>${formatMoney(refRevenue)}</b>\n` +
      `💸 Заработано реф. комиссий: <b>${formatMoney(totalEarned)}</b>`
    );
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
    if (!isAdmin(id)) { await ctx.reply("⛔ Доступ запрещён."); return; }

    const parts = ctx.message.text.split(" ").slice(1);
    const orderId = parseInt(parts[0]);
    if (isNaN(orderId)) {
      await ctx.reply("⚠️ Укажите ID заказа: /admin_confirm_order [id]");
      return;
    }

    const { db: dbInst } = await import("@/db");
    const { orders: ordersTable } = await import("@/db/schema");
    const { eq } = await import("drizzle-orm");

    const orderRows = await dbInst.select().from(ordersTable).where(eq(ordersTable.id, orderId)).limit(1);
    if (!orderRows[0]) {
      await ctx.reply(`❌ Заказ #${orderId} не найден.`);
      return;
    }

    await deliverOrder(ctx, orderId, orderRows[0].buyerTelegramId);
  });

  // ─── /admin_coupons ───────────────────────────────────────────────────────
  bot.command("admin_coupons", async (ctx) => {
    const { id } = ctx.from;
    if (!isAdmin(id)) { await ctx.reply("⛔ Доступ запрещён."); return; }

    const allCoupons = await getAllCoupons();
    if (allCoupons.length === 0) {
      await ctx.reply("Купонов нет. /admin_add_coupon — создать.");
      return;
    }

    let text = `🏷 <b>Все купоны (${allCoupons.length})</b>\n\n`;
    allCoupons.forEach((c) => {
      const status = c.isActive ? "✅" : "❌";
      const limit = c.usageLimit > 0 ? `${c.usageCount}/${c.usageLimit}` : `${c.usageCount}/∞`;
      const expires = c.expiresAt ? `до ${new Date(c.expiresAt).toLocaleDateString("ru-RU")}` : "бессрочно";
      text +=
        `${status} <code>${c.code}</code> — <b>-${c.discountPercent}%</b>\n` +
        `   Использований: ${limit} | ${expires}\n` +
        (c.isActive ? `   Деактивировать: /admin_deactivate_coupon_${c.id}\n` : "") +
        `\n`;
    });

    await ctx.replyWithHTML(text);
  });

  // ─── /admin_add_coupon ────────────────────────────────────────────────────
  bot.command("admin_add_coupon", async (ctx) => {
    const { id } = ctx.from;
    if (!isAdmin(id)) { await ctx.reply("⛔ Доступ запрещён."); return; }

    await setUserState(id, "admin_add_coupon_code", {});
    await ctx.reply(
      "🏷 Создание купона\n\nШаг 1/3: Введите <b>код купона</b> (латиницей, например: SUMMER20):",
      { parse_mode: "HTML" }
    );
  });

  // ─── /admin_deactivate_coupon_[id] ────────────────────────────────────────
  bot.hears(/^\/admin_deactivate_coupon_(\d+)$/, async (ctx) => {
    const { id } = ctx.from;
    if (!isAdmin(id)) { await ctx.reply("⛔ Доступ запрещён."); return; }

    const couponId = parseInt((ctx.match as RegExpMatchArray)[1]);
    await deactivateCoupon(couponId);
    await ctx.reply(`✅ Купон #${couponId} деактивирован.`);
  });

  // ─── FSM — обработка текстовых сообщений ─────────────────────────────────
  bot.on("text", async (ctx) => {
    const { id, username, first_name } = ctx.from;

    if (ctx.message.text.startsWith("/")) {
      if (!isAdmin(id)) {
        await ctx.reply("❓ Неизвестная команда.\n/shop /mylink /mystats /statistics");
      } else {
        await ctx.reply("❓ Неизвестная команда.\nИспользуйте /admin для списка команд.");
      }
      return;
    }

    const stateRow = await getUserState(id);
    if (!stateRow) return;

    const state = stateRow.state;
    const data = (stateRow.data as Record<string, unknown>) ?? {};
    const text = ctx.message.text.trim();

    // ─── Применение купона ────────────────────────────────────────────────
    if (state === "apply_coupon") {
      const productId = data.productId as number;
      const result = await validateCoupon(text);

      if (!result.valid || !result.coupon) {
        await clearUserState(id);
        await ctx.reply(`❌ ${result.error ?? "Купон недействителен"}.\n\nПопробуйте снова или вернитесь в /shop`);
        return;
      }

      const coupon = result.coupon;
      const product = await getProductById(productId);
      if (!product) { await clearUserState(id); return; }

      const originalPrice = parseFloat(product.price);
      const discountedPrice = +(originalPrice * (1 - coupon.discountPercent / 100)).toFixed(2);

      await clearUserState(id);
      await ctx.replyWithHTML(
        `✅ <b>Купон применён!</b>\n\n` +
        `🏷 Код: <code>${coupon.code}</code>\n` +
        `💸 Скидка: <b>${coupon.discountPercent}%</b>\n` +
        `💰 Было: <b>${formatMoney(originalPrice)}</b>\n` +
        `💚 Стало: <b>${formatMoney(discountedPrice)}</b>\n\n` +
        `Выберите способ оплаты:`,
        Markup.inlineKeyboard([
          [Markup.button.callback("💳 СБП (+10%)", `pay_sbp_coupon_${productId}_${coupon.code}`)],
          [Markup.button.callback("🏦 Карта (+10%)", `pay_card_coupon_${productId}_${coupon.code}`)],
          [Markup.button.callback("🪙 CryptoBot", `pay_crypto_coupon_${productId}_${coupon.code}`)],
          [Markup.button.callback("◀️ Назад", "back_to_shop")],
        ])
      );
      return;
    }

    // ─── Добавление товара ────────────────────────────────────────────────
    if (state === "admin_add_product_name") {
      if (!isAdmin(id)) { await clearUserState(id); return; }
      data.name = text;
      await setUserState(id, "admin_add_product_desc", data);
      await ctx.reply("Шаг 2/4: Введите <b>описание</b> (или «-» пропустить):", { parse_mode: "HTML" });
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
        await ctx.reply("⚠️ Введите корректную цену, например: 1500");
        return;
      }
      data.price = price;
      await setUserState(id, "admin_add_product_channel", data);
      await ctx.reply(
        "Шаг 4/4: Введите <b>ID канала/группы</b> для выдачи ссылки.\n" +
        "Например: <code>-1001234567890</code>\n\n" +
        "Или напишите «-» для цифрового контента:",
        { parse_mode: "HTML" }
      );
      return;
    }

    if (state === "admin_add_product_channel") {
      if (!isAdmin(id)) { await clearUserState(id); return; }

      if (text === "-") {
        await setUserState(id, "admin_add_product_digital", data);
        await ctx.reply(
          "Введите <b>цифровой контент</b> (текст, который получит покупатель):",
          { parse_mode: "HTML" }
        );
        return;
      } else {
        const channelId = text;
        const product = await createProduct({
          name: data.name as string,
          description: data.description as string | null,
          price: data.price as number,
          productType: "invite_link",
          channelId,
        });

        await clearUserState(id);
        await ctx.replyWithHTML(
          `✅ <b>Товар добавлен!</b>\n\n` +
          `🆔 ID: <code>${product.id}</code>\n` +
          `📦 Название: <b>${product.name}</b>\n` +
          `💵 Цена: <b>${formatMoney(product.price)}</b>\n` +
          `📡 Канал: <code>${channelId}</code>\n\n` +
          `⚠️ Убедитесь, что бот является администратором в канале!\n\n` +
          `Список: /admin_products`
        );
      }
      return;
    }

    if (state === "admin_add_product_digital") {
      if (!isAdmin(id)) { await clearUserState(id); return; }
      const product = await createProduct({
        name: data.name as string,
        description: data.description as string | null,
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
        `Список: /admin_products`
      );
      return;
    }

    // ─── Создание купона ──────────────────────────────────────────────────
    if (state === "admin_add_coupon_code") {
      if (!isAdmin(id)) { await clearUserState(id); return; }
      const code = text.toUpperCase().replace(/\s+/g, "");
      if (!/^[A-Z0-9_-]{2,20}$/.test(code)) {
        await ctx.reply("⚠️ Код должен содержать латинские буквы и цифры, 2-20 символов.");
        return;
      }
      data.couponCode = code;
      await setUserState(id, "admin_add_coupon_discount", data);
      await ctx.reply("Шаг 2/3: Введите <b>% скидки</b> (например: 20):", { parse_mode: "HTML" });
      return;
    }

    if (state === "admin_add_coupon_discount") {
      if (!isAdmin(id)) { await clearUserState(id); return; }
      const discount = parseInt(text);
      if (isNaN(discount) || discount < 1 || discount > 100) {
        await ctx.reply("⚠️ Введите число от 1 до 100");
        return;
      }
      data.discount = discount;
      await setUserState(id, "admin_add_coupon_limit", data);
      await ctx.reply(
        "Шаг 3/3: Введите <b>лимит использований</b> (0 = безлимитный):",
        { parse_mode: "HTML" }
      );
      return;
    }

    if (state === "admin_add_coupon_limit") {
      if (!isAdmin(id)) { await clearUserState(id); return; }
      const limit = parseInt(text);
      if (isNaN(limit) || limit < 0) {
        await ctx.reply("⚠️ Введите число 0 или больше");
        return;
      }

      const coupon = await createCoupon({
        code: data.couponCode as string,
        discountPercent: data.discount as number,
        usageLimit: limit,
      });

      await clearUserState(id);
      await ctx.replyWithHTML(
        `✅ <b>Купон создан!</b>\n\n` +
        `🏷 Код: <code>${coupon.code}</code>\n` +
        `💸 Скидка: <b>${coupon.discountPercent}%</b>\n` +
        `🔢 Лимит: <b>${coupon.usageLimit === 0 ? "∞" : coupon.usageLimit}</b>\n\n` +
        `Все купоны: /admin_coupons`
      );
      return;
    }
  });

  return bot;
}

// ─── Вспомогательная функция для инициации платежей ─────────────────────────

async function initiatePayment(
  ctx: Context,
  productId: number,
  method: "sbp" | "card" | "cryptobot",
  couponCode?: string
) {
  const PLATEGA_MERCHANT_ID = process.env.PLATEGA_MERCHANT_ID ?? "";
  const PLATEGA_SECRET_KEY = process.env.PLATEGA_SECRET_KEY ?? "";
  const WEBHOOK_BASE_URL = process.env.WEBHOOK_BASE_URL ?? "";
  const CRYPTOBOT_TOKEN = process.env.CRYPTOBOT_TOKEN ?? "";
  const USD_TO_RUB = parseFloat(process.env.USD_TO_RUB_RATE ?? "90");
  const BOT_USERNAME = process.env.TELEGRAM_BOT_USERNAME ?? "myrefbot";

  const product = await getProductById(productId);
  if (!product) return;

  const { id: telegramId, username, first_name } = ctx.from!;
  await getOrCreateUser(telegramId, username, first_name);

  let baseAmount = parseFloat(product.price);
  let discountPercent = 0;

  // Применить купон
  if (couponCode) {
    const result = await validateCoupon(couponCode);
    if (result.valid && result.coupon) {
      discountPercent = result.coupon.discountPercent;
      baseAmount = +(baseAmount * (1 - discountPercent / 100)).toFixed(2);
    }
  }

  let finalAmount = baseAmount;
  let amountLabel = formatMoney(baseAmount);

  // Для СБП и карты — добавляем 10% комиссию Platega
  if (method === "sbp" || method === "card") {
    finalAmount = calcAmountWithCommission(baseAmount);
    amountLabel = `${formatMoney(baseAmount)} + 10% = ${formatMoney(finalAmount)}`;
  }

  const order = await createOrder({
    buyerTelegramId: telegramId,
    productId,
    amount: baseAmount,
    paymentMethod: method,
    couponCode,
    discountPercent,
  });

  if (method === "sbp" || method === "card") {
    if (!PLATEGA_MERCHANT_ID) {
      await ctx.replyWithHTML(
        `💳 <b>Оплата через ${method === "sbp" ? "СБП" : "карту"}</b>\n\n` +
        `Товар: <b>${product.name}</b>\n` +
        `Сумма к оплате: <b>${formatMoney(finalAmount)}</b>\n` +
        (couponCode ? `🏷 Купон: <code>${couponCode}</code> (-${discountPercent}%)\n` : "") +
        `\n⚠️ Platega не настроена. ID заказа: <code>${order.id}</code>`
      );
      return;
    }

    // Создаём платёж через Platega
    const methodId = method === "sbp" ? 2 : 1;
    const { v4: uuidv4 } = await import("uuid");
    const txId = uuidv4();

    const body: Record<string, unknown> = {
      id: txId,
      merchant_id: PLATEGA_MERCHANT_ID,
      payment_method: methodId,
      payment_details: { amount: finalAmount, currency: "RUB" },
      description: `Оплата товара: ${product.name}`,
      return_url: `https://t.me/${BOT_USERNAME}`,
      failed_url: `https://t.me/${BOT_USERNAME}`,
      webhook_url: `${WEBHOOK_BASE_URL}/api/payment/platega`,
      order_id: `order_${order.id}`,
    };

    const crypto = await import("crypto");
    const sign = crypto
      .createHmac("sha256", PLATEGA_SECRET_KEY)
      .update(JSON.stringify(body))
      .digest("hex");

    let paymentUrl = "";
    try {
      const res = await import("axios").then((m) =>
        m.default.post("https://api.platega.io/v1/transaction/create", body, {
          headers: {
            "Content-Type": "application/json",
            "X-Merchant-ID": PLATEGA_MERCHANT_ID,
            "X-Signature": sign,
          },
        })
      );
      paymentUrl = res.data.redirect ?? res.data.payment_url ?? res.data.url ?? "";

      // Сохраняем external ID
      const { db } = await import("@/db");
      const { orders: ordersTable } = await import("@/db/schema");
      const { eq } = await import("drizzle-orm");
      await db.update(ordersTable).set({ externalPaymentId: txId }).where(eq(ordersTable.id, order.id));
    } catch (e) {
      console.error("Platega error:", e);
      await ctx.reply("❌ Ошибка создания платежа. Попробуйте позже.");
      return;
    }

    if (!paymentUrl) {
      await ctx.reply("❌ Не удалось получить ссылку на оплату. Попробуйте позже.");
      return;
    }

    const emoji = method === "sbp" ? "💳" : "🏦";
    const label = method === "sbp" ? "СБП" : "банковской картой";

    await ctx.replyWithHTML(
      `${emoji} <b>Оплата ${label}</b>\n\n` +
      `📦 Товар: <b>${product.name}</b>\n` +
      (couponCode ? `🏷 Купон: <code>${couponCode}</code> (-${discountPercent}%)\n` : "") +
      `💰 Сумма: <b>${amountLabel}</b>\n\n` +
      `Нажмите кнопку ниже для оплаты:`,
      Markup.inlineKeyboard([
        [Markup.button.url(`${emoji} Оплатить ${label}`, paymentUrl)],
      ])
    );
  } else if (method === "cryptobot") {
    if (!CRYPTOBOT_TOKEN) {
      await ctx.replyWithHTML(
        `🪙 <b>Оплата CryptoBot</b>\n\n` +
        `Товар: <b>${product.name}</b>\n` +
        `Сумма: <b>${formatMoney(baseAmount)}</b>\n` +
        `\n⚠️ CryptoBot не настроен. ID заказа: <code>${order.id}</code>`
      );
      return;
    }

    // Конвертируем рубли в USDT
    const amountUsdt = +(baseAmount / USD_TO_RUB).toFixed(2);

    const invoice = await (async () => {
      try {
        const res = await import("axios").then((m) =>
          m.default.post(
            "https://pay.crypt.bot/api/createInvoice",
            {
              asset: "USDT",
              amount: amountUsdt.toString(),
              description: `Оплата товара: ${product.name}`,
              payload: `order_${order.id}`,
              paid_btn_name: "callback",
              paid_btn_url: `${WEBHOOK_BASE_URL}/api/payment/cryptobot`,
            },
            { headers: { "Crypto-Pay-API-Token": CRYPTOBOT_TOKEN } }
          )
        );
        const inv = res.data.result;
        return { invoiceUrl: inv.pay_url, invoiceId: String(inv.invoice_id) };
      } catch (e) {
        console.error("CryptoBot error:", e);
        return null;
      }
    })();

    if (!invoice) {
      await ctx.reply("❌ Ошибка создания платежа CryptoBot. Попробуйте позже.");
      return;
    }

    const { db } = await import("@/db");
    const { orders: ordersTable } = await import("@/db/schema");
    const { eq } = await import("drizzle-orm");
    await db.update(ordersTable).set({ externalPaymentId: invoice.invoiceId }).where(eq(ordersTable.id, order.id));

    await ctx.replyWithHTML(
      `🪙 <b>Оплата CryptoBot</b>\n\n` +
      `📦 Товар: <b>${product.name}</b>\n` +
      (couponCode ? `🏷 Купон: <code>${couponCode}</code> (-${discountPercent}%)\n` : "") +
      `💰 Сумма: <b>${formatMoney(baseAmount)}</b>\n` +
      `💎 USDT: <b>${amountUsdt} USDT</b>\n\n` +
      `Нажмите кнопку для оплаты:`,
      Markup.inlineKeyboard([
        [Markup.button.url("🪙 Оплатить через CryptoBot", invoice.invoiceUrl)],
      ])
    );
  }

  // Применяем купон (увеличиваем счётчик)
  if (couponCode && discountPercent > 0) {
    await useCoupon(couponCode);
  }
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
  const {
    markOrderPaid,
    getProductById,
    recordPurchase,
    getUserByTelegramId,
    displayName: dispName,
    formatMoney: fmtMoney,
  } = await import("./helpers");

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
      const inviteLink = await ctx.telegram.createChatInviteLink(product.channelId, {
        creates_join_request: false,
        member_limit: 1,
      });
      deliveredContent = inviteLink.invite_link;
    } catch (e) {
      console.error("Ошибка создания ссылки:", e);
      deliveredContent = "❌ Не удалось создать ссылку. Обратитесь к администратору.";
    }
  } else if (product.productType === "digital" && product.digitalContent) {
    deliveredContent = product.digitalContent;
  }

  await markOrderPaid(orderId, deliveredContent);
  await recordPurchase(buyerTelegramId, parseFloat(order.amount), product.name);

  try {
    if (product.productType === "invite_link") {
      await ctx.telegram.sendMessage(
        buyerTelegramId,
        `✅ <b>Оплата подтверждена!</b>\n\n` +
        `📦 Товар: <b>${product.name}</b>\n\n` +
        `🔗 Ваша одноразовая ссылка:\n${deliveredContent}\n\n` +
        `⚠️ Ссылка одноразовая — не передавайте её!`,
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
    console.error("Ошибка отправки товара:", e);
  }

  await ctx.reply(
    `✅ Заказ #${orderId} выполнен.\n` +
    `Пользователю <code>${buyerTelegramId}</code> отправлен товар «${product.name}».`,
    { parse_mode: "HTML" }
  );

  const buyer = await getUserByTelegramId(buyerTelegramId);
  if (buyer?.referredBy) {
    const commission = parseFloat(order.amount) * 0.1;
    try {
      await ctx.telegram.sendMessage(
        buyer.referredBy,
        `🎉 <b>Вы получили реферальную комиссию!</b>\n\n` +
        `Ваш реферал ${dispName(buyer.username, buyer.firstName)} купил «${product.name}».\n` +
        `💰 Ваша комиссия (10%): <b>${fmtMoney(commission)}</b>\n\n` +
        `/mystats — ваш заработок`,
        { parse_mode: "HTML" }
      );
    } catch {
      // реферер недоступен
    }
  }
}
