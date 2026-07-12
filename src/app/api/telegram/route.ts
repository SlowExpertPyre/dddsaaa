import { NextRequest, NextResponse } from "next/server";
import { createBot } from "@/lib/bot/bot";

export const dynamic = "force-dynamic";

let bot: ReturnType<typeof createBot> = null;

function getBot() {
  if (!bot) bot = createBot();
  return bot;
}

export async function POST(req: NextRequest) {
  const b = getBot();
  if (!b) {
    return NextResponse.json({ ok: false, error: "Бот не настроен" }, { status: 503 });
  }

  try {
    const body = await req.json();
    await b.handleUpdate(body);
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("Ошибка Telegram webhook:", err);
    return NextResponse.json({ ok: false, error: String(err) }, { status: 500 });
  }
}

export async function GET() {
  return NextResponse.json({ ok: true, message: "Telegram webhook работает" });
}
