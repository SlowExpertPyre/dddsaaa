import {
  pgTable,
  serial,
  text,
  bigint,
  integer,
  numeric,
  timestamp,
  boolean,
  index,
  jsonb,
} from "drizzle-orm/pg-core";

// Все пользователи Telegram, запустившие бота
export const users = pgTable(
  "users",
  {
    id: serial("id").primaryKey(),
    telegramId: bigint("telegram_id", { mode: "number" }).notNull().unique(),
    username: text("username"),
    firstName: text("first_name"),
    lastName: text("last_name"),
    referredBy: bigint("referred_by", { mode: "number" }),
    isAdmin: boolean("is_admin").default(false).notNull(),
    joinedAt: timestamp("joined_at").defaultNow().notNull(),
  },
  (t) => [index("users_telegram_id_idx").on(t.telegramId)]
);

// Реферальные ссылки
export const referralLinks = pgTable(
  "referral_links",
  {
    id: serial("id").primaryKey(),
    ownerId: bigint("owner_id", { mode: "number" }).notNull(),
    ownerUsername: text("owner_username"),
    code: text("code").notNull().unique(),
    clickCount: integer("click_count").default(0).notNull(),
    referredCount: integer("referred_count").default(0).notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => [
    index("referral_links_owner_idx").on(t.ownerId),
    index("referral_links_code_idx").on(t.code),
  ]
);

// Товары магазина
export const products = pgTable("products", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  description: text("description"),
  price: numeric("price", { precision: 12, scale: 2 }).notNull(),
  productType: text("product_type").default("invite_link").notNull(),
  channelId: text("channel_id"),
  digitalContent: text("digital_content"),
  isActive: boolean("is_active").default(true).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// Купоны/скидки
export const coupons = pgTable(
  "coupons",
  {
    id: serial("id").primaryKey(),
    code: text("code").notNull().unique(),
    discountPercent: integer("discount_percent").notNull(),
    usageLimit: integer("usage_limit").default(0).notNull(), // 0 = unlimited
    usageCount: integer("usage_count").default(0).notNull(),
    isActive: boolean("is_active").default(true).notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    expiresAt: timestamp("expires_at"),
  },
  (t) => [index("coupons_code_idx").on(t.code)]
);

// Заказы / оплаты
export const orders = pgTable(
  "orders",
  {
    id: serial("id").primaryKey(),
    buyerTelegramId: bigint("buyer_telegram_id", { mode: "number" }).notNull(),
    referrerTelegramId: bigint("referrer_telegram_id", { mode: "number" }),
    productId: integer("product_id").notNull(),
    amount: numeric("amount", { precision: 12, scale: 2 }).notNull(),
    commission: numeric("commission", { precision: 12, scale: 2 }).notNull(),
    couponCode: text("coupon_code"),
    discountPercent: integer("discount_percent").default(0).notNull(),
    // Метод оплаты: "sbp" | "card" | "cryptobot" | "stars_username" | "stars_gift"
    paymentMethod: text("payment_method").notNull(),
    // Статус: "pending" | "paid" | "failed" | "cancelled"
    status: text("status").default("pending").notNull(),
    externalPaymentId: text("external_payment_id"),
    paymentData: jsonb("payment_data"),
    deliveredLink: text("delivered_link"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    paidAt: timestamp("paid_at"),
  },
  (t) => [
    index("orders_buyer_idx").on(t.buyerTelegramId),
    index("orders_status_idx").on(t.status),
    index("orders_external_id_idx").on(t.externalPaymentId),
  ]
);

// Покупки (для реферальной системы)
export const purchases = pgTable(
  "purchases",
  {
    id: serial("id").primaryKey(),
    buyerTelegramId: bigint("buyer_telegram_id", { mode: "number" }).notNull(),
    referrerTelegramId: bigint("referrer_telegram_id", { mode: "number" }),
    amount: numeric("amount", { precision: 12, scale: 2 }).notNull(),
    commission: numeric("commission", { precision: 12, scale: 2 }).notNull(),
    description: text("description"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => [
    index("purchases_buyer_idx").on(t.buyerTelegramId),
    index("purchases_referrer_idx").on(t.referrerTelegramId),
  ]
);

// Начисления (денормализованная таблица для быстрого лидерборда)
export const earnings = pgTable(
  "earnings",
  {
    id: serial("id").primaryKey(),
    telegramId: bigint("telegram_id", { mode: "number" }).notNull().unique(),
    username: text("username"),
    firstName: text("first_name"),
    totalEarned: numeric("total_earned", { precision: 12, scale: 2 })
      .default("0")
      .notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (t) => [
    index("earnings_telegram_id_idx").on(t.telegramId),
    index("earnings_total_earned_idx").on(t.totalEarned),
  ]
);

// Лог действий бота
export const botLogs = pgTable("bot_logs", {
  id: serial("id").primaryKey(),
  telegramId: bigint("telegram_id", { mode: "number" }),
  username: text("username"),
  action: text("action").notNull(),
  detail: text("detail"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// Состояние диалога с пользователем (FSM)
export const userStates = pgTable("user_states", {
  id: serial("id").primaryKey(),
  telegramId: bigint("telegram_id", { mode: "number" }).notNull().unique(),
  state: text("state").notNull(),
  data: jsonb("data"),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});
