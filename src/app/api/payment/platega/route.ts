import { NextRequest, NextResponse } from "next/server";
import { createBot } from "@/lib/bot/bot";

export const dynamic = "force-dynamic";

// Platega webhook — автоматически подтверждает оплату СБП/карта
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();

    // Верификация подписи Platega
    const secretKey = process.env.PLATEGA_SECRET_KEY ?? "";
    if (secretKey) {
      const signature =
        req.headers.get("x-signature") ??
        req.headers.get("x-api-sign") ??
        req.headers.get("x-platega-signature") ??
        "";
      if (signature) {
        const crypto = await import("crypto");
        const expected = crypto
          .createHmac("sha256", secretKey)
          .update(JSON.stringify(body))
          .digest("hex");

        if (expected !== signature) {
          console.warn("Platega: неверная подпись webhook");
          return NextResponse.json({ ok: false, error: "Invalid signature" }, { status: 401 });
        }
      }
    }

    console.log("Platega webhook body:", JSON.stringify(body));

    // Platega отправляет статус транзакции
    // Поля: status, transaction_id / id, order_id
    const status = body.status ?? body.payment_status ?? body.state;
    const orderId_raw = body.order_id ?? body.orderId ?? body.payload;
    const paymentId = body.transaction_id ?? body.id ?? body.payment_id;

    const isPaid =
      status === "confirmed" ||
      status === "paid" ||
      status === "success" ||
      status === "completed" ||
      status === "CONFIRMED";

    if (!isPaid) {
      console.log("Platega: игнорируем событие статуса:", status);
      return NextResponse.json({ ok: true, message: "Событие проигнорировано" });
    }

    // Парсим ID заказа из "order_123"
    let orderId: number | null = null;
    if (orderId_raw && String(orderId_raw).startsWith("order_")) {
      orderId = parseInt(String(orderId_raw).replace("order_", ""));
    }

    if (!orderId && paymentId) {
      const { getOrderByExternalId } = await import("@/lib/bot/helpers");
      const order = await getOrderByExternalId(String(paymentId));
      if (order) orderId = order.id;
    }

    if (!orderId) {
      console.error("Platega webhook: заказ не найден", body);
      return NextResponse.json({ ok: true });
    }

    const { db } = await import("@/db");
    const { orders } = await import("@/db/schema");
    const { eq } = await import("drizzle-orm");

    const orderRows = await db.select().from(orders).where(eq(orders.id, orderId)).limit(1);
    const order = orderRows[0];

    if (!order || order.status === "paid") {
      return NextResponse.json({ ok: true });
    }

    const bot = createBot();
    if (!bot) return NextResponse.json({ ok: true });

    await processOrderDelivery(orderId, order.buyerTelegramId, bot);

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("Platega webhook error:", err);
    return NextResponse.json({ ok: false, error: String(err) }, { status: 500 });
  }
}

export async function GET() {
  return NextResponse.json({ ok: true, message: "Platega webhook активен" });
}

async function processOrderDelivery(
  orderId: number,
  buyerTelegramId: number,
  bot: NonNullable<ReturnType<typeof createBot>>
) {
  const { db } = await import("@/db");
  const { orders } = await import("@/db/schema");
  const { eq } = await import("drizzle-orm");
  const {
    getProductById,
    markOrderPaid,
    recordPurchase,
    getUserByTelegramId,
    formatMoney,
  } = await import("@/lib/bot/helpers");

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

  const methodLabel: Record<string, string> = {
    sbp: "СБП",
    card: "банковской картой",
  };
  const label = methodLabel[order.paymentMethod] ?? order.paymentMethod;

  try {
    if (product.productType === "invite_link") {
      await bot.telegram.sendMessage(
        buyerTelegramId,
        `✅ <b>Оплата ${label} подтверждена!</b>\n\n` +
          `📦 Товар: <b>${product.name}</b>\n\n` +
          `🔗 Ваша одноразовая ссылка:\n${deliveredContent}\n\n` +
          `⚠️ Ссылка одноразовая — не передавайте её другим!`,
        { parse_mode: "HTML" }
      );
    } else {
      await bot.telegram.sendMessage(
        buyerTelegramId,
        `✅ <b>Оплата ${label} подтверждена!</b>\n\n` +
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
    const commission = parseFloat(order.amount) * 0.1;
    try {
      await bot.telegram.sendMessage(
        buyer.referredBy,
        `🎉 <b>Вы получили реферальную комиссию!</b>\n\n` +
          `Ваш реферал купил «${product.name}».\n` +
          `💰 Ваша комиссия (10%): <b>${formatMoney(commission)}</b>\n\n` +
          `/mystats — ваш заработок`,
        { parse_mode: "HTML" }
      );
    } catch {
      // реферер недоступен
    }
  }
}
