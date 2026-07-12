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
  coupons,
} from "@/db/schema";
import { eq, sql, desc, and } from "drizzle-orm";

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
  description?: string | null;
  price: number;
  productType: string;
  channelId?: string;
  digitalContent?: string;
}) {
  const [p] = await db
    .insert(products)
    .values({
      name: data.name,
      description: data.description ?? null,
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

// ─── Купоны ──────────────────────────────────────────────────────────────────

export async function getCouponByCode(code: string) {
  const rows = await db
    .select()
    .from(coupons)
    .where(eq(coupons.code, code.toUpperCase()))
    .limit(1);
  return rows[0] ?? null;
}

export async function validateCoupon(code: string): Promise<{
  valid: boolean;
  coupon?: typeof coupons.$inferSelect;
  error?: string;
}> {
  const coupon = await getCouponByCode(code);
  if (!coupon) return { valid: false, error: "Купон не найден" };
  if (!coupon.isActive) return { valid: false, error: "Купон деактивирован" };
  if (coupon.expiresAt && new Date() > coupon.expiresAt) {
    return { valid: false, error: "Купон истёк" };
  }
  if (coupon.usageLimit > 0 && coupon.usageCount >= coupon.usageLimit) {
    return { valid: false, error: "Купон исчерпан" };
  }
  return { valid: true, coupon };
}

export async function useCoupon(code: string) {
  await db
    .update(coupons)
    .set({ usageCount: sql`${coupons.usageCount} + 1` })
    .where(eq(coupons.code, code.toUpperCase()));
}

export async function createCoupon(data: {
  code: string;
  discountPercent: number;
  usageLimit?: number;
  expiresAt?: Date;
}) {
  const [c] = await db
    .insert(coupons)
    .values({
      code: data.code.toUpperCase(),
      discountPercent: data.discountPercent,
      usageLimit: data.usageLimit ?? 0,
      expiresAt: data.expiresAt,
    })
    .returning();
  return c;
}

export async function getAllCoupons() {
  return db.select().from(coupons).orderBy(desc(coupons.createdAt));
}

export async function deactivateCoupon(id: number) {
  await db.update(coupons).set({ isActive: false }).where(eq(coupons.id, id));
}

// ─── Заказы ──────────────────────────────────────────────────────────────────

export async function createOrder(data: {
  buyerTelegramId: number;
  productId: number;
  amount: number;
  paymentMethod: string;
  externalPaymentId?: string;
  couponCode?: string;
  discountPercent?: number;
}) {
  const buyer = await getUserByTelegramId(data.buyerTelegramId);
  const referrerTelegramId = buyer?.referredBy ?? null;
  // Комиссия 10% от суммы
  const commission = +(data.amount * 0.1).toFixed(2);

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
      couponCode: data.couponCode,
      discountPercent: data.discountPercent ?? 0,
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

export async function markOrderPaid(orderId: number, deliveredLink?: string) {
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
  // Реферальная комиссия: 10% от суммы
  const commission = +(amount * 0.1).toFixed(2);

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

// ─── Детальная статистика пользователя (для /users/:id) ─────────────────────

export async function getUserDetailedStats(telegramId: number) {
  const user = await getUserByTelegramId(telegramId);
  if (!user) return null;

  const link = await getReferralLink(telegramId);
  const earned = await getEarningsByTelegramId(telegramId);

  // Покупки, сделанные через реферальную ссылку этого пользователя
  const [refPurchaseStats] = await db.select({
    count: sql<number>`count(*)::int`,
    total: sql<string>`coalesce(sum(amount),0)::text`,
  }).from(purchases).where(eq(purchases.referrerTelegramId, telegramId));

  // Покупки, сделанные самим пользователем
  const [ownPurchaseStats] = await db.select({
    count: sql<number>`count(*)::int`,
    total: sql<string>`coalesce(sum(amount),0)::text`,
  }).from(purchases).where(eq(purchases.buyerTelegramId, telegramId));

  // Оплаченные заказы самого пользователя
  const [ownOrderStats] = await db.select({
    count: sql<number>`count(*)::int`,
    total: sql<string>`coalesce(sum(amount),0)::text`,
  }).from(orders).where(
    and(eq(orders.buyerTelegramId, telegramId), eq(orders.status, "paid"))
  );

  return {
    user,
    link,
    totalEarned: earned?.totalEarned ?? "0",
    refPurchases: refPurchaseStats.count,
    refRevenue: refPurchaseStats.total,
    ownPurchases: ownPurchaseStats.count,
    ownSpent: ownPurchaseStats.total,
    ownOrders: ownOrderStats.count,
    ownOrdersTotal: ownOrderStats.total,
  };
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

export function calcStarsByUsername(
  amountRub: number,
  fragmentRateRubPerStar: number
): number {
  const starsRaw = amountRub / fragmentRateRubPerStar;
  const starsWithFee = starsRaw * 1.07;
  return Math.floor(starsWithFee / 50) * 50;
}

export function calcStarsByGift(
  amountRub: number,
  fragmentRateRubPerStar: number
): number {
  // 1400 звёзд фиксированно для подарка (как указано в задании)
  // Но также считаем динамически
  const starsRaw = amountRub / fragmentRateRubPerStar;
  const starsWithFees = starsRaw * (1 / (0.93 * 0.70));
  return Math.floor(starsWithFees / 50) * 50;
}

// ─── Расчёт суммы с комиссией 10% для Platega ────────────────────────────────

export function calcAmountWithCommission(baseAmount: number): number {
  return +(baseAmount * 1.1).toFixed(2);
}
