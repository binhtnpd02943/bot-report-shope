/**
 * Scheduler Module
 * Quản lý tất cả Cron Jobs:
 *  1. Báo cáo doanh thu lúc 8:00 AM mỗi ngày
 *  2. Refresh Shopee token mỗi 3 tiếng
 */
const cron   = require('node-cron');
const logger = require('./utils/logger');

let reportJob;
let tokenRefreshJob;

/**
 * Khởi động tất cả scheduled jobs
 */
function startScheduler() {
  const reportCron      = process.env.REPORT_CRON       || '0 8 * * *';
  const tokenCron       = process.env.TOKEN_REFRESH_CRON || '0 */3 * * *';
  const shopId          = process.env.SHOPEE_SHOP_ID;
  const integrationMode = process.env.INTEGRATION_MODE || 'nhanh_webhook';

  // ── JOB 1: Báo cáo doanh thu hàng ngày ──────────────
  logger.info(`⏰ Đặt lịch báo cáo: "${reportCron}" (mỗi ngày lúc 8:00 AM)`);

  reportJob = cron.schedule(
    reportCron,
    async () => {
      logger.info('⏰ [CRON] Trigger báo cáo doanh thu hàng ngày...');
      try {
        // Import ở đây để tránh circular dependency
        const { runDailyReport } = require('./workflows/dailyReport');
        await runDailyReport({ shopId });
      } catch (err) {
        logger.error('[CRON] Báo cáo thất bại: ' + err.message);
      }
    },
    {
      timezone: 'Asia/Ho_Chi_Minh',
      scheduled: true,
    }
  );

  // ── JOB 2: Refresh Token tự động cho Shopee Open API ─
  if (integrationMode !== 'shopee_api') {
    logger.info('Bo qua lich refresh Shopee token vi dang chay che do webhook.');
    logger.info('✅ Scheduler khởi động thành công. Report job đang chạy.');
    logNextRuns(reportCron, null);
    return;
  }

  logger.info(`🔄 Đặt lịch refresh token: "${tokenCron}" (mỗi 3 tiếng)`);

  tokenRefreshJob = cron.schedule(
    tokenCron,
    async () => {
      logger.info('🔄 [CRON] Refresh Shopee access token...');
      try {
        const shopee = require('./services/shopee');
        await shopee.refreshAccessToken(shopId);
      } catch (err) {
        logger.error('[CRON] Refresh token thất bại: ' + err.message);

        // Gửi cảnh báo nếu token refresh lỗi
        try {
          const lark = require('./services/lark');
          await lark.sendTextAlert(
            `⚠️ *[CẢNH BÁO]* Refresh token Shopee thất bại!\nLỗi: ${err.message}\nVui lòng kiểm tra refresh_token trong Database.`
          );
        } catch (_) {}
      }
    },
    {
      timezone: 'Asia/Ho_Chi_Minh',
      scheduled: true,
    }
  );

  logger.info('✅ Scheduler khởi động thành công. Tất cả jobs đang chạy.');
  logNextRuns(reportCron, tokenCron);
}

/**
 * Dừng tất cả cron jobs
 */
function stopScheduler() {
  if (reportJob)      { reportJob.stop();      logger.info('⏹  Báo cáo job đã dừng.'); }
  if (tokenRefreshJob){ tokenRefreshJob.stop(); logger.info('⏹  Token refresh job đã dừng.'); }
}

/**
 * Log thời gian chạy tiếp theo
 */
function logNextRuns(reportCron, tokenCron) {
  // Hiển thị lịch đơn giản
  logger.info(`📅 Lịch trình:`);
  logger.info(`   - Báo cáo ngày:     [${reportCron}] (07:00 sáng hàng ngày)`);
  if (tokenCron) {
    logger.info(`   - Refresh token:    [${tokenCron}] (mỗi 3 tiếng)`);
  }
}

module.exports = { startScheduler, stopScheduler };
