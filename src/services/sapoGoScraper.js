/**
 * Sapo Go Scraper Service
 * Sử dụng Puppeteer để đăng nhập Sapo Go tự động dưới danh nghĩa trình duyệt của người dùng
 * và gọi API nội bộ để lấy dữ liệu 6 shop Shopee hoàn toàn miễn phí.
 */
const puppeteer = require('puppeteer');
const axios = require('axios');
const logger = require('../utils/logger');
const db = require('../database/db');

/**
 * Đăng nhập Sapo Go và lấy danh sách đơn hàng trong khoảng thời gian (Legacy POS)
 */
async function getOrdersFromSapoGo({ storeAlias, username, password, timeFrom, timeTo }) {
  logger.info(`🌐 [PUPPETEER] Khởi chạy trình duyệt ẩn danh kết nối Sapo Go (${storeAlias}.mysapogo.com)...`);

  const browser = await puppeteer.launch({
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-web-security',
      '--disable-features=IsolateOrigins,site-per-process'
    ],
  });

  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 800 });
  await page.setUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36');

  try {
    const loginUrl = `https://${storeAlias}.mysapogo.com/admin/orders`;
    logger.info(`📡 Đi đến trang quản trị Sapo Go: ${loginUrl}`);
    await page.goto(loginUrl, { waitUntil: 'networkidle2', timeout: 60000 });

    const currentUrl = page.url();
    if (currentUrl.includes('accounts.sapo.vn') || currentUrl.includes('/login')) {
      logger.info('🔑 Phát hiện trang đăng nhập Sapo Central Accounts. Tiến hành điền thông tin...');

      const userSelector = 'input[name="Username"], input#Username, input#username, input[type="text"], input[type="email"]';
      await page.waitForSelector(userSelector, { timeout: 20000 });
      await page.focus(userSelector);
      await page.type(userSelector, username, { delay: 50 });

      const passSelector = 'input[name="Password"], input#Password, input#password, input[type="password"]';
      const isPassVisible = await page.evaluate((sel) => {
        const el = document.querySelector(sel);
        if (!el) return false;
        const rect = el.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0 && window.getComputedStyle(el).display !== 'none';
      }, passSelector);

      if (!isPassVisible) {
        const nextBtnSelector = 'button[type="submit"], input[type="submit"], button#btnLogin, .btn-login, button.btn-next';
        await page.click(nextBtnSelector);
        await page.waitForSelector(passSelector, { timeout: 15000 });
      }

      await page.focus(passSelector);
      await page.type(passSelector, password, { delay: 50 });

      const submitBtnSelector = 'button[type="submit"], input[type="submit"], button#btnLogin, .btn-login';
      await Promise.all([
        page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 60000 }),
        page.click(submitBtnSelector)
      ]);

      logger.info('🎉 Đăng nhập Sapo Go thành công!');
    }

    await page.waitForFunction(() => window.location.href.includes('/admin'), { timeout: 20000 });

    const fromIso = new Date(timeFrom * 1000).toISOString();
    const toIso = new Date(timeTo * 1000).toISOString();

    const rawOrders = await page.evaluate(async (from, to) => {
      const apiUrl = `/admin/orders.json?created_on_min=${encodeURIComponent(from)}&created_on_max=${encodeURIComponent(to)}&limit=250`;
      const response = await fetch(apiUrl);
      if (!response.ok) {
        throw new Error(`Sapo Go API return status ${response.status}`);
      }
      const data = await response.json();
      return data.orders || [];
    }, fromIso, toIso);

    await browser.close();
    return rawOrders;

  } catch (err) {
    logger.error(`❌ Lỗi cào dữ liệu đơn hàng Sapo Go: ${err.message}`);
    await browser.close();
    throw err;
  }
}

/**
 * TRÍCH XUẤT SESSION XÁC THỰC MỚI BẰNG PUPPETEER
 */
async function extractMarketplaceSession({ storeAlias, username, password }) {
  const cleanAlias = String(storeAlias)
    .replace('.mysapogo.com', '')
    .replace('.mysapo.net', '')
    .trim();

  logger.info(`🌐 [PUPPETEER] Khởi chạy trình duyệt ẩn danh lấy Sapo Go session (${cleanAlias})...`);

  const browser = await puppeteer.launch({
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-web-security',
      '--disable-dev-shm-usage',
      '--disable-accelerated-2d-canvas',
      '--disable-gpu',
      '--no-first-run',
      '--no-zygote',
      '--single-process'
    ],
  });

  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1400, height: 900 });
    await page.setUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36');

    let authHeaders = null;
    let connectionIds = '';
    let shopMapping = {};

    // Giám sát request ngầm để bắt tokens & connection ids
    page.on('request', request => {
      const url = request.url();
      if (url.includes('market-place.sapoapps.vn/analytics/')) {
        const headers = request.headers();
        if (headers['authorization'] && headers['x-market-token'] && headers['x-market-account-id']) {
          if (!authHeaders) {
            logger.info(`🎯 Đã trích xuất thành công Auth Headers từ Sàn TMĐT!`);
            authHeaders = {
              'authorization': headers['authorization'],
              'x-market-token': headers['x-market-token'],
              'x-market-account-id': headers['x-market-account-id'],
              'accept': 'application/json, text/plain, */*'
            };
            
            try {
              const urlObj = new URL(url);
              connectionIds = urlObj.searchParams.get('ids') || '';
            } catch (_) {}
          }
        }
      }
    });

    const loginUrl = `https://${cleanAlias}.mysapogo.com/admin/orders`;
    logger.info(`📡 Đi tới trang đăng nhập: ${loginUrl}`);
    await page.goto(loginUrl, { waitUntil: 'networkidle2', timeout: 60000 });

    const currentUrl = page.url();
    if (currentUrl.includes('accounts.sapo.vn') || currentUrl.includes('/login')) {
      logger.info('🔑 Tiến hành đăng nhập vào tài khoản Sapo...');
      const userSelector = 'input[name="Username"], input#Username, input#username, input[type="text"]';
      await page.waitForSelector(userSelector, { timeout: 20000 });
      await page.type(userSelector, username, { delay: 50 });

      const passSelector = 'input[name="Password"], input#Password, input#password, input[type="password"]';
      const isPassVisible = await page.evaluate((sel) => {
        const el = document.querySelector(sel);
        return el ? el.getBoundingClientRect().width > 0 : false;
      }, passSelector);

      if (!isPassVisible) {
        await page.click('button[type="submit"], input[type="submit"], button#btnLogin');
        await page.waitForSelector(passSelector, { timeout: 15000 });
      }

      await page.type(passSelector, password, { delay: 50 });
      await Promise.all([
        page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 60000 }),
        page.click('button[type="submit"], input[type="submit"], button#btnLogin')
      ]);
      logger.info('🎉 Đăng nhập thành công!');
    }

    await page.waitForFunction(() => window.location.href.includes('/admin'), { timeout: 20000 });

    // Đi đến trang Sàn TMĐT để kích hoạt các API tự nhiên
    const reportUrl = `https://${cleanAlias}.mysapogo.com/admin/apps/market-place/home/report`;
    logger.info(`📡 Điều hướng tới Dashboard Sàn TMĐT: ${reportUrl}`);
    await page.goto(reportUrl, { waitUntil: 'networkidle2', timeout: 60000 });
    
    // Đợi iframe Sàn TMĐT xuất hiện thay vì dừng cứng 8s
    logger.info('⏳ Đợi iframe Sàn TMĐT tải...');
    const iframeSelector = 'iframe[src*="market-place.sapoapps.vn"]';
    await page.waitForSelector(iframeSelector, { timeout: 30000 });

    // Đợi thông tin kết nối từ Session Storage của iframe
    logger.info('⏳ Chờ thông tin kết nối từ Session Storage của iframe...');
    const frames = page.frames();
    const mpFrame = frames.find(f => f.url().includes('market-place.sapoapps.vn'));
    if (mpFrame) {
      await mpFrame.waitForFunction(() => {
        try {
          const tenant = JSON.parse(sessionStorage.getItem('tenant') || '{}');
          return tenant && tenant.connections && tenant.connections.length > 0;
        } catch (_) {
          return false;
        }
      }, { timeout: 20000 });

      shopMapping = await mpFrame.evaluate(() => {
        try {
          const tenant = JSON.parse(sessionStorage.getItem('tenant') || '{}');
          const connections = tenant.connections || [];
          const mapping = {};
          connections.forEach(c => {
            mapping[c.id] = c.name;
          });
          return mapping;
        } catch (_) {
          return {};
        }
      });
      logger.info(`🏪 Đã đọc được cấu hình kết nối của ${Object.keys(shopMapping).length} shop Shopee.`);
    } else {
      logger.warn('⚠️ Không tìm thấy iframe Sàn TMĐT để lấy shop mapping!');
    }

    // Đợi thêm để đảm bảo request API được kích hoạt và authHeaders đã được passive request listener bắt
    logger.info('⏳ Đợi trích xuất thông tin xác thực từ request...');
    const startWait = Date.now();
    while (!authHeaders && (Date.now() - startWait) < 15000) {
      await new Promise(r => setTimeout(r, 200));
    }

    if (!authHeaders) {
      throw new Error('Không thể trích xuất headers xác thực từ Sàn TMĐT Sapo Go (Timeout 15s)!');
    }

    return {
      authHeaders,
      connectionIds,
      shopMapping
    };

  } finally {
    await browser.close();
    logger.info('🏁 Đã đóng Puppeteer browser.');
  }
}

/**
 * GỌI API SÀN TMĐT TRỰC TIẾP QUA AXIOS
 */
async function fetchMarketplaceReportFromApi({ authHeaders, connectionIds, shopMapping }) {
  // Tính toán thời gian (Ngày hôm qua & Hôm kia theo giờ VN)
  const now = new Date();
  const vnTime = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Ho_Chi_Minh' }));
  
  // Ngày hôm qua (Yesterday)
  const yesterday = new Date(vnTime);
  yesterday.setDate(yesterday.getDate() - 1);
  const yYyyy = yesterday.getFullYear();
  const yMm = String(yesterday.getMonth() + 1).padStart(2, '0');
  const yDd = String(yesterday.getDate()).padStart(2, '0');
  const reportDate = `${yDd}/${yMm}/${yYyyy}`;

  const yesterdayStart = new Date(`${yYyyy}-${yMm}-${yDd}T00:00:00+07:00`);
  const yesterdayEnd = new Date(`${yYyyy}-${yMm}-${yDd}T23:59:59+07:00`);
  const timeFrom = Math.floor(yesterdayStart.getTime() / 1000);
  const timeTo = Math.floor(yesterdayEnd.getTime() / 1000);

  // Ngày hôm kia (Day before yesterday)
  const dayBefore = new Date(yesterday);
  dayBefore.setDate(dayBefore.getDate() - 1);
  const dbYyyy = dayBefore.getFullYear();
  const dbMm = String(dayBefore.getMonth() + 1).padStart(2, '0');
  const dbDd = String(dayBefore.getDate()).padStart(2, '0');
  const dayBeforeStart = new Date(`${dbYyyy}-${dbMm}-${dbDd}T00:00:00+07:00`);
  const dbTimeFrom = Math.floor(dayBeforeStart.getTime() / 1000);

  const baseUrl = 'https://market-place.sapoapps.vn';

  // 1. Phân bổ doanh số theo Shop hôm qua
  const connectionUrl = `${baseUrl}/analytics/orders/connection?ids=${connectionIds}&from=${timeFrom}&to=${timeTo}&statuses=0,1,2,3,4,5,6,7,8,9&zone=Asia/Saigon`;
  const connectionRes = await axios.get(connectionUrl, { headers: authHeaders });

  // 2. Doanh số Ngày hôm qua & Ngày hôm kia (Gross)
  const revenueUrl = `${baseUrl}/analytics/orders/revenue?ids=${connectionIds}&group=day&from=${dbTimeFrom}&to=${timeTo}&statuses=0,1,2,3,4,5,6,7,8,9&zone=Asia/Saigon`;
  const revenueRes = await axios.get(revenueUrl, { headers: authHeaders });

  // 2b. Doanh thu thực nhận Ngày hôm qua & Ngày hôm kia (Net từ API /analytics/revenues)
  const netRevenueUrl = `${baseUrl}/analytics/revenues?ids=${connectionIds}&group=day&from=${dbTimeFrom}&to=${timeTo}&zone=Asia/Saigon`;
  const netRevenueRes = await axios.get(netRevenueUrl, { headers: authHeaders });

  // 3. Số lượng Live tasks (dùng khoảng thời gian 30 ngày để lấy thống kê chuẩn của Sapo)
  const thirtyDaysAgo = Math.floor(Date.now() / 1000) - (30 * 24 * 60 * 60);
  const nowSec = Math.floor(Date.now() / 1000);
  const todayUrl = `${baseUrl}/analytics/orders/today?ids=${connectionIds}&from=${thirtyDaysAgo}&to=${nowSec}&statuses=0,1,2,3,4,5,6,7,8,9&zone=Asia/Saigon`;
  const todayRes = await axios.get(todayUrl, { headers: authHeaders });

  // 4. Top sản phẩm bán chạy ngày hôm qua
  const productsUrl = `${baseUrl}/analytics/products?ids=${connectionIds}&from=${timeFrom}&to=${timeTo}&sortField=revenue&sortType=up&limit=5`;
  const productsRes = await axios.get(productsUrl, { headers: authHeaders });

  // 5. CÀO CHI PHÍ VÀ PHÍ SÀN SHOPEE CHI TIẾT THÔ (Để lấy phân bổ tỷ lệ giữa các shop)
  const activeConnIds = connectionIds.split(',').map(id => id.trim()).filter(Boolean);
  logger.info(`📡 [SAPO GO SCRAPE] Đang cào chi phí chi tiết cho ${activeConnIds.length} gian hàng Shopee từ ngày hôm kia...`);
  
  const dayBeforeDateStr = `${dbDd}/${dbMm}/${dbYyyy}`;

  const feePromises = activeConnIds.map(async (connId) => {
    const feeUrl = `${baseUrl}/analytics/fees/1?ids=${connId}&group=day&from=${dbTimeFrom}&to=${timeTo}&zone=Asia/Saigon`;
    try {
      const res = await axios.get(feeUrl, { headers: authHeaders, timeout: 5000 });
      const feesList = res.data?.fees || [];
      const yesterdayFee = feesList.find(f => f.time === reportDate) || { total: 0, seller_transaction_fee: 0, commission_fee: 0, service_fee: 0 };
      const dayBeforeFee = feesList.find(f => f.time === dayBeforeDateStr) || { total: 0, seller_transaction_fee: 0, commission_fee: 0, service_fee: 0 };
      return {
        connId,
        yesterday: yesterdayFee,
        dayBefore: dayBeforeFee
      };
    } catch (err) {
      logger.error(`❌ [SAPO GO SCRAPE] Lỗi lấy chi phí cho shop #${connId}: ${err.message}`);
      const emptyFee = { total: 0, seller_transaction_fee: 0, commission_fee: 0, service_fee: 0 };
      return {
        connId,
        yesterday: emptyFee,
        dayBefore: emptyFee
      };
    }
  });

  const feeResults = await Promise.all(feePromises);
  const feeMap = {};
  feeResults.forEach(item => {
    feeMap[item.connId] = {
      yesterday: item.yesterday,
      dayBefore: item.dayBefore
    };
  });

  // Trích xuất số liệu doanh thu gốc & thực nhận hôm qua & hôm kia
  const revenuesList = revenueRes.data?.revenues || [];
  const yesterdayRevenueObj = revenuesList.find(r => r.time === reportDate) || { total: 0, quantity: 0, average: 0 };
  const dayBeforeRevenueObj = revenuesList.find(r => r.time === dayBeforeDateStr) || { total: 0, quantity: 0, average: 0 };

  const netRevenuesList = netRevenueRes.data?.revenues || [];
  const yesterdayNetObj = netRevenuesList.find(r => r.time === reportDate) || { total: 0 };
  const dayBeforeNetObj = netRevenuesList.find(r => r.time === dayBeforeDateStr) || { total: 0 };

  const yesterdayGrossRevenue = Number(yesterdayRevenueObj.total || 0);
  const yesterdayNetRevenue = Number(yesterdayNetObj.total || 0);
  const dayBeforeGrossRevenue = Number(dayBeforeRevenueObj.total || 0);
  const dayBeforeNetRevenue = Number(dayBeforeNetObj.total || 0);

  // Tính tổng chi phí sàn quyết toán thực tế cho cả 2 ngày (để phục vụ việc tính toán chênh lệch nếu cần, nhưng không scale vào báo cáo nữa)
  const totalSellerFee = Math.max(0, yesterdayGrossRevenue - yesterdayNetRevenue);

  // Tính tỷ lệ nhân (scale factor) từ chi phí thô Sapo trả về sang chi phí thực nhận đã đối soát
  const rawTotalFee = feeResults.reduce((acc, item) => acc + Number(item.yesterday.total || 0), 0);
  const scaleFactor = 1; // Khóa scale factor = 1 để lấy đúng số liệu thô khớp 100% Sapo Go Dashboard cho đơn phát sinh hôm qua
  const expectedNetRevenue = yesterdayGrossRevenue - rawTotalFee;

  const dayBeforeRawTotalFee = feeResults.reduce((acc, item) => acc + Number(item.dayBefore.total || 0), 0);
  const dayBeforeExpectedNet = dayBeforeGrossRevenue - dayBeforeRawTotalFee;

  // Phân bổ tỷ lệ chi phí đã đối soát
  const totalTransactionFee = Math.round(feeResults.reduce((acc, item) => acc + Number(item.yesterday.seller_transaction_fee || 0), 0) * scaleFactor);
  const totalCommissionFee = Math.round(feeResults.reduce((acc, item) => acc + Number(item.yesterday.commission_fee || 0), 0) * scaleFactor);
  const totalServiceFee = Math.round(feeResults.reduce((acc, item) => acc + Number(item.yesterday.service_fee || 0), 0) * scaleFactor);

  // Format breakdown cửa hàng Shopee
  const shopeeShopBreakdown = {};
  const breakdownList = connectionRes.data || [];
  
  // Danh sách shop đã khai tử cần loại bỏ
  const excludedShopsStr = process.env.EXCLUDED_SHOPS || 'MAYcolor,MayFe.vn';
  const excludedShops = excludedShopsStr.split(',').map(s => s.trim().toLowerCase());

  // Đảm bảo tất cả các shop kết nối đều hiển thị (kể cả có 0 doanh thu), ngoại trừ các shop đã khai tử
  Object.entries(shopMapping).forEach(([id, name]) => {
    if (excludedShops.includes(name.trim().toLowerCase())) {
      return; // Bỏ qua shop đã bị khai tử
    }
    const shopFees = feeMap[id] || { yesterday: { total: 0, seller_transaction_fee: 0, commission_fee: 0, service_fee: 0 } };
    const shopYesterdayFee = shopFees.yesterday;
    const scaledShopFee = Math.round(Number(shopYesterdayFee.total || 0) * scaleFactor);
    shopeeShopBreakdown[name] = {
      revenue: 0,
      orders: 0,
      cancelledCount: 0,
      fees: {
        total: scaledShopFee,
        transaction: Math.round(Number(shopYesterdayFee.seller_transaction_fee || 0) * scaleFactor),
        commission: Math.round(Number(shopYesterdayFee.commission_fee || 0) * scaleFactor),
        service: Math.round(Number(shopYesterdayFee.service_fee || 0) * scaleFactor)
      },
      netRevenue: 0 - scaledShopFee
    };
  });

  breakdownList.forEach(b => {
    const name = shopMapping[b.connection_id] || `Shopee Shop #${b.connection_id}`;
    if (excludedShops.includes(name.trim().toLowerCase())) {
      return; // Bỏ qua shop đã bị khai tử
    }
    const shopFees = feeMap[b.connection_id] || { yesterday: { total: 0, seller_transaction_fee: 0, commission_fee: 0, service_fee: 0 } };
    const shopYesterdayFee = shopFees.yesterday;
    const scaledShopFee = Math.round(Number(shopYesterdayFee.total || 0) * scaleFactor);
    shopeeShopBreakdown[name] = {
      revenue: Number(b.current_total || 0),
      orders: Number(b.quantity || 0),
      cancelledCount: 0,
      fees: {
        total: scaledShopFee,
        transaction: Math.round(Number(shopYesterdayFee.seller_transaction_fee || 0) * scaleFactor),
        commission: Math.round(Number(shopYesterdayFee.commission_fee || 0) * scaleFactor),
        service: Math.round(Number(shopYesterdayFee.service_fee || 0) * scaleFactor)
      },
      netRevenue: Number(b.current_total || 0) - scaledShopFee
    };
  });

  // Format top sản phẩm
  const rawProducts = productsRes.data?.products || [];
  const topProducts = rawProducts.map(p => ({
    name: p.variation_name || 'Sản phẩm không tên',
    qty: Number(p.quantity || 0),
    revenue: Number(p.revenue || 0)
  }));

  // Live Tasks từ Sapo Go Marketplace
  const liveTasks = todayRes.data || { pending: 0, packed: 0, shipping: 0, in_cancelled: 0 };

  return {
    reportDate,
    totalRevenue: yesterdayGrossRevenue,
    totalOrders: Number(yesterdayRevenueObj.quantity || 0),
    totalProducts: topProducts.reduce((acc, p) => acc + p.qty, 0),
    avgPerOrder: Math.round(yesterdayRevenueObj.average || 0),
    cancelledCount: Number(liveTasks.in_cancelled || 0),
    cancelledRate: 0,
    pendingFulfillmentCount: Number(liveTasks.pending || 0),
    pendingConfirmationCount: Number(liveTasks.packed || 0),
    shippingCount: Number(liveTasks.shipping || 0),
    totalDiscount: 0,
    totalShippingFee: 0,
    // Báo cáo chi phí toàn cục
    fees: {
      total: rawTotalFee,
      transaction: totalTransactionFee,
      commission: totalCommissionFee,
      service: totalServiceFee
    },
    netRevenue: yesterdayNetRevenue,
    expectedNetRevenue: expectedNetRevenue,
    feeRate: yesterdayGrossRevenue > 0 ? Math.round((rawTotalFee / yesterdayGrossRevenue) * 1000) / 10 : 0,
    shopeeShopBreakdown,
    topProducts,
    dayBeforeRevenue: dayBeforeGrossRevenue,
    dayBeforeNetRevenue: dayBeforeNetRevenue,
    dayBeforeExpectedNet: dayBeforeExpectedNet,
    processedAt: new Date().toISOString()
  };
}

/**
 * CÀO BÁO CÁO SHOPEE THỰC TẾ TỪ ỨNG DỤNG SÀN TMĐT SAPO GO (BẢN TỐI ƯU CÓ CACHING)
 */
async function getMarketplaceReport({ storeAlias, username, password }) {
  const cleanAlias = String(storeAlias)
    .replace('.mysapogo.com', '')
    .replace('.mysapo.net', '')
    .trim();

  logger.info(`🔍 [SAPO GO SCRAPE] Bắt đầu lấy báo cáo cho store: ${cleanAlias}`);

  // 1. Thử lấy session từ DB
  let session = db.getSapoGoSession(cleanAlias);
  if (session) {
    logger.info(`💾 [SAPO GO SCRAPE] Tìm thấy session cached trong DB. Thử gọi API trực tiếp...`);
    try {
      const report = await fetchMarketplaceReportFromApi({
        authHeaders: session.authHeaders,
        connectionIds: session.connectionIds,
        shopMapping: session.shopMapping
      });
      logger.info(`⚡ [SAPO GO SCRAPE] Lấy báo cáo thành công qua API cached (không dùng Puppeteer).`);
      return report;
    } catch (err) {
      const isAuthError = err.response && (err.response.status === 401 || err.response.status === 403);
      if (isAuthError) {
        logger.warn(`⚠️ [SAPO GO SCRAPE] Session cached hết hạn (Mã lỗi ${err.response.status}). Tiến hành khởi chạy Puppeteer để lấy session mới...`);
      } else {
        logger.error(`❌ [SAPO GO SCRAPE] Gọi API lỗi hệ thống (Mã lỗi ${err.response?.status || 'unknown'}): ${err.message}`);
        throw err;
      }
    }
  } else {
    logger.info(`🔍 [SAPO GO SCRAPE] Không có session cached trong DB. Tiến hành khởi chạy Puppeteer...`);
  }

  // 2. Khởi chạy Puppeteer lấy session mới
  try {
    const newSession = await extractMarketplaceSession({ storeAlias, username, password });
    
    // Lưu vào SQLite
    db.saveSapoGoSession(cleanAlias, newSession);

    // Gọi API lấy dữ liệu báo cáo
    logger.info(`📡 Gọi API với session mới vừa cào...`);
    const report = await fetchMarketplaceReportFromApi({
      authHeaders: newSession.authHeaders,
      connectionIds: newSession.connectionIds,
      shopMapping: newSession.shopMapping
    });
    return report;
  } catch (err) {
    logger.error(`❌ [SAPO GO SCRAPE] Thất bại khi cào hoặc gọi API sau khi refresh: ${err.message}`);
    throw err;
  }
}

module.exports = {
  getOrdersFromSapoGo,
  getMarketplaceReport
};
