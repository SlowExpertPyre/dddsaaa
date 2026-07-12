import { NextRequest, NextResponse } from "next/server";
import { recordPurchase, getUserByTelegramId, logAction } from "@/lib/bot/helpers";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const body = await req.json();
  const { buyerTelegramId, amount, description } = body;

  if (!buyerTelegramId || !amount || isNaN(Number(amount)) || Number(amount) <= 0) {
    return NextResponse.json({ error: "Invalid params" }, { status: 400 });
  }

  const buyer = await getUserByTelegramId(Number(buyerTelegramId));
  if (!buyer) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }

  const result = await recordPurchase(Number(buyerTelegramId), Number(amount), description);
  await logAction(null, "web_admin", "PURCHASE_RECORDED", `buyer=${buyerTelegramId} amount=${amount}`);

  return NextResponse.json({ ok: true, ...result });
}
