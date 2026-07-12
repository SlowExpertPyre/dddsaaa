import { db } from "@/db";
import {
  users,
  referralLinks,
  purchases,
  earnings,
  botLogs,
  orders,
  products,
  userStates,
} from "@/db/schema";
import { eq, sql, desc } from "drizzle-orm";

// ─── Пользователи ────────────────────────────────────────────────────────────

export async function getOrCreateUser(
  telegramId: number,
  username?: string,
  firstName?: string,
  lastName?: string,
  referralCode?: string
) {
  const existing = await db
    .select()
    .from(users)
    .where(eq(users.telegramId, telegramId))
    .limit(1);

  if (existing.length > 0) {
    // обновим имя если изменилось
    await db
      .update(users)
      .set({ username, firstName, lastName })
      .where(eq(users.telegramId, telegramId));
    return existing[0];
  }

  // Найти реферера по коду
  let referredBy: number | undefined;
  if (referralCode) {
    const link = await db
      .select()
      .from(referralLinks)
      .where(eq(referralLinks.code, referralCode))
      .limit(1);
    if (link.length > 0 && link[0].ownerId !== telegramId) {
      referredBy = link[0].ownerId;
      await db
        .update(referralLinks)
        .set({ referredCount: sql`${referralLinks.referredCount} + 1` })
        .where(eq(referralLinks.code, referralCode));
    }
  }

  const [newUser] = await db
    .insert(users)
    .values({ telegramId, username, firstName, lastName, referredBy })
    .returning();

  // Создать реферальную ссылку
  const code = username ?? `user${telegramId}`;
  const existingCode = await db
    .select()
    .from(referralLinks)
    .where(eq(referralLinks.code, code))
    .limit(1);
  if (existingCode.length === 0) {
    await db.insert(referralLinks).values({
      ownerId: telegramId,
      ownerUsername: username,
      code,
    });
  }

  await ensureEarningsRow(telegramId, username, firstName);
  await logAction(telegramId, username, "JOIN", referredBy ? `via ${referralCode}` : "organic");

  return newUser;
}

export async function getUserByTelegramId(telegramId: number) {
  const rows = await db
    .select()
    .from(users)
    .where(eq(users.telegramId, telegramId))
    .limit(1);
  return rows[0] ?? null;
}

// ─── Реферальные ссылки ──────────────────────────────────────────────────────

export async function getReferralLink(telegramId: number) {
  const rows = await db
    .select()
    .from(referralLinks)
    .where(eq(referralLinks.ownerId, telegramId))
    .limit(1);
  return rows[0] ?? null;
}

export async function getAllReferralLinksWithStats() {
  return db
    .select()
    .from(referralLinks)
    .orderBy(desc(referralLinks.referredCount));
}

export async function incrementLinkClick(code: string) {
  await db
    .update(referralLinks)
    .set({ clickCount: sql`${referralLinks.clickCount} + 1` })
    .where(eq(referralLinks.code, code));
}

// ─── Товары ──────────────────────────────────────────────────────────────────

export async function getActiveProducts() {
  return db
    .select()
    .from(products)
    .where(eq(products.isActive, true))
    .orderBy(products.id);
}

export async function getProductById(id: number) {
  const rows = await db.select().from(products).where(eq(products.id, id)).limit(1);
  return rows[0] ?? null;
}

export async function createProduct(data: {
  name: string;
  description?: string;
  price: number;
  productType: string;
  channelId?: string;
  digitalContent?: string;
}) {
  const [p] = await db
    .insert(products)
    .values({
      name: data.name,
      description: data.description,
      price: data.price.toString(),
      productType: data.productType,
      channelId: data.channelId,
      digitalContent: data.digitalContent,
    })
    .returning();
  return p;
}

export async function updateProduct(
  id: number,
  data: Partial<{
    name: string;
    description: string;
    price: number;
    productType: string;
    channelId: string;
    digitalContent: string;
    isActive: boolean;
  }>
) {
  const updateData: Record<string, unknown> = {};
  if (data.name !== undefined) updateData.name = data.name;
  if (data.description !== undefined) updateData.description = data.description;
  if (data.price !== undefined) updateData.price = data.price.toString();
  if (data.productType !== undefined) updateData.productType = data.productType;
  if (data.channelId !== undefined) updateData.channelId = data.channelId;
  if (data.digitalContent !== undefined) updateData.digitalContent = data.digitalContent;
  if (data.isActive !== undefined) updateData.isActive = data.isActive;

  await db.update(products).set(updateData).where(eq(products.id, id));
}

export async function deleteProduct(id: number) {
  await db.update(products).set({ isActive: false }).where(eq(products.id, id));
}

// ─── Заказы ──────────────────────────────────────────────────────────────────

export async function createOrder(data: {
  buyerTelegramId: number;
  productId: number;
  amount: number;
  paymentMethod: string;
  externalPaymentId?: string;
}) {
  const buyer = await getUserByTelegramId(data.buyerTelegramId);
  const referrerTelegramId = buyer?.referredBy ?? null;
  const commission = +(data.amount * 0.5).toFixed(2);

  const [order] = await db
    .insert(orders)
    .values({
      buyerTelegramId: data.buyerTelegramId,
      referrerTelegramId,
      productId: data.productId,
      amount: data.amount.toString(),
      commission: commission.toString(),
      paymentMethod: data.paymentMethod,
      status: "pending",
      externalPaymentId: data.externalPaymentId,
    })
    .returning();
  return order;
}

export async function getOrderByExternalId(externalId: string) {
  const rows = await db
    .select()
    .from(orders)
    .where(eq(orders.externalPaymentId, externalId))
    .limit(1);
  return rows[0] ?? null;
}

export async function getOrderById(id: number) {
  const rows = await db.select().from(orders).where(eq(orders.id, id)).limit(1);
  return rows[0] ?? null;
}

export async function markOrderPaid(
  orderId: number,
  deliveredLink?: string
) {
  await db
    .update(orders)
    .set({
      status: "paid",
      paidAt: new Date(),
      deliveredLink: deliveredLink ?? null,
    })
    .where(eq(orders.id, orderId));
}

export async function getRecentOrders(limit = 20) {
  return db.select().from(orders).orderBy(desc(orders.createdAt)).limit(limit);
}

// ─── Покупки / начисления ────────────────────────────────────────────────────

export async function recordPurchase(
  buyerTelegramId: number,
  amount: number,
  description?: string
) {
  const buyer = await getUserByTelegramId(buyerTelegramId);
  const referrerTelegramId = buyer?.referredBy ?? null;
  const commission = +(amount * 0.5).toFixed(2);

  const [purchase] = await db
    .insert(purchases)
    .values({
      buyerTelegramId,
      referrerTelegramId,
      amount: amount.toString(),
      commission: commission.toString(),
      description,
    })
    .returning();

  if (referrerTelegramId) {
    await db
      .insert(earnings)
      .values({ telegramId: referrerTelegramId, totalEarned: commission.toString() })
      .onConflictDoUpdate({
        target: earnings.telegramId,
        set: {
          totalEarned: sql`${earnings.totalEarned} + ${commission}`,
          updatedAt: sql`now()`,
        },
      });
  }

  return { purchase, commission, referrerTelegramId };
}

// ─── Лидерборд ───────────────────────────────────────────────────────────────

export async function getTopEarners(limit = 5) {
  return db
    .select()
    .from(earnings)
    .orderBy(desc(earnings.totalEarned))
    .limit(limit);
}

export async function getEarningsByTelegramId(telegramId: number) {
  const rows = await db
    .select()
    .from(earnings)
    .where(eq(earnings.telegramId, telegramId))
    .limit(1);
  return rows[0] ?? null;
}

// ─── Статистика ──────────────────────────────────────────────────────────────

export async function getTotalStats() {
  const [userCount] = await db.select({ count: sql<number>`count(*)::int` }).from(users);
  const [linkCount] = await db.select({ count: sql<number>`count(*)::int` }).from(referralLinks);
  const [purchaseStats] = await db.select({
    count: sql<number>`count(*)::int`,
    total: sql<string>`coalesce(sum(amount),0)::text`,
    commissions: sql<string>`coalesce(sum(commission),0)::text`,
  }).from(purchases);
  const [orderStats] = await db.select({
    count: sql<number>`count(*)::int`,
    total: sql<string>`coalesce(sum(amount),0)::text`,
  }).from(orders).where(eq(orders.status, "paid"));
  const [earningsStats] = await db.select({
    total: sql<string>`coalesce(sum(total_earned),0)::text`,
  }).from(earnings);

  return {
    users: userCount.count,
    links: linkCount.count,
    purchases: purchaseStats.count,
    totalRevenue: purchaseStats.total,
    totalCommissions: purchaseStats.commissions,
    totalPaidOut: earningsStats.total,
    paidOrders: orderStats.count,
    ordersRevenue: orderStats.total,
  };
}

export async function getAllUsers() {
  return db.select().from(users).orderBy(desc(users.joinedAt));
}

export async function getRecentPurchases(limit = 20) {
  return db.select().from(purchases).orderBy(desc(purchases.createdAt)).limit(limit);
}

// ─── Состояние FSM ───────────────────────────────────────────────────────────

export async function getUserState(telegramId: number) {
  const rows = await db
    .select()
    .from(userStates)
    .where(eq(userStates.telegramId, telegramId))
    .limit(1);
  return rows[0] ?? null;
}

export async function setUserState(
  telegramId: number,
  state: string,
  data?: Record<string, unknown>
) {
  await db
    .insert(userStates)
    .values({ telegramId, state, data: data ?? {}, updatedAt: new Date() })
    .onConflictDoUpdate({
      target: userStates.telegramId,
      set: { state, data: data ?? {}, updatedAt: new Date() },
    });
}

export async function clearUserState(telegramId: number) {
  await db.delete(userStates).where(eq(userStates.telegramId, telegramId));
}

// ─── Вспомогательные ─────────────────────────────────────────────────────────

export async function ensureEarningsRow(
  telegramId: number,
  username?: string,
  firstName?: string
) {
  await db
    .insert(earnings)
    .values({ telegramId, username, firstName, totalEarned: "0" })
    .onConflictDoUpdate({
      target: earnings.telegramId,
      set: { username, firstName },
    });
}

export async function logAction(
  telegramId: number | null,
  username: string | undefined,
  action: string,
  detail?: string
) {
  await db.insert(botLogs).values({ telegramId, username, action, detail });
}

export function formatMoney(val: string | number | null | undefined): string {
  const n = parseFloat(String(val ?? "0"));
  return (
    n.toLocaleString("ru-RU", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }) + " ₽"
  );
}

export function displayName(
  username?: string | null,
  firstName?: string | null
): string {
  if (username) return `@${username}`;
  if (firstName) return firstName;
  return "Неизвестный";
}

// ─── Расчёт звёзд ────────────────────────────────────────────────────────────
// Комиссия Fragment: ~7%
// Комиссия Telegram при конвертации подарков в звёзды: ~30%
// Итого при оплате подарками: делим сумму на курс звезды и добавляем обе комиссии

export function calcStarsByUsername(
  amountRub: number,
  fragmentRateRubPerStar: number
): number {
  // Оплата по юзернейму через Fragment: только комиссия Fragment ~7%
  const starsRaw = amountRub / fragmentRateRubPerStar;
  const starsWithFee = starsRaw * 1.07; // +7% комиссия Fragment
  // Округляем вниз до кратного 50
  return Math.floor(starsWithFee / 50) * 50;
}

export function calcStarsByGift(
  amountRub: number,
  fragmentRateRubPerStar: number
): number {
  // Оплата подарками: комиссия Fragment ~7% + комиссия ТГ при конвертации подарков в звёзды ~30%
  // Общая: multiply by 1/((1-0.07)*(1-0.30)) = 1/(0.93*0.70) ≈ 1.537
  const starsRaw = amountRub / fragmentRateRubPerStar;
  const starsWithFees = starsRaw * (1 / (0.93 * 0.70)); // обе комиссии
  // Округляем вниз до кратного 50
  return Math.floor(starsWithFees / 50) * 50;
}
