import { NextResponse } from "next/server";
import { db } from "@/db";
import { sql } from "drizzle-orm";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await db.execute(sql`SELECT 1`);
    return NextResponse.json({ ok: true, status: "healthy", db: "connected" });
  } catch (err) {
    return NextResponse.json(
      { ok: false, status: "unhealthy", error: String(err) },
      { status: 500 }
    );
  }
}
