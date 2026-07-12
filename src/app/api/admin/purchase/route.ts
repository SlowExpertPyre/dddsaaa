import { NextRequest, NextResponse } from "next/server";
import { getUserByTelegramId, recordPurchase } from "@/lib/bot/helpers";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    const { buyerTelegramId, amount, description } = await req.json();

    if (!buyerTelegramId || !amount || amount <= 0) {
      return NextResponse.json({ ok: false, error: "Неверные параметры" }, { status: 400 });
    }

    const buyer = await getUserByTelegramId(buyerTelegramId);
    if (!buyer) {
      return NextResponse.json({ ok: false, error: "Пользователь не найден" }, { status: 404 });
    }

    const result = await recordPurchase(buyerTelegramId, amount, description);
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    return NextResponse.json({ ok: false, error: String(err) }, { status: 500 });
  }
}
