import { db } from "@/db";
import { users, orders, products, coupons } from "@/db/schema";
import { sql, eq } from "drizzle-orm";

async function getStats() {
  try {
    const [userCount] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(users);
    const [productCount] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(products)
      .where(eq(products.isActive, true));
    const [orderStats] = await db
      .select({
        count: sql<number>`count(*)::int`,
        total: sql<string>`coalesce(sum(amount), 0)::text`,
      })
      .from(orders)
      .where(eq(orders.status, "paid"));
    const [couponCount] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(coupons)
      .where(eq(coupons.isActive, true));

    return {
      users: userCount.count,
      products: productCount.count,
      paidOrders: orderStats.count,
      revenue: parseFloat(orderStats.total ?? "0"),
      activeCoupons: couponCount.count,
    };
  } catch {
    return { users: 0, products: 0, paidOrders: 0, revenue: 0, activeCoupons: 0 };
  }
}

export default async function Home() {
  const stats = await getStats();

  return (
    <main className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 text-white p-6">
      <div className="max-w-5xl mx-auto">
        {/* Header */}
        <div className="text-center mb-10">
          <div className="text-6xl mb-4">🤖</div>
          <h1 className="text-4xl font-bold mb-2 bg-gradient-to-r from-blue-400 to-purple-400 bg-clip-text text-transparent">
            Telegram Shop Bot
          </h1>
          <p className="text-slate-400 text-lg">
            Реферальная система · Магазин · Platega (СБП/Карта) · CryptoBot · Stars
          </p>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mb-8">
          <StatCard icon="👥" value={stats.users} label="Пользователей" color="blue" />
          <StatCard icon="📦" value={stats.products} label="Товаров" color="green" />
          <StatCard icon="✅" value={stats.paidOrders} label="Заказов" color="purple" />
          <StatCard
            icon="💵"
            value={`${stats.revenue.toLocaleString("ru-RU")} ₽`}
            label="Выручка"
            color="yellow"
          />
          <StatCard icon="🏷" value={stats.activeCoupons} label="Купонов" color="orange" />
        </div>

        {/* Navigation */}
        <div className="grid md:grid-cols-2 gap-4 mb-8">
          <a
            href="/users"
            className="bg-slate-800 hover:bg-slate-700 border border-slate-700 hover:border-blue-500 rounded-2xl p-6 transition group"
          >
            <div className="flex items-center gap-4">
              <div className="text-4xl">👥</div>
              <div>
                <h3 className="text-xl font-bold text-white group-hover:text-blue-400 transition">
                  Пользователи
                </h3>
                <p className="text-slate-400 text-sm">
                  Список всех пользователей, реф. ссылки и статистика
                </p>
              </div>
            </div>
          </a>
          <a
            href="/api/telegram/webhook-setup"
            target="_blank"
            className="bg-slate-800 hover:bg-slate-700 border border-slate-700 hover:border-purple-500 rounded-2xl p-6 transition group"
          >
            <div className="flex items-center gap-4">
              <div className="text-4xl">⚙️</div>
              <div>
                <h3 className="text-xl font-bold text-white group-hover:text-purple-400 transition">
                  Webhook Info
                </h3>
                <p className="text-slate-400 text-sm">
                  Статус webhook-подключения Telegram
                </p>
              </div>
            </div>
          </a>
        </div>

        {/* Features Grid */}
        <div className="grid md:grid-cols-2 gap-6 mb-8">
          <FeatureCard
            icon="💳"
            title="Способы оплаты"
            items={[
              "💳 СБП через Platega (+10% комиссия)",
              "🏦 Банковская карта через Platega (+10%)",
              "🪙 CryptoBot (USDT и другие крипто)",
              "⭐ Звёзды по юзернейму (Fragment)",
              "🎁 Звёздами подарком (1400 ⭐ фиксированно)",
            ]}
            color="blue"
          />
          <FeatureCard
            icon="🏷"
            title="Система купонов"
            items={[
              "Создание купонов с % скидки",
              "Лимит на количество использований",
              "Срок действия купонов",
              "Деактивация в реальном времени",
              "Применение к любому методу оплаты",
            ]}
            color="orange"
          />
          <FeatureCard
            icon="🔗"
            title="Реферальная система"
            items={[
              "Уникальная ссылка для каждого",
              "10% комиссия с покупок рефералов",
              "Статистика кликов и переходов",
              "Лидерборд топ-5 участников",
              "Уведомления о новых рефералах",
            ]}
            color="purple"
          />
          <FeatureCard
            icon="🔧"
            title="Панель администратора"
            items={[
              "Добавление/удаление товаров",
              "Создание и управление купонами",
              "Список пользователей + детали",
              "Подтверждение Stars-платежей",
              "Полная статистика и заказы",
            ]}
            color="green"
          />
        </div>

        {/* Bot Commands */}
        <div className="bg-slate-800 rounded-2xl p-6 mb-8">
          <h2 className="text-xl font-bold mb-4 text-slate-200">📋 Команды бота</h2>
          <div className="grid md:grid-cols-2 gap-6">
            <div>
              <h3 className="text-sm font-semibold text-blue-400 mb-3 uppercase tracking-wide">
                Для пользователей:
              </h3>
              <div className="space-y-2">
                {[
                  ["/start", "Запуск + реферальная ссылка"],
                  ["/shop", "Каталог товаров"],
                  ["/mylink", "Ваша реферальная ссылка"],
                  ["/mystats", "Статистика и заработок"],
                  ["/statistics", "Топ-5 по заработку"],
                ].map(([cmd, desc]) => (
                  <div key={cmd} className="flex items-center gap-2 text-sm">
                    <code className="bg-slate-700 px-2 py-0.5 rounded text-blue-300 font-mono flex-shrink-0">
                      {cmd}
                    </code>
                    <span className="text-slate-400">{desc}</span>
                  </div>
                ))}
              </div>
            </div>
            <div>
              <h3 className="text-sm font-semibold text-purple-400 mb-3 uppercase tracking-wide">
                Для администратора:
              </h3>
              <div className="space-y-2">
                {[
                  ["/admin", "Панель управления"],
                  ["/admin_products", "Список товаров"],
                  ["/admin_add_product", "Добавить товар"],
                  ["/admin_coupons", "Список купонов"],
                  ["/admin_add_coupon", "Создать купон"],
                  ["/admin_users", "Все пользователи"],
                  ["/admin_orders", "Последние заказы"],
                  ["/admin_stats", "Полная статистика"],
                  ["/admin_confirm_order [id]", "Подтвердить оплату"],
                ].map(([cmd, desc]) => (
                  <div key={cmd} className="flex items-center gap-2 text-sm">
                    <code className="bg-slate-700 px-2 py-0.5 rounded text-purple-300 font-mono text-xs flex-shrink-0">
                      {cmd}
                    </code>
                    <span className="text-slate-400">{desc}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* Payment Info */}
        <div className="bg-slate-800 rounded-2xl p-6 mb-8">
          <h2 className="text-xl font-bold mb-4 text-slate-200">💰 Информация о платежах</h2>
          <div className="grid md:grid-cols-3 gap-4">
            <div className="bg-slate-700 rounded-xl p-4">
              <div className="text-lg font-semibold text-blue-400 mb-2">
                💳 Platega СБП/Карта
              </div>
              <div className="text-sm text-slate-300 space-y-1">
                <div>• Комиссия: <span className="text-red-400">+10%</span> к цене</div>
                <div>• СБП: мгновенная оплата</div>
                <div>• Карта: Visa/Mastercard/МИР</div>
                <div>• Автоматическое подтверждение</div>
              </div>
            </div>
            <div className="bg-slate-700 rounded-xl p-4">
              <div className="text-lg font-semibold text-yellow-400 mb-2">
                ⭐ Telegram Stars
              </div>
              <div className="text-sm text-slate-300 space-y-1">
                <div>• По юзернейму: курс Fragment</div>
                <div>• Подарком: <span className="text-yellow-400">1400 ⭐ фиксированно</span></div>
                <div>• Ручное подтверждение</div>
                <div>• Уведомление администратору</div>
              </div>
            </div>
            <div className="bg-slate-700 rounded-xl p-4">
              <div className="text-lg font-semibold text-green-400 mb-2">
                🪙 CryptoBot
              </div>
              <div className="text-sm text-slate-300 space-y-1">
                <div>• USDT, TON и другие</div>
                <div>• Конвертация по курсу USD/RUB</div>
                <div>• Автоматическое подтверждение</div>
                <div>• Webhook-уведомления</div>
              </div>
            </div>
          </div>
        </div>

        {/* Environment Variables */}
        <div className="bg-slate-800 rounded-2xl p-6 mb-6">
          <h2 className="text-xl font-bold mb-4 text-slate-200">⚙️ Переменные окружения (.env)</h2>
          <div className="grid md:grid-cols-2 gap-2 font-mono text-sm">
            {[
              ["TELEGRAM_BOT_TOKEN", "Токен бота от @BotFather"],
              ["TELEGRAM_BOT_USERNAME", "Username бота (без @)"],
              ["ADMIN_TELEGRAM_IDS", "ID администраторов через запятую"],
              ["STARS_RECIPIENT_USERNAME", "Username для получения Stars"],
              ["GIFT_STARS_AMOUNT", "Кол-во Stars подарком (по умолч. 1400)"],
              ["FRAGMENT_RATE_RUB", "Курс Fragment (₽ за 1 ⭐), по умолч. 1.12"],
              ["PLATEGA_MERCHANT_ID", "Merchant ID в Platega.io"],
              ["PLATEGA_SECRET_KEY", "Секретный ключ Platega.io"],
              ["CRYPTOBOT_TOKEN", "Токен CryptoBot (@CryptoBot)"],
              ["USD_TO_RUB_RATE", "Курс USD→RUB для CryptoBot (по умолч. 90)"],
              ["WEBHOOK_BASE_URL", "URL вашего сервера (https://...)"],
              ["DATABASE_URL", "PostgreSQL строка подключения"],
            ].map(([key, desc]) => (
              <div key={key} className="flex flex-col gap-0.5 py-1 border-b border-slate-700">
                <code className="text-green-400 text-xs">{key}</code>
                <span className="text-slate-500 text-xs">— {desc}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="text-center text-slate-600 text-sm">
          Telegram Shop Bot · Platega (СБП/Карта) · CryptoBot · Stars · Реферальная система
        </div>
      </div>
    </main>
  );
}

function StatCard({
  icon,
  value,
  label,
  color,
}: {
  icon: string;
  value: string | number;
  label: string;
  color: string;
}) {
  const colorClasses: Record<string, string> = {
    blue: "border-blue-500/30 bg-blue-500/10",
    green: "border-green-500/30 bg-green-500/10",
    purple: "border-purple-500/30 bg-purple-500/10",
    yellow: "border-yellow-500/30 bg-yellow-500/10",
    orange: "border-orange-500/30 bg-orange-500/10",
  };
  return (
    <div
      className={`rounded-2xl p-4 border ${colorClasses[color] ?? colorClasses.blue} text-center`}
    >
      <div className="text-2xl mb-1">{icon}</div>
      <div className="text-xl font-bold text-white">{value}</div>
      <div className="text-xs text-slate-400 mt-1">{label}</div>
    </div>
  );
}

function FeatureCard({
  icon,
  title,
  items,
  color,
}: {
  icon: string;
  title: string;
  items: string[];
  color: string;
}) {
  const colorClasses: Record<string, string> = {
    blue: "text-blue-400",
    green: "text-green-400",
    purple: "text-purple-400",
    orange: "text-orange-400",
  };
  return (
    <div className="bg-slate-800 rounded-2xl p-6 border border-slate-700">
      <div className={`text-xl font-bold mb-4 flex items-center gap-2 ${colorClasses[color]}`}>
        <span>{icon}</span>
        <span>{title}</span>
      </div>
      <ul className="space-y-2">
        {items.map((item, i) => (
          <li key={i} className="flex items-start gap-2 text-sm text-slate-300">
            <span className="mt-0.5 text-slate-500">•</span>
            <span>{item}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
