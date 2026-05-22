/**
 * Database Module
 * Dùng SQLite (better-sqlite3) để lưu token Shopee và lịch sử báo cáo
 */
const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');
const logger = require('../utils/logger');

const DB_PATH = path.join(__dirname, '../../data/store.db');

// Đảm bảo thư mục data tồn tại
const dataDir = path.dirname(DB_PATH);
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

let db;

/**
 * Khởi tạo database và tạo bảng nếu chưa có
 */
function initDatabase() {
  db = new Database(DB_PATH);

  // Bật WAL mode để tăng hiệu suất
  db.pragma('journal_mode = WAL');

  // Bảng lưu thông tin shop và token Shopee
  db.exec(`
    CREATE TABLE IF NOT EXISTS shop_credentials (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      shop_id     TEXT NOT NULL UNIQUE,
      partner_id  TEXT NOT NULL,
      api_secret  TEXT NOT NULL,
      access_token  TEXT,
      refresh_token TEXT,
      token_expire_at INTEGER,
      updated_at  DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);

  // Bảng lưu lịch sử báo cáo đã gửi
  db.exec(`
    CREATE TABLE IF NOT EXISTS report_history (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      report_date   TEXT NOT NULL,
      total_revenue REAL,
      total_orders  INTEGER,
      avg_per_order REAL,
      ai_analysis   TEXT,
      status        TEXT DEFAULT 'success',
      error_msg     TEXT,
      sent_at       DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS orders (
      id                INTEGER PRIMARY KEY AUTOINCREMENT,
      source            TEXT NOT NULL DEFAULT 'nhanh',
      platform          TEXT NOT NULL DEFAULT 'shopee',
      external_order_id TEXT NOT NULL UNIQUE,
      internal_order_id TEXT,
      status            TEXT,
      revenue           REAL DEFAULT 0,
      discount          REAL DEFAULT 0,
      shipping_fee      REAL DEFAULT 0,
      customer_name     TEXT,
      customer_phone    TEXT,
      image_urls        TEXT,
      created_at        TEXT,
      updated_at        TEXT,
      raw_json          TEXT,
      inserted_at       DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);

  ensureColumn('orders', 'image_urls', 'TEXT');

  db.exec(`
    CREATE TABLE IF NOT EXISTS order_items (
      id                INTEGER PRIMARY KEY AUTOINCREMENT,
      external_order_id TEXT NOT NULL,
      sku               TEXT,
      name              TEXT,
      quantity          REAL DEFAULT 0,
      price             REAL DEFAULT 0,
      amount            REAL DEFAULT 0,
      UNIQUE(external_order_id, sku, name)
    );
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS sapo_go_session (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      store_alias     TEXT NOT NULL UNIQUE,
      auth_headers    TEXT NOT NULL,
      connection_ids  TEXT NOT NULL,
      shop_mapping    TEXT NOT NULL,
      updated_at      DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);

  logger.info('✅ Database khởi tạo thành công tại: ' + DB_PATH);
  return db;
}

/**
 * Lấy thông tin credentials của shop từ DB hoặc ENV
 */
function getShopCredentials(shopId) {
  if (!db) initDatabase();

  const row = db.prepare('SELECT * FROM shop_credentials WHERE shop_id = ?').get(shopId);

  // Fallback về biến môi trường nếu chưa có trong DB
  if (!row) {
    logger.warn(`⚠️  Không tìm thấy shop ${shopId} trong DB. Dùng ENV vars.`);
    return {
      shop_id:       process.env.SHOPEE_SHOP_ID,
      partner_id:    process.env.SHOPEE_PARTNER_ID,
      api_secret:    process.env.SHOPEE_API_SECRET,
      access_token:  process.env.SHOPEE_ACCESS_TOKEN || null,
      refresh_token: process.env.SHOPEE_REFRESH_TOKEN || null,
      token_expire_at: Number(process.env.SHOPEE_TOKEN_EXPIRE_AT || 0),
    };
  }
  return row;
}

function ensureColumn(tableName, columnName, columnType) {
  const columns = db.prepare(`PRAGMA table_info(${tableName})`).all();
  const exists = columns.some((column) => column.name === columnName);
  if (!exists) {
    db.exec(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${columnType}`);
  }
}

/**
 * Cập nhật access/refresh token sau khi refresh thành công
 */
function updateTokens(shopId, accessToken, refreshToken, expireAt) {
  if (!db) initDatabase();

  const stmt = db.prepare(`
    INSERT INTO shop_credentials (shop_id, partner_id, api_secret, access_token, refresh_token, token_expire_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(shop_id) DO UPDATE SET
      access_token    = excluded.access_token,
      refresh_token   = excluded.refresh_token,
      token_expire_at = excluded.token_expire_at,
      updated_at      = CURRENT_TIMESTAMP
  `);

  const creds = getShopCredentials(shopId);
  stmt.run(shopId, creds.partner_id, creds.api_secret, accessToken, refreshToken, expireAt);
  logger.info(`🔑 Token cập nhật thành công cho shop: ${shopId}`);
}

/**
 * Khởi tạo shop lần đầu (dùng khi setup)
 */
function upsertShop({ shopId, partnerId, apiSecret, accessToken, refreshToken }) {
  if (!db) initDatabase();

  const expireAt = Math.floor(Date.now() / 1000) + 4 * 60 * 60; // 4 tiếng từ giờ
  const stmt = db.prepare(`
    INSERT INTO shop_credentials (shop_id, partner_id, api_secret, access_token, refresh_token, token_expire_at)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(shop_id) DO UPDATE SET
      partner_id    = excluded.partner_id,
      api_secret    = excluded.api_secret,
      access_token  = excluded.access_token,
      refresh_token = excluded.refresh_token,
      token_expire_at = excluded.token_expire_at,
      updated_at    = CURRENT_TIMESTAMP
  `);
  stmt.run(shopId, partnerId, apiSecret, accessToken, refreshToken, expireAt);
  logger.info(`🏪 Shop ${shopId} đã được lưu vào database.`);
}

/**
 * Lưu lịch sử báo cáo
 */
function saveReport(reportDate, data) {
  if (!db) initDatabase();

  db.prepare(`
    INSERT INTO report_history (report_date, total_revenue, total_orders, avg_per_order, ai_analysis, status)
    VALUES (?, ?, ?, ?, ?, 'success')
  `).run(reportDate, data.totalRevenue, data.totalOrders, data.avgPerOrder, data.aiAnalysis || '');
}

/**
 * Lưu báo cáo lỗi
 */
function saveReportError(reportDate, errorMsg) {
  if (!db) initDatabase();

  db.prepare(`
    INSERT INTO report_history (report_date, status, error_msg)
    VALUES (?, 'error', ?)
  `).run(reportDate, errorMsg);
}

/**
 * Lấy lịch sử báo cáo gần nhất (để so sánh tăng trưởng)
 */
function getLastSuccessReport(excludeDate) {
  if (!db) initDatabase();

  return db.prepare(`
    SELECT * FROM report_history
    WHERE status = 'success' AND report_date != ?
    ORDER BY report_date DESC
    LIMIT 1
  `).get(excludeDate);
}

function upsertOrder(order) {
  if (!db) initDatabase();

  const stmt = db.prepare(`
    INSERT INTO orders (
      source, platform, external_order_id, internal_order_id, status, revenue,
      discount, shipping_fee, customer_name, customer_phone, image_urls, created_at, updated_at, raw_json
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(external_order_id) DO UPDATE SET
      source            = excluded.source,
      platform          = excluded.platform,
      internal_order_id = excluded.internal_order_id,
      status            = excluded.status,
      revenue           = excluded.revenue,
      discount          = excluded.discount,
      shipping_fee      = excluded.shipping_fee,
      customer_name     = excluded.customer_name,
      customer_phone    = excluded.customer_phone,
      image_urls        = excluded.image_urls,
      created_at        = COALESCE(excluded.created_at, orders.created_at),
      updated_at        = excluded.updated_at,
      raw_json          = excluded.raw_json
  `);

  stmt.run(
    order.source || 'nhanh',
    order.platform || 'shopee',
    order.externalOrderId,
    order.internalOrderId || null,
    order.status || null,
    Number(order.revenue || 0),
    Number(order.discount || 0),
    Number(order.shippingFee || 0),
    order.customerName || null,
    order.customerPhone || null,
    JSON.stringify(order.imageUrls || []),
    order.createdAt || null,
    order.updatedAt || new Date().toISOString(),
    JSON.stringify(order.raw || {})
  );

  replaceOrderItems(order.externalOrderId, order.items || []);
}

function replaceOrderItems(externalOrderId, items) {
  if (!db) initDatabase();

  const deleteStmt = db.prepare('DELETE FROM order_items WHERE external_order_id = ?');
  const insertStmt = db.prepare(`
    INSERT INTO order_items (external_order_id, sku, name, quantity, price, amount)
    VALUES (?, ?, ?, ?, ?, ?)
  `);

  const trx = db.transaction(() => {
    deleteStmt.run(externalOrderId);
    for (const item of items) {
      insertStmt.run(
        externalOrderId,
        item.sku || null,
        item.name || 'San pham khong ten',
        Number(item.quantity || 0),
        Number(item.price || 0),
        Number(item.amount || 0)
      );
    }
  });

  trx();
}

function listOrders({ limit = 50, offset = 0 } = {}) {
  if (!db) initDatabase();

  return db.prepare(`
    SELECT * FROM orders
    ORDER BY COALESCE(updated_at, created_at, inserted_at) DESC
    LIMIT ? OFFSET ?
  `).all(limit, offset);
}

function getOrdersByDateRange({ fromIso, toIso }) {
  if (!db) initDatabase();

  return db.prepare(`
    SELECT * FROM orders
    WHERE COALESCE(created_at, inserted_at) >= ?
      AND COALESCE(created_at, inserted_at) <= ?
    ORDER BY COALESCE(created_at, inserted_at) ASC
  `).all(fromIso, toIso);
}

function getOrderItemsByOrderIds(orderIds) {
  if (!db) initDatabase();
  if (!orderIds.length) return [];

  const placeholders = orderIds.map(() => '?').join(',');
  return db.prepare(`
    SELECT * FROM order_items
    WHERE external_order_id IN (${placeholders})
  `).all(...orderIds);
}

/**
 * Lấy session Sapo Go đã lưu
 */
function getSapoGoSession(storeAlias) {
  if (!db) initDatabase();
  const row = db.prepare('SELECT * FROM sapo_go_session WHERE store_alias = ?').get(storeAlias);
  if (!row) return null;
  try {
    return {
      authHeaders: JSON.parse(row.auth_headers),
      connectionIds: row.connection_ids,
      shopMapping: JSON.parse(row.shop_mapping),
      updatedAt: row.updated_at
    };
  } catch (err) {
    logger.error(`❌ Lỗi parse JSON sapo_go_session: ${err.message}`);
    return null;
  }
}

/**
 * Lưu hoặc cập nhật session Sapo Go
 */
function saveSapoGoSession(storeAlias, { authHeaders, connectionIds, shopMapping }) {
  if (!db) initDatabase();

  const stmt = db.prepare(`
    INSERT INTO sapo_go_session (store_alias, auth_headers, connection_ids, shop_mapping, updated_at)
    VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(store_alias) DO UPDATE SET
      auth_headers   = excluded.auth_headers,
      connection_ids = excluded.connection_ids,
      shop_mapping   = excluded.shop_mapping,
      updated_at     = CURRENT_TIMESTAMP
  `);
  stmt.run(storeAlias, JSON.stringify(authHeaders), connectionIds, JSON.stringify(shopMapping));
  logger.info(`💾 Đã lưu session Sapo Go cho cửa hàng: ${storeAlias}`);
}

module.exports = {
  initDatabase,
  getShopCredentials,
  updateTokens,
  upsertShop,
  saveReport,
  saveReportError,
  getLastSuccessReport,
  upsertOrder,
  listOrders,
  getOrdersByDateRange,
  getOrderItemsByOrderIds,
  getSapoGoSession,
  saveSapoGoSession
};
