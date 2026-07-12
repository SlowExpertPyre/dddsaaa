import { NextResponse } from "next/server";
import { db } from "@/db";
import { users, referralLinks, purchases, orders, earnings } from "@/db/schema";
import { desc, eq, sql, and } from "drizzle-orm";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const allUsers = await db
      .select()
      .from(users)
      .orderBy(desc(users.joinedAt));

    // Добавляем статистику для каждого пользователя
    const enriched = await Promise.all(
      allUsers.map(async (u) => {
        const [link] = await db
          .select()
          .from(referralLinks)
          .where(eq(referralLinks.ownerId, u.telegramId))
          .limit(1);

        const [earned] = await db
          .select()
          .from(earnings)
          .where(eq(earnings.telegramId, u.telegramId))
          .limit(1);

        const [refStats] = await db
          .select({
            count: sql<number>`count(*)::int`,
            total: sql<string>`coalesce(sum(amount),0)::text`,
          })
          .from(purchases)
          .where(eq(purchases.referrerTelegramId, u.telegramId));

        const [ownOrders] = await db
          .select({
            count: sql<number>`count(*)::int`,
            total: sql<string>`coalesce(sum(amount),0)::text`,
          })
          .from(orders)
          .where(
            and(
              eq(orders.buyerTelegramId, u.telegramId),
              eq(orders.status, "paid")
            )
          );

        return {
          ...u,
          referralCode: link?.code ?? null,
          referralClicks: link?.clickCount ?? 0,
          referralCount: link?.referredCount ?? 0,
          totalEarned: earned?.totalEarned ?? "0",
          refPurchases: refStats.count,
          refRevenue: refStats.total,
          ownOrders: ownOrders.count,
          ownSpent: ownOrders.total,
        };
      })
    );

    return NextResponse.json({ ok: true, users: enriched });
  } catch (err) {
    console.error("Admin users error:", err);
    return NextResponse.json(
      { ok: false, error: String(err) },
      { status: 500 }
    );
  }
}
