import type { Metadata } from "next";
import type { ReactNode } from "react";
import "./globals.css";

export const metadata: Metadata = {
  title: "Telegram Shop Bot — Реферальная система + Магазин",
  description: "Telegram бот с реферальной системой, магазином товаров, оплатой через СБП, CryptoBot и Telegram Stars.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body className="bg-slate-100 text-slate-900 antialiased">{children}</body>
    </html>
  );
}
