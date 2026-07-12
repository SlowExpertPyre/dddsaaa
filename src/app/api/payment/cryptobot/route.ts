import { NextRequest, NextResponse } from "next/server";
import { createBot } from "@/lib/bot/bot";
import { getOrderByExternalId } from "@/lib/bot/helpers";

export const dynamic = "force-dynamic";

// CryptoBot webhook — автоматически подтверждает оплату
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();

    // Верификация: проверяем секрет CryptoBot через заголовок
    const cryptoBotToken = process.env.CRYPTOBOT_TOKEN ?? "";

    // Проверка подписи (crypto-pay-api-signature header)
    const signature = req.headers.get("crypto-pay-api-signature");
    if (cryptoBotToken && signature) {
      const crypto = await import("crypto");
      const secret = crypto.createHash("sha256").update(cryptoBotToken).digest();
      const checkString = JSON.stringify(body);
      const hmac = crypto.createHmac("sha256", secret).update(checkString).digest("hex");

      if (hmac !== signature) {
        console.warn("CryptoBot: неверная подпись webhook");
        return NextResponse.json({ ok: false, error: "Invalid signature" }, { status: 401 });
      }
    }

    // Обрабатываем событие
    if (body.update_type === "invoice_paid") {
      const invoice = body.payload;
      const invoiceId = String(invoice.invoice_id);
      const payload = invoice.payload; // "order_123"

      let orderId: number | null = null;

      // Сначала пробуем найти по payload
      if (payload && payload.startsWith("order_")) {
        orderId = parseInt(payload.replace("order_", ""));
      }

      // Если не нашли — ищем по invoice_id
      if (!orderId) {
        const order = await getOrderByExternalId(invoiceId);
        if (order) orderId = order.id;
      }

      if (!orderId) {
        console.error("CryptoBot webhook: заказ не найден для invoice", invoiceId);
        return NextResponse.json({ ok: true }); // Возвращаем ok чтобы не получать retry
      }

      // Получаем заказ из БД
      const { db } = await import("@/db");
      const { orders } = await import("@/db/schema");
      const { eq } = await import("drizzle-orm");

      const orderRows = await db.select().from(orders).where(eq(orders.id, orderId)).limit(1);
      const order = orderRows[0];

      if (!order || order.status === "paid") {
        return NextResponse.json({ ok: true });
      }

      // Создаём фиктивный контекст для deliverOrder
      const bot = createBot();
      if (!bot) return NextResponse.json({ ok: true });

      // Выдаём товар напрямую
      const { deliverOrder } = await import("@/lib/bot/bot");
      // deliverOrder требует ctx — используем Telegram API напрямую
      await processOrderDelivery(orderId, order.buyerTelegramId, bot);
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("CryptoBot webhook error:", err);
    return NextResponse.json({ ok: false, error: String(err) }, { status: 500 });
  }
}

export async function GET() {
  return NextResponse.json({ ok: true, message: "CryptoBot webhook активен" });
}

// Выдача заказа без ctx (через прямые Telegram API вызовы)
async function processOrderDelivery(orderId: number, buyerTelegramId: number, bot: NonNullable<ReturnType<typeof createBot>>) {
  const { db } = await import("@/db");
  const { orders } = await import("@/db/schema");
  const { eq } = await import("drizzle-orm");
  const { getProductById, markOrderPaid, recordPurchase, getUserByTelegramId, displayName, formatMoney } = await import("@/lib/bot/helpers");

  const orderRows = await db.select().from(orders).where(eq(orders.id, orderId)).limit(1);
  const order = orderRows[0];
  if (!order || order.status === "paid") return;

  const product = await getProductById(order.productId);
  if (!product) return;

  let deliveredContent = "";

  if (product.productType === "invite_link" && product.channelId) {
    try {
      const inviteLink = await bot.telegram.createChatInviteLink(product.channelId, {
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
      await bot.telegram.sendMessage(
        buyerTelegramId,
        `✅ <b>Оплата подтверждена!</b>\n\n` +
        `📦 Товар: <b>${product.name}</b>\n\n` +
        `🔗 Ваша одноразовая ссылка:\n${deliveredContent}\n\n` +
        `⚠️ Ссылка одноразовая — не передавайте её другим!`,
        { parse_mode: "HTML" }
      );
    } else {
      await bot.telegram.sendMessage(
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

  // Реферальное уведомление
  const buyer = await getUserByTelegramId(buyerTelegramId);
  if (buyer?.referredBy) {
    const commission = parseFloat(order.amount) * 0.5;
    try {
      await bot.telegram.sendMessage(
        buyer.referredBy,
        `🎉 <b>Вы получили комиссию!</b>\n\n` +
        `Ваш реферал купил «${product.name}».\n` +
        `💰 Ваша комиссия (50%): <b>${formatMoney(commission)}</b>\n\n` +
        `/mystats — ваш заработок`,
        { parse_mode: "HTML" }
      );
    } catch {
      // реферер недоступен
    }
  }
}
