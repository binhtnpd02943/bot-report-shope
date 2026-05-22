/**
 * Express Router - API Routes
 * Cung cấp các endpoint HTTP để:
 *  - Kích hoạt báo cáo thủ công
 *  - Kiểm tra trạng thái hệ thống
 *  - Quản lý credentials
 */
const express = require('express');
const router  = express.Router();
const logger  = require('../utils/logger');
const db      = require('../database/db');
const shopee  = require('../services/shopee');
const lark    = require('../services/lark');
const nhanh   = require('../services/nhanh');
const sapo    = require('../services/sapo');
const calc    = require('../services/calculator');

// ─────────────────────────────────────────────
// HEALTH CHECK
// ─────────────────────────────────────────────

/**
 * GET /api/health
 * Kiểm tra server còn sống không
 */
router.get('/health', (req, res) => {
  res.json({
    status:    'ok',
    mode:      process.env.INTEGRATION_MODE || 'nhanh_webhook',
    uptime:    Math.floor(process.uptime()) + 's',
    timestamp: new Date().toISOString(),
    timezone:  process.env.TZ || 'Asia/Ho_Chi_Minh',
    larkBase:  lark.isBaseEnabled(),
  });
});

// ─────────────────────────────────────────────
// NHANH.VN WEBHOOK
// ─────────────────────────────────────────────

/**
 * POST /api/webhooks/nhanh/order
 * Nhan webhook them/cap nhat don hang tu Nhanh.vn.
 */
router.post('/webhooks/nhanh/order', async (req, res) => {
  if (!nhanh.verifyWebhook(req)) {
    logger.warn('[NHANH] Webhook bi tu choi vi sai verify token.');
    return res.status(401).json({ success: false, error: 'Invalid webhook token' });
  }

  try {
    const order = nhanh.normalizeOrderWebhook(req.body);
    db.upsertOrder(order);

    if (shouldSyncOrderDetails()) {
      try {
        await lark.upsertOrderToBase(order);
      } catch (err) {
        logger.error(`[NHANH] Sync Lark Base loi cho don ${order.externalOrderId}: ${err.message}`);
      }
    }

    logger.info(`[NHANH] Da nhan don ${order.externalOrderId} - ${order.status || 'unknown'} - ${order.revenue || 0}`);
    res.json({ success: true, orderId: order.externalOrderId });
  } catch (err) {
    logger.error('[NHANH] Xu ly webhook that bai: ' + err.message);
    res.status(400).json({ success: false, error: err.message });
  }
});

/**
 * POST /api/webhooks/sapo/order
 * Nhan webhook don hang tu Sapo: orders/create, orders/updated, orders/paid...
 */
router.post('/webhooks/sapo/order', async (req, res) => {
  if (!sapo.verifyWebhook(req)) {
    logger.warn('[SAPO] Webhook bi tu choi vi sai verify token.');
    return res.status(401).json({ success: false, error: 'Invalid webhook token' });
  }

  try {
    const order = sapo.normalizeOrderWebhook(req.body);
    db.upsertOrder(order);

    if (shouldSyncOrderDetails()) {
      try {
        await lark.upsertOrderToBase(order);
      } catch (err) {
        logger.error(`[SAPO] Sync Lark Base loi cho don ${order.externalOrderId}: ${err.message}`);
      }
    }

    logger.info(`[SAPO] Da nhan don ${order.externalOrderId} - ${order.status || 'unknown'} - ${order.revenue || 0}`);
    res.json({ success: true, orderId: order.externalOrderId });
  } catch (err) {
    logger.error('[SAPO] Xu ly webhook that bai: ' + err.message);
    res.status(400).json({ success: false, error: err.message });
  }
});

/**
 * POST /api/sapo/sync
 * Chủ động kéo đơn hàng từ Sapo API về hệ thống và lưu SQLite
 * Body: { from?: string, to?: string } (Định dạng YYYY-MM-DD)
 */
router.post('/sapo/sync', async (req, res) => {
  try {
    const { from, to } = req.body || {};
    const date = todayYmd();
    const fromDate = from || date;
    const toDate = to || date;

    if (!isYmd(fromDate) || !isYmd(toDate)) {
      return res.status(400).json({ success: false, error: 'from/to phai co dinh dang YYYY-MM-DD.' });
    }

    const fromIso = new Date(`${fromDate}T00:00:00+07:00`);
    const toIso = new Date(`${toDate}T23:59:59+07:00`);

    const timeFrom = Math.floor(fromIso.getTime() / 1000);
    const timeTo = Math.floor(toIso.getTime() / 1000);

    logger.info(`📌 [API] Bắt đầu chủ động đồng bộ đơn từ Sapo API từ ${fromDate} đến ${toDate}`);

    const allOrders = await sapo.getOrdersFromApi({ timeFrom, timeTo });

    let successCount = 0;
    let shopeeCount = 0;

    for (const order of allOrders) {
      try {
        db.upsertOrder(order);
        successCount++;
        if (order.platform === 'shopee') {
          shopeeCount++;
        }

        if (shouldSyncOrderDetails()) {
          await lark.upsertOrderToBase(order);
        }
      } catch (err) {
        logger.error(`[API SAPO SYNC] Lỗi lưu đơn ${order.externalOrderId}: ${err.message}`);
      }
    }

    res.json({
      success: true,
      message: `Đồng bộ hoàn tất.`,
      range: `${fromDate} -> ${toDate}`,
      totalFetched: allOrders.length,
      successfullySaved: successCount,
      shopeeOrders: shopeeCount,
    });
  } catch (err) {
    logger.error('[API SAPO SYNC] Lỗi đồng bộ: ' + err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ─────────────────────────────────────────────
// MANUAL TRIGGER
// ─────────────────────────────────────────────

/**
 * POST /api/report/trigger
 * Kích hoạt báo cáo ngay lập tức (không cần chờ cron)
 * Body: { shopId?: string }
 */
router.post('/report/trigger', async (req, res) => {
  const shopId = req.body?.shopId || process.env.SHOPEE_SHOP_ID;
  const isSync = req.body?.sync === true;

  logger.info(`📌 [API] Manual trigger báo cáo cho shop: ${shopId} | Sync Mode: ${isSync}`);

  if (isSync) {
    try {
      const { runDailyReport } = require('../workflows/dailyReport');
      const report = await runDailyReport({ shopId });
      return res.json({ success: true, message: 'Báo cáo đã được tạo và gửi thành công!', report });
    } catch (err) {
      logger.error('[API] Manual trigger thất bại: ' + err.message);
      return res.status(500).json({ success: false, error: err.message });
    }
  }

  res.json({ message: 'Báo cáo đang chạy nền. Kiểm tra Lark để nhận kết quả.', shopId });

  // Chạy nền, không block response
  setImmediate(async () => {
    try {
      const { runDailyReport } = require('../workflows/dailyReport');
      await runDailyReport({ shopId });
    } catch (err) {
      logger.error('[API] Manual trigger thất bại: ' + err.message);
    }
  });
});

// ─────────────────────────────────────────────
// TOKEN MANAGEMENT
// ─────────────────────────────────────────────

/**
 * POST /api/token/refresh
 * Refresh token Shopee thủ công
 * Body: { shopId?: string }
 */
router.post('/token/refresh', async (req, res) => {
  if ((process.env.INTEGRATION_MODE || 'nhanh_webhook') !== 'shopee_api') {
    return res.status(400).json({
      success: false,
      error: 'Endpoint nay chi dung khi INTEGRATION_MODE=shopee_api.',
    });
  }

  const shopId = req.body?.shopId || process.env.SHOPEE_SHOP_ID;
  try {
    await shopee.refreshAccessToken(shopId);
    res.json({ success: true, message: 'Token đã được làm mới.', shopId });
  } catch (err) {
    logger.error('[API] Token refresh lỗi: ' + err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * GET /api/shopee/auth-url
 * Tao link de uy quyen shop Shopee.
 * Query: redirectUrl? Neu khong co se dung SHOPEE_REDIRECT_URL trong .env
 */
router.get('/shopee/auth-url', (req, res) => {
  try {
    const url = shopee.buildAuthorizationUrl({ redirectUrl: req.query.redirectUrl });
    res.json({
      success: true,
      authUrl: url,
      nextStep: 'Mo authUrl, dang nhap Shopee Seller va chap nhan uy quyen. Shopee se redirect ve callback kem code va shop_id.',
    });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

/**
 * GET /api/shopee/oauth/callback
 * Callback tu Shopee sau khi shop approve.
 */
router.get('/shopee/oauth/callback', async (req, res) => {
  const code = req.query.code;
  const shopId = req.query.shop_id || req.query.shopId || process.env.SHOPEE_SHOP_ID;

  try {
    const result = await shopee.exchangeCodeForTokens({ code, shopId });
    res.json({
      success: true,
      message: 'Da lay va luu Shopee access_token/refresh_token vao SQLite.',
      ...result,
    });
  } catch (err) {
    logger.error('[SHOPEE] OAuth callback loi: ' + err.message);
    res.status(400).json({ success: false, error: err.message });
  }
});

/**
 * POST /api/shopee/token/exchange
 * Dung khi ban copy code thu cong tu callback URL.
 */
router.post('/shopee/token/exchange', async (req, res) => {
  const { code, shopId } = req.body || {};

  try {
    const result = await shopee.exchangeCodeForTokens({ code, shopId });
    res.json({
      success: true,
      message: 'Da lay va luu Shopee token.',
      ...result,
    });
  } catch (err) {
    logger.error('[SHOPEE] Token exchange loi: ' + err.message);
    res.status(400).json({ success: false, error: err.message });
  }
});

/**
 * POST /api/shop/setup
 * Khởi tạo thông tin shop lần đầu
 * Body: { shopId, partnerId, apiSecret, accessToken, refreshToken }
 */
router.post('/shop/setup', (req, res) => {
  const { shopId, partnerId, apiSecret, accessToken, refreshToken } = req.body;
  if (!shopId || !partnerId || !apiSecret) {
    return res.status(400).json({ error: 'Thiếu shopId, partnerId hoặc apiSecret.' });
  }

  try {
    db.upsertShop({ shopId, partnerId, apiSecret, accessToken, refreshToken });
    res.json({ success: true, message: `Shop ${shopId} đã được lưu.` });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ─────────────────────────────────────────────
// REPORT HISTORY
// ─────────────────────────────────────────────

/**
 * GET /api/reports
 * Xem lịch sử báo cáo đã gửi
 */
router.get('/reports', (req, res) => {
  try {
    const Database = require('better-sqlite3');
    const path = require('path');
    const _db = new Database(path.join(__dirname, '../../data/store.db'));
    const rows = _db.prepare('SELECT * FROM report_history ORDER BY sent_at DESC LIMIT 30').all();
    res.json({ success: true, count: rows.length, data: rows });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * GET /api/orders
 * Xem nhanh cac don hang da nhan qua webhook.
 */
router.get('/orders', (req, res) => {
  try {
    const limit = Math.min(Number(req.query.limit || 50), 200);
    const offset = Number(req.query.offset || 0);
    const rows = db.listOrders({ limit, offset });
    res.json({ success: true, count: rows.length, data: rows });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * GET /api/analytics/summary
 * Xem tong hop doanh thu va san pham ban chay.
 * Query:
 * - date=YYYY-MM-DD
 * - hoac from=YYYY-MM-DD&to=YYYY-MM-DD
 */
router.get('/analytics/summary', (req, res) => {
  try {
    const { fromIso, toIso, label } = resolveSummaryRange(req.query);
    const orders = db.getOrdersByDateRange({ fromIso, toIso });
    const orderIds = orders.map((order) => order.external_order_id);
    const items = db.getOrderItemsByOrderIds(orderIds);
    const summary = calc.calculateRevenueFromStoredOrders(orders, items);

    res.json({
      success: true,
      range: {
        label,
        from: fromIso,
        to: toIso,
      },
      summary,
    });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

/**
 * POST /api/lark/test
 * Gửi tin nhắn test lên Lark để kiểm tra kết nối
 */
router.post('/lark/test', async (req, res) => {
  try {
    await lark.sendTextAlert('🔔 [TEST] Kết nối Lark thành công! Bot Shopee đang hoạt động bình thường.');
    res.json({ success: true, message: 'Tin nhắn test đã gửi lên Lark.' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * GET /api/lark/chats
 * Liet ke nhom chat de lay LARK_CHAT_ID.
 */
router.get('/lark/chats', async (req, res) => {
  try {
    const data = await lark.listChats({
      pageSize: Math.min(Number(req.query.pageSize || 20), 100),
      pageToken: req.query.pageToken,
    });

    const chats = (data.items || []).map((chat) => ({
      name: chat.name,
      chat_id: chat.chat_id,
      description: chat.description,
      chat_type: chat.chat_type,
    }));

    res.json({
      success: true,
      count: chats.length,
      chats,
      hasMore: data.has_more,
      pageToken: data.page_token,
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

function shouldSyncOrderDetails() {
  return process.env.SYNC_ORDER_DETAILS_TO_LARK === 'true';
}

function resolveSummaryRange(query) {
  const date = query.date || todayYmd();
  const from = query.from || date;
  const to = query.to || date;

  if (!isYmd(from) || !isYmd(to)) {
    throw new Error('date/from/to phai co dinh dang YYYY-MM-DD.');
  }

  return {
    label: from === to ? from : `${from} -> ${to}`,
    fromIso: new Date(`${from}T00:00:00+07:00`).toISOString(),
    toIso: new Date(`${to}T23:59:59+07:00`).toISOString(),
  };
}

function todayYmd() {
  const now = new Date();
  const vn = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Ho_Chi_Minh' }));
  const yyyy = vn.getFullYear();
  const mm = String(vn.getMonth() + 1).padStart(2, '0');
  const dd = String(vn.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

function isYmd(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(value || ''));
}

module.exports = router;
