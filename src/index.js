/**
 * Main Entry Point
 * Khởi động Express server + Scheduler
 */
require('dotenv').config();

const express   = require('express');
const logger    = require('./utils/logger');
const { initDatabase } = require('./database/db');
const { startScheduler } = require('./scheduler');
const apiRouter = require('./routes/api');

const PORT = process.env.PORT || 3000;
const INTEGRATION_MODE = process.env.INTEGRATION_MODE || 'nhanh_webhook';

// ── Validate biến môi trường bắt buộc ──────────────
function validateEnv() {
  const required = [];

  if (INTEGRATION_MODE === 'shopee_api') {
    required.push('SHOPEE_PARTNER_ID', 'SHOPEE_API_SECRET', 'SHOPEE_SHOP_ID');
  }

  const missing = required.filter((k) => !isConfigured(process.env[k]));
  if (missing.length > 0) {
    logger.error(`Thieu bien moi truong bat buoc: ${missing.join(', ')}`);
    logger.error('Hay copy .env.example -> .env va dien day du thong tin.');
    process.exit(1);
  }

  const hasLarkApp = isConfigured(process.env.LARK_APP_ID) && isConfigured(process.env.LARK_APP_SECRET);
  const hasLarkTarget = isConfigured(process.env.LARK_CHAT_ID)
    || (isConfigured(process.env.LARK_BASE_APP_TOKEN) && isConfigured(process.env.LARK_BASE_TABLE_ID));
  if (!hasLarkApp || !hasLarkTarget) {
    logger.warn('Lark chua cau hinh day du. Ban van co the setup Shopee token truoc, nhung chua gui/sync duoc sang Lark.');
  }

  if (INTEGRATION_MODE === 'nhanh_webhook' && !process.env.NHANH_WEBHOOK_VERIFY_TOKEN) {
    logger.warn('NHANH_WEBHOOK_VERIFY_TOKEN chua duoc cau hinh. Nen dat token de chan request la.');
  }
}

function isConfigured(value) {
  if (!value) return false;
  const normalized = String(value).trim().toLowerCase();
  return normalized !== ''
    && !normalized.startsWith('your_')
    && !normalized.includes('your-domain.com');
}

// ── Bootstrap ───────────────────────────────────────
async function bootstrap() {
  logger.info('');
  logger.info('╔══════════════════════════════════════════════════╗');
  logger.info('║   SHOPEE / NHANH -> LARK MIDDLEWARE SERVER      ║');
  logger.info('║   Bao cao doanh thu tu dong moi ngay 8:00 AM    ║');
  logger.info('╚══════════════════════════════════════════════════╝');
  logger.info('');
  logger.info(`Che do tich hop: ${INTEGRATION_MODE}`);

  // 1. Kiểm tra ENV
  validateEnv();

  // 2. Khởi tạo Database
  initDatabase();

  // 3. Tạo Express App
  const app = express();
  app.use(express.json());

  // CORS Middleware
  app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization');
    if (req.method === 'OPTIONS') {
      return res.sendStatus(200);
    }
    next();
  });

  // 4. Routes
  app.use('/api', apiRouter);

  // Root
  app.get('/', (req, res) => {
    res.json({
      name:    'Shopee → Lark Middleware',
      version: '1.0.0',
      status:  'running',
      endpoints: {
        health:         'GET  /api/health',
        sapoWebhook:    'POST /api/webhooks/sapo/order',
        sapoSync:       'POST /api/sapo/sync',
        nhanhWebhook:   'POST /api/webhooks/nhanh/order',
        triggerReport:  'POST /api/report/trigger',
        refreshToken:   'POST /api/token/refresh',
        shopSetup:      'POST /api/shop/setup',
        orders:         'GET  /api/orders',
        reportHistory:  'GET  /api/reports',
        larkTest:       'POST /api/lark/test',
      },
    });
  });

  // Global error handler
  app.use((err, req, res, next) => {
    logger.error('Unhandled error: ' + err.message);
    res.status(500).json({ error: 'Internal server error', message: err.message });
  });

  // 5. Start server
  const server = app.listen(PORT, () => {
    logger.info(`🌐 Server đang chạy tại: http://localhost:${PORT}`);
  });

  server.on('error', (err) => {
    logger.error(`Khong khoi dong duoc server tren port ${PORT}: ${err.message}`);
    const { stopScheduler } = require('./scheduler');
    stopScheduler();
    process.exit(1);
  });

  // 6. Khởi động Scheduler (Cron Jobs)
  startScheduler();

  // 7. Xử lý tắt server graceful
  process.on('SIGTERM', () => {
    logger.info('👋 Nhận SIGTERM. Đang tắt server...');
    const { stopScheduler } = require('./scheduler');
    stopScheduler();
    process.exit(0);
  });

  process.on('SIGINT', () => {
    logger.info('👋 Nhận SIGINT (Ctrl+C). Đang tắt server...');
    const { stopScheduler } = require('./scheduler');
    stopScheduler();
    process.exit(0);
  });

  process.on('uncaughtException', (err) => {
    logger.error('💥 Uncaught Exception: ' + err.message);
    logger.error(err.stack);
  });

  process.on('unhandledRejection', (reason) => {
    logger.error('💥 Unhandled Rejection: ' + reason);
  });
}

bootstrap().catch((err) => {
  console.error('Bootstrap thất bại:', err);
  process.exit(1);
});
