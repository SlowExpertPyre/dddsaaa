"use client";

import { useEffect, useState } from "react";

interface UserData {
  id: number;
  telegramId: number;
  username: string | null;
  firstName: string | null;
  lastName: string | null;
  referredBy: number | null;
  isAdmin: boolean;
  joinedAt: string;
  referralCode: string | null;
  referralClicks: number;
  referralCount: number;
  totalEarned: string;
  refPurchases: number;
  refRevenue: string;
  ownOrders: number;
  ownSpent: string;
}

function formatMoney(val: string | number): string {
  const n = parseFloat(String(val ?? "0"));
  return n.toLocaleString("ru-RU", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " ₽";
}

function displayName(username: string | null, firstName: string | null): string {
  if (username) return `@${username}`;
  if (firstName) return firstName;
  return "Неизвестный";
}

export default function UsersPage() {
  const [users, setUsers] = useState<UserData[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedUser, setSelectedUser] = useState<UserData | null>(null);
  const [search, setSearch] = useState("");

  useEffect(() => {
    fetch("/api/admin/users")
      .then((r) => r.json())
      .then((data) => {
        if (data.ok) setUsers(data.users);
        else setError(data.error);
      })
      .catch((e) => setError(String(e)))
      .finally(() => setLoading(false));
  }, []);

  const filtered = users.filter((u) => {
    const q = search.toLowerCase();
    return (
      !q ||
      (u.username && u.username.toLowerCase().includes(q)) ||
      (u.firstName && u.firstName.toLowerCase().includes(q)) ||
      String(u.telegramId).includes(q)
    );
  });

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 text-white">
      <div className="max-w-7xl mx-auto px-4 py-8">
        {/* Header */}
        <div className="flex items-center gap-4 mb-8">
          <a
            href="/"
            className="bg-slate-700 hover:bg-slate-600 text-white px-4 py-2 rounded-xl transition text-sm"
          >
            ← Главная
          </a>
          <div>
            <h1 className="text-3xl font-bold bg-gradient-to-r from-blue-400 to-purple-400 bg-clip-text text-transparent">
              👥 Пользователи
            </h1>
            <p className="text-slate-400 text-sm mt-1">
              Все пользователи бота · {users.length} всего
            </p>
          </div>
        </div>

        {/* Search */}
        <div className="mb-6">
          <input
            type="text"
            placeholder="🔍 Поиск по имени, username или ID..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full bg-slate-800 border border-slate-700 rounded-xl px-4 py-3 text-white placeholder-slate-400 focus:outline-none focus:border-blue-500 transition"
          />
        </div>

        {loading && (
          <div className="text-center py-20 text-slate-400">
            <div className="text-4xl mb-4">⏳</div>
            <p>Загрузка пользователей...</p>
          </div>
        )}

        {error && (
          <div className="bg-red-900/30 border border-red-500 rounded-xl p-4 text-red-400 mb-6">
            ❌ Ошибка: {error}
          </div>
        )}

        {!loading && !error && (
          <div className="grid lg:grid-cols-2 gap-6">
            {/* Users List */}
            <div className="space-y-3">
              <h2 className="text-lg font-semibold text-slate-300 mb-4">
                Список ({filtered.length})
              </h2>
              {filtered.length === 0 && (
                <div className="text-slate-500 text-center py-8">Пользователей не найдено</div>
              )}
              {filtered.map((user) => (
                <button
                  key={user.id}
                  onClick={() => setSelectedUser(user)}
                  className={`w-full text-left bg-slate-800 hover:bg-slate-700 rounded-xl p-4 transition border ${
                    selectedUser?.id === user.id
                      ? "border-blue-500"
                      : "border-slate-700 hover:border-slate-600"
                  }`}
                >
                  <div className="flex items-start justify-between">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="font-semibold text-white truncate">
                          {displayName(user.username, user.firstName)}
                        </span>
                        {user.isAdmin && (
                          <span className="bg-purple-700 text-purple-200 text-xs px-2 py-0.5 rounded-full">
                            Admin
                          </span>
                        )}
                      </div>
                      <div className="text-slate-400 text-sm font-mono">
                        ID: {user.telegramId}
                      </div>
                      {user.referredBy && (
                        <div className="text-slate-500 text-xs mt-1">
                          Реф: {user.referredBy}
                        </div>
                      )}
                    </div>
                    <div className="text-right ml-2">
                      <div className="text-green-400 font-bold text-sm">
                        {formatMoney(user.totalEarned)}
                      </div>
                      <div className="text-slate-500 text-xs">
                        👥 {user.referralCount} · 🛒 {user.ownOrders}
                      </div>
                    </div>
                  </div>
                </button>
              ))}
            </div>

            {/* User Detail */}
            <div>
              {selectedUser ? (
                <div className="bg-slate-800 rounded-2xl p-6 border border-slate-700 sticky top-6">
                  <div className="flex items-center justify-between mb-6">
                    <h2 className="text-xl font-bold text-white">
                      {displayName(selectedUser.username, selectedUser.firstName)}
                    </h2>
                    <button
                      onClick={() => setSelectedUser(null)}
                      className="text-slate-400 hover:text-white transition"
                    >
                      ✕
                    </button>
                  </div>

                  {/* Basic Info */}
                  <div className="space-y-3 mb-6">
                    <h3 className="text-sm font-semibold text-blue-400 uppercase tracking-wide">
                      Основное
                    </h3>
                    <InfoRow label="Telegram ID" value={String(selectedUser.telegramId)} mono />
                    {selectedUser.username && (
                      <InfoRow label="Username" value={`@${selectedUser.username}`} />
                    )}
                    {selectedUser.firstName && (
                      <InfoRow label="Имя" value={selectedUser.firstName} />
                    )}
                    <InfoRow
                      label="Зарегистрирован"
                      value={new Date(selectedUser.joinedAt).toLocaleString("ru-RU")}
                    />
                    {selectedUser.referredBy && (
                      <InfoRow
                        label="Пришёл от"
                        value={String(selectedUser.referredBy)}
                        mono
                      />
                    )}
                    <InfoRow
                      label="Роль"
                      value={selectedUser.isAdmin ? "🔧 Администратор" : "👤 Пользователь"}
                    />
                  </div>

                  {/* Referral Stats */}
                  <div className="space-y-3 mb-6">
                    <h3 className="text-sm font-semibold text-purple-400 uppercase tracking-wide">
                      Реферальная программа
                    </h3>
                    {selectedUser.referralCode && (
                      <InfoRow label="Код" value={selectedUser.referralCode} mono />
                    )}
                    <InfoRow label="Кликов" value={String(selectedUser.referralClicks)} />
                    <InfoRow
                      label="Привлёк пользователей"
                      value={String(selectedUser.referralCount)}
                      highlight
                    />
                    <InfoRow
                      label="Покупок через реф. ссылку"
                      value={String(selectedUser.refPurchases)}
                      highlight
                    />
                    <InfoRow
                      label="Сумма реф. покупок"
                      value={formatMoney(selectedUser.refRevenue)}
                    />
                    <InfoRow
                      label="💰 Заработано комиссий"
                      value={formatMoney(selectedUser.totalEarned)}
                      highlight
                      green
                    />
                  </div>

                  {/* Purchase Stats */}
                  <div className="space-y-3">
                    <h3 className="text-sm font-semibold text-green-400 uppercase tracking-wide">
                      Личные покупки
                    </h3>
                    <InfoRow
                      label="Оплаченных заказов"
                      value={String(selectedUser.ownOrders)}
                      highlight
                    />
                    <InfoRow
                      label="Потрачено"
                      value={formatMoney(selectedUser.ownSpent)}
                    />
                  </div>

                  {/* Copy referral link */}
                  {selectedUser.referralCode && (
                    <div className="mt-6 pt-6 border-t border-slate-700">
                      <p className="text-xs text-slate-400 mb-2">Реферальная ссылка:</p>
                      <div className="bg-slate-900 rounded-lg p-3 font-mono text-xs text-blue-400 break-all">
                        https://t.me/{process.env.NEXT_PUBLIC_BOT_USERNAME || "bot"}?start={selectedUser.referralCode}
                      </div>
                    </div>
                  )}
                </div>
              ) : (
                <div className="bg-slate-800 rounded-2xl p-8 border border-slate-700 text-center text-slate-500">
                  <div className="text-4xl mb-3">👆</div>
                  <p>Выберите пользователя из списка</p>
                  <p className="text-sm mt-1">чтобы увидеть подробную информацию</p>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function InfoRow({
  label,
  value,
  mono = false,
  highlight = false,
  green = false,
}: {
  label: string;
  value: string;
  mono?: boolean;
  highlight?: boolean;
  green?: boolean;
}) {
  return (
    <div className="flex items-center justify-between py-1.5 border-b border-slate-700/50 last:border-0">
      <span className="text-slate-400 text-sm">{label}</span>
      <span
        className={`text-sm ${
          green
            ? "text-green-400 font-bold"
            : highlight
            ? "text-white font-semibold"
            : "text-slate-300"
        } ${mono ? "font-mono" : ""}`}
      >
        {value}
      </span>
    </div>
  );
}
