/**
 * Express Router - API Routes
 * Cung cấp các endpoint HTTP để:
 *  - Kích hoạt báo cáo thủ công
 *  - Kiểm tra trạng thái hệ thống
 *  - Quản lý credentials
 */
// Sapo Webhook is active for stateless syncing
const express = require('express');
const router  = express.Router();
const logger  = require('../utils/logger');
const db      = require('../database/db');
const shopee  = require('../services/shopee');
const lark    = require('../services/lark');
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
    mode:      process.env.INTEGRATION_MODE || 'sapo_go_scrape',
    uptime:    Math.floor(process.uptime()) + 's',
    timestamp: new Date().toISOString(),
    timezone:  process.env.TZ || 'Asia/Ho_Chi_Minh',
    larkBase:  lark.isBaseEnabled(),
  });
});

// ─────────────────────────────────────────────
// WEBHOOKS
// ─────────────────────────────────────────────

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
// LARK BASE MANUAL SYNC
// ─────────────────────────────────────────────

/**
 * POST /api/base/sync
 * Đồng bộ lại dữ liệu Sapo vào Lark Base cho 1 ngày cụ thể
 * Body: { date: "31/05/2026" }  — định dạng DD/MM/YYYY
 */
router.post('/base/sync', async (req, res) => {
  const dateStr = req.body?.date || '';
  if (!dateStr) {
    return res.status(400).json({ success: false, error: 'Thiếu tham số date (định dạng DD/MM/YYYY)' });
  }
  logger.info(`📌 [API] Manual sync Lark Base cho ngày: ${dateStr}`);
  try {
    await lark.syncFinancialReportToLarkBase({ reportDate: dateStr });
    return res.json({ success: true, message: `Đã đồng bộ Lark Base cho ngày ${dateStr} thành công!` });
  } catch (err) {
    logger.error('[API] Sync Lark Base thất bại: ' + err.message);
    return res.status(500).json({ success: false, error: err.message });
  }
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
    const rows = _db.prepare('SELECT * FROM report_history ORDER BY report_date DESC, sent_at DESC LIMIT 30').all();
    
    const formattedRows = rows.map(row => {
      let details = null;
      if (row.raw_json) {
        try {
          details = JSON.parse(row.raw_json);
        } catch (e) {
          logger.error(`[API] Lỗi parse raw_json của ngày ${row.report_date}: ${e.message}`);
        }
      }
      return {
        ...row,
        details
      };
    });
    
    res.json({ success: true, count: rows.length, data: formattedRows });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * GET /api/analytics/dashboard
 * Trả về toàn bộ lịch sử báo cáo tài chính Shopee cho giao diện Dashboard.
 * Nếu SQLite chưa có dữ liệu báo cáo nào, tự động sinh dữ liệu mẫu 7 ngày gần nhất để làm seeder trực quan.
 */
router.get('/analytics/dashboard', (req, res) => {
  try {
    const Database = require('better-sqlite3');
    const path = require('path');
    const _db = new Database(path.join(__dirname, '../../data/store.db'));
    const rows = _db.prepare('SELECT * FROM report_history WHERE status = \'success\' ORDER BY report_date ASC').all();

    // 1. Nếu có dữ liệu trong SQLite, trả về dữ liệu thực tế
    if (rows.length > 0) {
      const reports = rows.map(row => {
        if (row.raw_json) {
          try {
            return JSON.parse(row.raw_json);
          } catch (e) {
            logger.error(`[API] Lỗi parse raw_json của ngày ${row.report_date}: ${e.message}`);
          }
        }
        
        // Cấu trúc fallback cho dữ liệu cũ (Legacy)
        return {
          reportDate: row.report_date,
          totalRevenue: row.total_revenue || 0,
          totalOrders: row.total_orders || 0,
          avgPerOrder: row.avg_per_order || 0,
          aiAnalysis: row.ai_analysis || '',
          fees: { total: 0, transaction: 0, commission: 0, service: 0 },
          netRevenue: row.total_revenue || 0,
          expectedNetRevenue: row.total_revenue || 0,
          shopeeShopBreakdown: {},
          topProducts: []
        };
      });

      logger.info(`[API] Trả về ${reports.length} báo cáo thực tế từ SQLite.`);
      return res.json({ success: true, isMock: false, data: reports });
    }

    // 2. Nếu SQLite rỗng (Fresh setup), tự động sinh dữ liệu mẫu 7 ngày gần nhất cực kỳ trực quan
    logger.info(`[API] SQLite chưa có báo cáo. Đang sinh dữ liệu mẫu seeder 7 ngày gần nhất cho Dashboard...`);
    const mockData = generateMockDashboardData();
    res.json({ success: true, isMock: true, data: mockData });

  } catch (err) {
    logger.error(`[API] Lỗi lấy dữ liệu dashboard: ${err.message}`);
    res.status(500).json({ success: false, error: err.message });
  }
});

// Hàm hỗ trợ sinh dữ liệu mẫu seeder 7 ngày cực đẹp cho Dashboard
function generateMockDashboardData() {
  const data = [];
  const now = new Date();
  
  const mockProducts = [
    { name: "Kệ Gỗ Đựng Đồ Đa Năng LUXI", sku: "KE-GO-01", basePrice: 140000 },
    { name: "Khay Mây Tròn Tự Nhiên Decor", sku: "KHAY-MAY-02", basePrice: 100000 },
    { name: "Đèn Gốm Bát Tràng Cao Cấp", sku: "DEN-GOM-03", basePrice: 175000 },
    { name: "Giỏ Cói Đựng Đồ LUXI Home", sku: "GIO-COI-04", basePrice: 80000 },
    { name: "Lọ Hoa Thuỷ Tinh Bắc Âu", sku: "LO-HOA-05", basePrice: 60000 }
  ];
  
  const shopNames = ["Shop A - LUXI HN", "Shop B - LUXI HCM", "Shop C - LUXI DN", "Shop D - LUXI HP", "Shop E - LUXI Cần Thơ", "Shop F - LUXI Biên Hoà"];
  const shopShares = [0.28, 0.22, 0.18, 0.15, 0.10, 0.07];

  for (let i = 6; i >= 0; i--) {
    const d = new Date(now);
    d.setDate(d.getDate() - i - 1); // Từ 7 ngày trước đến hôm qua
    
    const dd = String(d.getDate()).padStart(2, '0');
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const yyyy = d.getFullYear();
    const dateStr = `${dd}/${mm}/${yyyy}`;
    
    // Thăng giáng doanh số ngẫu nhiên theo ngày
    const baseOrders = 70 + Math.floor(Math.random() * 40); // 70-110 đơn
    const baseRevenue = baseOrders * (150000 + Math.floor(Math.random() * 30000)); // ~10.5M - 19.8M
    
    // Tính toán chi tiết chi phí sàn
    const transactionFee = Math.round(baseRevenue * 0.03); // 3% phí thanh toán
    const serviceFee = Math.round(baseRevenue * 0.08); // 8% phí dịch vụ
    const commissionFee = Math.round(baseRevenue * 0.025); // 2.5% phí hoa hồng/vận chuyển
    const totalFees = transactionFee + serviceFee + commissionFee;
    const feeRate = Math.round((totalFees / baseRevenue) * 1000) / 10;
    
    const expectedNetRevenue = baseRevenue - totalFees;
    const netRevenue = Math.round(expectedNetRevenue * (0.95 + Math.random() * 0.04)); // Ví thực nhận trễ/điều chỉnh ~95-99% dự kiến
    
    // Chi tiết 6 cửa hàng
    const shopeeShopBreakdown = {};
    shopNames.forEach((name, idx) => {
      const share = shopShares[idx];
      const shopRevenue = Math.round(baseRevenue * share * (0.95 + Math.random() * 0.1));
      const shopOrders = Math.round(baseOrders * share * (0.9 + Math.random() * 0.2));
      const shopFeesTotal = Math.round(totalFees * share * (0.95 + Math.random() * 0.1));
      const shopFees = {
        total: shopFeesTotal,
        transaction: Math.round(transactionFee * share),
        commission: Math.round(commissionFee * share),
        service: Math.round(serviceFee * share)
      };
      shopeeShopBreakdown[name] = {
        revenue: shopRevenue,
        orders: shopOrders,
        cancelledCount: Math.floor(Math.random() * 3),
        fees: shopFees,
        netRevenue: shopRevenue - shopFeesTotal,
        netRevenueActual: Math.round((shopRevenue - shopFeesTotal) * (0.95 + Math.random() * 0.04))
      };
    });
    
    // Chi tiết sản phẩm bán chạy
    const topProducts = mockProducts.map((p, idx) => {
      const share = 0.35 - (idx * 0.06); // Phân bổ tỉ lệ bán chạy giảm dần
      const qty = Math.round(baseOrders * share * (0.8 + Math.random() * 0.4));
      const revenue = qty * p.basePrice;
      const orderNumber = Math.round(qty * (0.85 + Math.random() * 0.1));
      const cancelledQty = Math.floor(Math.random() * 3);
      const cancelledOrderNumber = Math.max(0, cancelledQty - 1);
      const cancelledRate = Math.round((cancelledQty / (qty || 1)) * 1000) / 10;
      
      return {
        name: p.name,
        fullName: `${p.name} - Phiên Bản Giới Hạn Decor`,
        variantName: idx % 2 === 0 ? "Màu Gỗ Sồi" : "Màu Trắng Kem",
        sku: p.sku,
        shopName: shopNames[idx % 3],
        qty,
        revenue,
        orderNumber,
        cancelledQty,
        cancelledOrderNumber,
        cancelledRate
      };
    }).sort((a, b) => b.qty - a.qty);
    
    const liveTasks = {
      pending: 10 + Math.floor(Math.random() * 15),
      packed: 8 + Math.floor(Math.random() * 12),
      shipping: 25 + Math.floor(Math.random() * 20),
      in_cancelled: 3 + Math.floor(Math.random() * 5)
    };
    
    data.push({
      reportDate: dateStr,
      totalRevenue: baseRevenue,
      totalOrders: baseOrders,
      totalProducts: topProducts.reduce((acc, p) => acc + p.qty, 0),
      avgPerOrder: Math.round(baseRevenue / baseOrders),
      cancelledCount: liveTasks.in_cancelled,
      cancelledRate: 0,
      pendingFulfillmentCount: liveTasks.pending,
      pendingConfirmationCount: liveTasks.packed,
      shippingCount: liveTasks.shipping,
      totalDiscount: Math.round(baseRevenue * 0.05),
      totalShippingFee: Math.round(baseRevenue * 0.04),
      fees: {
        total: totalFees,
        transaction: transactionFee,
        commission: commissionFee,
        service: serviceFee
      },
      netRevenue,
      expectedNetRevenue,
      feeRate,
      shopeeShopBreakdown,
      topProducts,
      dayBeforeRevenue: 0,
      dayBeforeNetRevenue: 0,
      dayBeforeExpectedNet: 0,
      processedAt: new Date(d.getTime() + 8*60*60*1000).toISOString()
    });
  }
  
  // Điền tăng trưởng so với ngày hôm trước
  for (let i = 0; i < data.length; i++) {
    if (i > 0) {
      data[i].dayBeforeRevenue = data[i-1].totalRevenue;
      data[i].dayBeforeNetRevenue = data[i-1].netRevenue;
      data[i].dayBeforeExpectedNet = data[i-1].expectedNetRevenue;
    } else {
      data[i].dayBeforeRevenue = Math.round(data[i].totalRevenue * 0.95);
      data[i].dayBeforeNetRevenue = Math.round(data[i].netRevenue * 0.95);
      data[i].dayBeforeExpectedNet = Math.round(data[i].expectedNetRevenue * 0.95);
    }
  }
  
  return data;
}

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
