import { NextResponse } from "next/server";
import { getAllUsers } from "@/lib/bot/helpers";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const users = await getAllUsers();
    return NextResponse.json({ ok: true, users });
  } catch (err) {
    return NextResponse.json({ ok: false, error: String(err) }, { status: 500 });
  }
}
