/**
 * Main Report Workflow
 * Orchestrator điều phối toàn bộ quy trình báo cáo doanh thu
 */
const logger   = require('../utils/logger');
const shopee   = require('../services/shopee');
const lark     = require('../services/lark');
const openai   = require('../services/openai');
const calc     = require('../services/calculator');
const db       = require('../database/db');
const sapo     = require('../services/sapo');

/**
 * Chạy toàn bộ quy trình báo cáo doanh thu ngày
 * @param {Object} options
 * @param {string} options.shopId - ID shop cần báo cáo (mặc định lấy từ ENV)
 */
async function runDailyReport({ shopId } = {}) {
  const targetShopId = shopId || process.env.SHOPEE_SHOP_ID;
  const startTime    = Date.now();
  const integrationMode = process.env.INTEGRATION_MODE || 'nhanh_webhook';
  const shopName = process.env.SHOP_NAME || (targetShopId ? `Shop ${targetShopId}` : 'Shopee Shop');

  logger.info('═'.repeat(55));
  logger.info('🚀 BẮT ĐẦU QUY TRÌNH BÁO CÁO DOANH THU NGÀY');
  logger.info(`   Chế độ: ${integrationMode} | Shop: ${shopName}`);
  logger.info('═'.repeat(55));

  // 1. Nếu là Sapo Go Scraper (Cào trực tiếp từ Dashboard Sàn TMĐT Sapo Go - Hoàn toàn Shopee)
  if (integrationMode === 'sapo_go_scrape') {
    try {
      logger.info(`🔍 [SAPO GO SCRAPE] Đang truy cập Sapo Go Marketplace để lấy dữ liệu Shopee thực tế...`);
      const sapoGoScraper = require('../services/sapoGoScraper');
      const marketplaceReport = await sapoGoScraper.getMarketplaceReport({
        storeAlias: process.env.SAPO_STORE_ALIAS,
        username: process.env.SAPO_GO_USERNAME,
        password: process.env.SAPO_GO_PASSWORD
      });

      // Tính % tăng trưởng dựa trên doanh thu hôm qua và hôm kia đã cào
      const rawGrowth = calc.calcGrowthPercent(
        marketplaceReport.totalRevenue,
        marketplaceReport.dayBeforeRevenue
      );
      const growthPercent = rawGrowth !== null ? Number(rawGrowth.toFixed(1)) : 0;

      // Phân tích AI
      let aiAnalysis = null;
      try {
        aiAnalysis = await openai.analyzeRevenue({
          todayData: {
            reportDate: marketplaceReport.reportDate,
            totalRevenue: marketplaceReport.totalRevenue,
            totalOrders: marketplaceReport.totalOrders,
            avgPerOrder: marketplaceReport.avgPerOrder,
            cancelledCount: marketplaceReport.cancelledCount,
            pendingFulfillmentCount: marketplaceReport.pendingFulfillmentCount,
            pendingConfirmationCount: marketplaceReport.pendingConfirmationCount,
            topProducts: marketplaceReport.topProducts
          },
          yesterdayData: {
            total_revenue: marketplaceReport.dayBeforeRevenue
          }
        });
      } catch (aiErr) {
        logger.error(`⚠️ Lỗi phân tích AI (bỏ qua): ${aiErr.message}`);
      }

      // Tổng hợp dữ liệu gửi Lark
      const finalReport = {
        ...marketplaceReport,
        shopName: process.env.SHOP_NAME || 'LUXI DECOR (Shopee Sapo Go)',
        growthPercent,
        aiAnalysis: aiAnalysis || `💡 **Phân tích Hiệu suất Shopee Marketplace:**\n- **Doanh thu Shopee:** Đạt **${new Intl.NumberFormat('vi-VN').format(marketplaceReport.totalRevenue)} VNĐ** từ **${marketplaceReport.totalOrders} đơn hàng** thành công.\n- **Kỳ trước:** Doanh thu hôm trước đạt **${new Intl.NumberFormat('vi-VN').format(marketplaceReport.dayBeforeRevenue)} VNĐ** (tăng trưởng **${growthPercent}%**).`
      };

      // Gửi báo cáo lên Lark
      await lark.sendReportCard(finalReport);

      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
      logger.info('═'.repeat(55));
      logger.info(`✅ BÁO CÁO SHOPEE MARKETPLACE HOÀN TẤT trong ${elapsed}s`);
      logger.info('═'.repeat(55));

      return finalReport;
    } catch (err) {
      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
      logger.error(`❌ QUY TRÌNH BÁO CÁO SHOPEE MARKETPLACE THẤT BẠI sau ${elapsed}s: ${err.message}`);
      logger.error(err.stack);

      // Gửi alert lỗi lên Lark với thông báo chi tiết
      try {
        let alertMessage = `🚨 *[CẢNH BÁO]* Báo cáo doanh thu Shopee hôm qua thất bại!\n\nLỗi: ${err.message}\n\nVui lòng kiểm tra server.`;
        if (err.message.includes('Timeout') || err.message.includes('headers') || err.message.includes('xác thực')) {
          alertMessage = `🚨 *[CẢNH BÁO]* Báo cáo doanh thu Shopee thất bại do **Lỗi Xác Thực / Hết hạn Session Sapo Go**!\n\nChi tiết lỗi: ${err.message}\n\n👉 *Khuyến nghị:* Hãy kiểm tra xem thông tin tài khoản Sapo Go trong file \`.env\` (tài khoản/mật khẩu) có thay đổi không, hoặc kiểm tra xem tài khoản có bị khóa/yêu cầu mã OTP không.`;
        }
        await lark.sendTextAlert(alertMessage);
      } catch (_) {}

      throw err;
    }
  }

  // 1b. Nếu là Sapo API (luồng hoàn toàn Stateless qua Sapo API)
  if (integrationMode === 'sapo_api') {
    try {
      const { yesterday, dayBefore } = calc.getTwoDaysTimeRanges();
      logger.info(`📅 Khung giờ Hôm qua: ${yesterday.reportDate} | ${yesterday.timeFrom} → ${yesterday.timeTo}`);
      logger.info(`📅 Khung giờ Hôm kia: ${dayBefore.reportDate} | ${dayBefore.timeFrom} → ${dayBefore.timeTo}`);

      // Kéo đơn Hôm qua từ API
      const yesterdayOrders = await sapo.getOrdersFromApi(yesterday);
      const yesterdayShopeeOrders = yesterdayOrders.filter(o => o.platform === 'shopee');
      logger.info(`📊 Đã lọc được ${yesterdayShopeeOrders.length}/${yesterdayOrders.length} đơn Shopee hôm qua.`);

      const yesterdayStats = calc.calculateRevenueFromSapoApi(yesterdayShopeeOrders);

      // Kéo đơn Hôm kia từ API
      const dayBeforeOrders = await sapo.getOrdersFromApi(dayBefore);
      const dayBeforeShopeeOrders = dayBeforeOrders.filter(o => o.platform === 'shopee');
      logger.info(`📊 Đã lọc được ${dayBeforeShopeeOrders.length}/${dayBeforeOrders.length} đơn Shopee hôm kia.`);

      const dayBeforeStats = calc.calculateRevenueFromSapoApi(dayBeforeShopeeOrders);

      // Tính toán % tăng trưởng
      const growthPercent = calc.calcGrowthPercent(
        yesterdayStats.totalRevenue,
        dayBeforeStats.totalRevenue
      );

      // Phân tích AI
      let aiAnalysis = null;
      try {
        aiAnalysis = await openai.analyzeRevenue({
          todayData: {
            reportDate: yesterday.reportDate,
            ...yesterdayStats,
          },
          yesterdayData: {
            total_revenue: dayBeforeStats.totalRevenue,
            total_orders: dayBeforeStats.totalOrders,
            avg_per_order: dayBeforeStats.avgPerOrder,
          },
        });
      } catch (aiErr) {
        logger.error(`⚠️ Lỗi phân tích AI (bỏ qua): ${aiErr.message}`);
      }

      // Tổng hợp dữ liệu gửi Lark
      const finalReport = {
        reportDate: yesterday.reportDate,
        shopName,
        growthPercent,
        aiAnalysis,
        ...yesterdayStats,
      };

      // Gửi báo cáo lên Lark
      await lark.sendReportCard(finalReport);

      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
      logger.info('═'.repeat(55));
      logger.info(`✅ BÁO CÁO STATELESS HOÀN TẤT trong ${elapsed}s`);
      logger.info('═'.repeat(55));

      return finalReport;
    } catch (err) {
      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
      logger.error(`❌ QUY TRÌNH BÁO CÁO STATELESS THẤT BẠI sau ${elapsed}s: ${err.message}`);
      logger.error(err.stack);

      // Gửi alert lỗi lên Lark
      try {
        await lark.sendTextAlert(
          `🚨 *[CẢNH BÁO]* Báo cáo doanh thu ngày hôm qua thất bại!\n\nLỗi: ${err.message}\n\nVui lòng kiểm tra server.`
        );
      } catch (_) {}

      throw err;
    }
  }

  // 2. Các luồng cũ (Stateful - Shopee API / Webhook Store)
  const { timeFrom, timeTo, reportDate } = calc.getYesterdayTimeRange();
  logger.info(`📅 Khung thời gian cũ: ${reportDate} | ${timeFrom} → ${timeTo}`);

  try {
    const revenueData = integrationMode === 'shopee_api'
      ? await buildReportFromShopeeApi({ targetShopId, timeFrom, timeTo, reportDate, shopName })
      : await buildReportFromWebhookStore({ timeFrom, timeTo });

    // Lấy kỳ trước để so sánh tăng trưởng từ DB
    const lastReport    = db.getLastSuccessReport(reportDate);
    const growthPercent = calc.calcGrowthPercent(
      revenueData.totalRevenue,
      lastReport?.total_revenue
    );

    // Phân tích AI
    const todayDataForAI = {
      reportDate,
      ...revenueData,
    };
    const aiAnalysis = await openai.analyzeRevenue({
      todayData:     todayDataForAI,
      yesterdayData: lastReport,
    });

    const finalReport = {
      reportDate,
      shopName,
      totalRevenue:   revenueData.totalRevenue,
      totalOrders:    revenueData.totalOrders,
      avgPerOrder:    revenueData.avgPerOrder,
      cancelledCount: revenueData.cancelledCount,
      unpaidCount:    revenueData.unpaidCount,
      topProducts:    revenueData.topProducts,
      growthPercent,
      aiAnalysis,
    };

    // Gửi báo cáo lên Lark
    await lark.sendReportCard(finalReport);

    // Lưu vào DB
    db.saveReport(reportDate, {
      totalRevenue:  finalReport.totalRevenue,
      totalOrders:   finalReport.totalOrders,
      avgPerOrder:   finalReport.avgPerOrder,
      aiAnalysis:    aiAnalysis || '',
    });

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    logger.info('═'.repeat(55));
    logger.info(`✅ BÁO CÁO HOÀN TẤT trong ${elapsed}s`);
    logger.info('═'.repeat(55));

    return finalReport;

  } catch (err) {
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    logger.error(`❌ QUY TRÌNH BÁO CÁO THẤT BẠI sau ${elapsed}s: ${err.message}`);
    logger.error(err.stack);

    // Lưu lỗi vào DB
    db.saveReportError(reportDate, err.message);

    // Gửi alert lỗi lên Lark
    await lark.sendTextAlert(
      `🚨 *[CẢNH BÁO]* Báo cáo doanh thu ngày ${reportDate} thất bại!\n\nLỗi: ${err.message}\n\nVui lòng kiểm tra server.`
    );

    throw err;
  }
}

async function buildReportFromShopeeApi({ targetShopId, timeFrom, timeTo, reportDate, shopName }) {
  const orderList = await shopee.getOrderList({
    shopId: targetShopId,
    timeFrom,
    timeTo,
  });

  if (orderList.length === 0) {
    logger.warn('⚠️  Không có đơn hàng nào trong ngày hôm qua.');
    return buildEmptyRevenueData(reportDate, shopName);
  }

  const orderSnList = orderList.map((o) => o.order_sn);
  const orderDetails = await shopee.getOrderDetails({
    shopId: targetShopId,
    orderSnList,
  });

  return calc.calculateRevenue(orderDetails);
}

async function buildReportFromWebhookStore({ timeFrom, timeTo }) {
  const fromIso = new Date(timeFrom * 1000).toISOString();
  const toIso = new Date(timeTo * 1000).toISOString();
  const orders = db.getOrdersByDateRange({ fromIso, toIso });
  const orderIds = orders.map((order) => order.external_order_id);
  const items = db.getOrderItemsByOrderIds(orderIds);

  if (orders.length === 0) {
    logger.warn('⚠️  Không có đơn webhook nào trong ngày hôm qua.');
  }

  return calc.calculateRevenueFromStoredOrders(orders, items);
}

function buildEmptyRevenueData() {
  return {
    totalRevenue: 0,
    totalOrders: 0,
    totalProducts: 0,
    avgPerOrder: 0,
    cancelledCount: 0,
    cancelledRate: 0,
    pendingFulfillmentCount: 0,
    pendingConfirmationCount: 0,
    topProducts: [],
  };
}

module.exports = { runDailyReport };
