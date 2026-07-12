import { db } from "@/db";
import { users, orders, products } from "@/db/schema";
import { sql, eq } from "drizzle-orm";

async function getStats() {
  try {
    const [userCount] = await db.select({ count: sql<number>`count(*)::int` }).from(users);
    const [productCount] = await db.select({ count: sql<number>`count(*)::int` }).from(products).where(eq(products.isActive, true));
    const [orderStats] = await db.select({
      count: sql<number>`count(*)::int`,
      total: sql<string>`coalesce(sum(amount), 0)::text`,
    }).from(orders).where(eq(orders.status, "paid"));

    return {
      users: userCount.count,
      products: productCount.count,
      paidOrders: orderStats.count,
      revenue: parseFloat(orderStats.total ?? "0"),
    };
  } catch {
    return { users: 0, products: 0, paidOrders: 0, revenue: 0 };
  }
}

export default async function Home() {
  const stats = await getStats();

  return (
    <main className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 text-white p-6">
      <div className="max-w-4xl mx-auto">
        {/* Заголовок */}
        <div className="text-center mb-10">
          <div className="text-6xl mb-4">🤖</div>
          <h1 className="text-4xl font-bold mb-2 bg-gradient-to-r from-blue-400 to-purple-400 bg-clip-text text-transparent">
            Telegram Bot
          </h1>
          <p className="text-slate-400 text-lg">Реферальная система + Магазин с оплатой</p>
        </div>

        {/* Статистика */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
          <StatCard icon="👥" value={stats.users} label="Пользователей" color="blue" />
          <StatCard icon="📦" value={stats.products} label="Товаров" color="green" />
          <StatCard icon="✅" value={stats.paidOrders} label="Заказов" color="purple" />
          <StatCard icon="💵" value={`${stats.revenue.toLocaleString("ru-RU")} ₽`} label="Выручка" color="yellow" />
        </div>

        {/* Функции бота */}
        <div className="grid md:grid-cols-2 gap-6 mb-8">
          <FeatureCard
            icon="🛒"
            title="Магазин товаров"
            items={[
              "Товары с описанием и ценой",
              "Одноразовые ссылки в каналы",
              "Цифровой контент",
              "Управление через /admin_add_product",
            ]}
            color="blue"
          />
          <FeatureCard
            icon="💳"
            title="Способы оплаты"
            items={[
              "💳 СБП через Плати (Platika)",
              "🪙 CryptoBot (USDT и др.)",
              "⭐ Звёзды по юзернейму (Fragment)",
              "🎁 Подарки Telegram (с комиссией)",
            ]}
            color="green"
          />
          <FeatureCard
            icon="🔗"
            title="Реферальная система"
            items={[
              "Уникальная ссылка для каждого",
              "50% комиссия с покупок рефералов",
              "Статистика кликов и переходов",
              "Лидерборд топ-5 участников",
            ]}
            color="purple"
          />
          <FeatureCard
            icon="🔧"
            title="Панель администратора"
            items={[
              "Добавление/удаление товаров",
              "Подтверждение Stars-платежей",
              "Статистика и заказы",
              "Автовыдача одноразовых ссылок",
            ]}
            color="orange"
          />
        </div>

        {/* Команды бота */}
        <div className="bg-slate-800 rounded-2xl p-6 mb-8">
          <h2 className="text-xl font-bold mb-4 text-slate-200">📋 Команды бота</h2>
          <div className="grid md:grid-cols-2 gap-4">
            <div>
              <h3 className="text-sm font-semibold text-blue-400 mb-2">Для пользователей:</h3>
              <div className="space-y-1">
                {[
                  ["/start", "Запуск + реферальная ссылка"],
                  ["/shop", "Каталог товаров"],
                  ["/mylink", "Ваша реферальная ссылка"],
                  ["/mystats", "Статистика и заработок"],
                  ["/statistics", "Топ-5 по заработку"],
                ].map(([cmd, desc]) => (
                  <div key={cmd} className="flex items-center gap-2 text-sm">
                    <code className="bg-slate-700 px-2 py-0.5 rounded text-blue-300 font-mono">{cmd}</code>
                    <span className="text-slate-400">{desc}</span>
                  </div>
                ))}
              </div>
            </div>
            <div>
              <h3 className="text-sm font-semibold text-purple-400 mb-2">Для администратора:</h3>
              <div className="space-y-1">
                {[
                  ["/admin", "Панель управления"],
                  ["/admin_products", "Список товаров"],
                  ["/admin_add_product", "Добавить товар"],
                  ["/admin_orders", "Последние заказы"],
                  ["/admin_stats", "Полная статистика"],
                  ["/admin_confirm_order [id]", "Подтвердить оплату"],
                ].map(([cmd, desc]) => (
                  <div key={cmd} className="flex items-center gap-2 text-sm">
                    <code className="bg-slate-700 px-2 py-0.5 rounded text-purple-300 font-mono text-xs">{cmd}</code>
                    <span className="text-slate-400">{desc}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* Расчёт звёзд */}
        <div className="bg-slate-800 rounded-2xl p-6 mb-8">
          <h2 className="text-xl font-bold mb-4 text-slate-200">⭐ Расчёт Telegram Stars</h2>
          <div className="grid md:grid-cols-2 gap-4">
            <div className="bg-slate-700 rounded-xl p-4">
              <div className="text-lg font-semibold text-yellow-400 mb-2">По юзернейму (Fragment)</div>
              <div className="text-sm text-slate-300 space-y-1">
                <div>• Курс Fragment: <span className="text-white">1.12 ₽/⭐</span></div>
                <div>• Комиссия Fragment: <span className="text-red-400">+7%</span></div>
                <div>• Округление: <span className="text-white">вниз до × 50</span></div>
                <div className="mt-2 pt-2 border-t border-slate-600">
                  Пример: 1500 ₽ → <span className="text-yellow-400 font-bold">≈ 1150 ⭐</span>
                </div>
              </div>
            </div>
            <div className="bg-slate-700 rounded-xl p-4">
              <div className="text-lg font-semibold text-purple-400 mb-2">Подарками (Stars)</div>
              <div className="text-sm text-slate-300 space-y-1">
                <div>• Курс Fragment: <span className="text-white">1.12 ₽/⭐</span></div>
                <div>• Комиссия Fragment: <span className="text-red-400">+7%</span></div>
                <div>• Комиссия ТГ (подарки→⭐): <span className="text-red-400">+30%</span></div>
                <div>• Округление: <span className="text-white">вниз до × 50</span></div>
                <div className="mt-2 pt-2 border-t border-slate-600">
                  Пример: 1500 ₽ → <span className="text-purple-400 font-bold">≈ 2050 ⭐ в подарках</span>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Настройка */}
        <div className="bg-slate-800 rounded-2xl p-6 mb-6">
          <h2 className="text-xl font-bold mb-4 text-slate-200">⚙️ Переменные окружения (.env)</h2>
          <div className="space-y-2 font-mono text-sm">
            {[
              ["TELEGRAM_BOT_TOKEN", "Токен бота от @BotFather"],
              ["TELEGRAM_BOT_USERNAME", "Username бота (без @)"],
              ["ADMIN_TELEGRAM_IDS", "ID администраторов через запятую"],
              ["STARS_RECIPIENT_USERNAME", "Username для получения Stars"],
              ["FRAGMENT_RATE_RUB", "Курс Fragment (₽ за 1 ⭐), по умолч. 1.12"],
              ["PLATIKA_SHOP_ID", "ID магазина в Platika (СБП)"],
              ["PLATIKA_SECRET_KEY", "Секретный ключ Platika"],
              ["CRYPTOBOT_TOKEN", "Токен CryptoBot (@CryptoBot)"],
              ["USD_TO_RUB_RATE", "Курс USD→RUB для CryptoBot"],
              ["WEBHOOK_BASE_URL", "URL вашего сервера (https://...)"],
              ["DATABASE_URL", "PostgreSQL строка подключения"],
            ].map(([key, desc]) => (
              <div key={key} className="flex flex-col sm:flex-row sm:items-center gap-1 sm:gap-3">
                <code className="text-green-400 min-w-0">{key}</code>
                <span className="text-slate-500 text-xs">— {desc}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="text-center text-slate-600 text-sm">
          Telegram Shop Bot • Реферальная система • Все права защищены
        </div>
      </div>
    </main>
  );
}

function StatCard({ icon, value, label, color }: { icon: string; value: string | number; label: string; color: string }) {
  const colors: Record<string, string> = {
    blue: "border-blue-500/30 bg-blue-500/10",
    green: "border-green-500/30 bg-green-500/10",
    purple: "border-purple-500/30 bg-purple-500/10",
    yellow: "border-yellow-500/30 bg-yellow-500/10",
    orange: "border-orange-500/30 bg-orange-500/10",
  };

  return (
    <div className={`border rounded-xl p-4 text-center ${colors[color] ?? colors.blue}`}>
      <div className="text-2xl mb-1">{icon}</div>
      <div className="text-2xl font-bold text-white">{value}</div>
      <div className="text-xs text-slate-400 mt-1">{label}</div>
    </div>
  );
}

function FeatureCard({ icon, title, items, color }: { icon: string; title: string; items: string[]; color: string }) {
  const colors: Record<string, string> = {
    blue: "border-blue-500/20",
    green: "border-green-500/20",
    purple: "border-purple-500/20",
    orange: "border-orange-500/20",
  };

  return (
    <div className={`bg-slate-800 border rounded-xl p-5 ${colors[color] ?? colors.blue}`}>
      <div className="flex items-center gap-2 mb-3">
        <span className="text-2xl">{icon}</span>
        <h3 className="font-semibold text-white">{title}</h3>
      </div>
      <ul className="space-y-1.5">
        {items.map((item) => (
          <li key={item} className="flex items-start gap-2 text-sm text-slate-300">
            <span className="text-green-400 mt-0.5">✓</span>
            {item}
          </li>
        ))}
      </ul>
    </div>
  );
}
