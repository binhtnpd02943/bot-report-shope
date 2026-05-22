/**
 * Report Calculator
 * Tính toán số liệu doanh thu từ danh sách đơn hàng Shopee
 */
const logger = require('../utils/logger');

// Trạng thái đơn hàng được tính vào doanh thu
const PAID_STATUSES = [
  'COMPLETED',        // Đã hoàn thành
  'SHIPPED',          // Đang giao (đã thanh toán)
  'TO_SHIP',          // Chờ giao (đã thanh toán)
  'IN_CANCEL',        // Đang hủy (đã thu tiền)
  'TO_CONFIRM_RECEIVE', // Chờ xác nhận nhận hàng
];

// Trạng thái loại trừ khỏi doanh thu
const EXCLUDED_STATUSES = [
  'CANCELLED',        // Đã hủy
  'UNPAID',           // Chưa thanh toán
];

/**
 * Tính toán doanh thu từ mảng đơn hàng chi tiết
 * @param {Array} orders - Mảng đơn hàng từ Shopee API get_order_detail
 * @returns {Object} Báo cáo tổng hợp
 */
function calculateRevenue(orders) {
  logger.info(`📊 Bắt đầu tính toán doanh thu từ ${orders.length} đơn hàng...`);

  let totalRevenue  = 0;
  let totalOrders   = 0;
  let cancelledCount = 0;
  let unpaidCount   = 0;

  // Map đếm sản phẩm bán chạy: { itemName -> qty }
  const productSalesMap = new Map();

  for (const order of orders) {
    const status = order.order_status;

    // Bỏ qua đơn hủy và chưa thanh toán
    if (EXCLUDED_STATUSES.includes(status)) {
      if (status === 'CANCELLED') cancelledCount++;
      if (status === 'UNPAID')    unpaidCount++;
      continue;
    }

    // Chỉ đếm đơn đã thanh toán / đang xử lý
    if (PAID_STATUSES.includes(status)) {
      // total_amount hoặc final_amount (ưu tiên total_amount)
      const amount = parseFloat(order.total_amount || order.final_amount || 0);
      totalRevenue += amount;
      totalOrders++;

      // Thống kê sản phẩm
      const items = order.item_list || order.package_list?.[0]?.item_list || [];
      for (const item of items) {
        const name    = item.item_name || item.product_name || 'Sản phẩm không tên';
        const qty     = item.model_quantity_purchased || item.quantity || 1;
        const current = productSalesMap.get(name) || 0;
        productSalesMap.set(name, current + qty);
      }
    }
  }

  // Sắp xếp top sản phẩm bán chạy
  const topProducts = Array.from(productSalesMap.entries())
    .sort((a, b) => b[1] - a[1])
    .map(([name, qty]) => ({ name, qty }));

  const avgPerOrder = totalOrders > 0
    ? Math.round(totalRevenue / totalOrders)
    : 0;

  const result = {
    totalRevenue:    Math.round(totalRevenue),
    totalOrders,
    avgPerOrder,
    cancelledCount,
    unpaidCount,
    topProducts,
    processedAt: new Date().toISOString(),
  };

  logger.info(`✅ Tính toán hoàn tất:
    - Doanh thu: ${new Intl.NumberFormat('vi-VN').format(result.totalRevenue)} VNĐ
    - Tổng đơn hợp lệ: ${totalOrders}
    - Đơn hủy: ${cancelledCount}
    - Chưa TT: ${unpaidCount}
    - TB/đơn: ${new Intl.NumberFormat('vi-VN').format(avgPerOrder)} VNĐ`);

  return result;
}

/**
 * Tinh doanh thu tu don hang da luu trong SQLite (webhook mode).
 */
function calculateRevenueFromStoredOrders(orders, items = []) {
  logger.info(`📊 Bắt đầu tính toán doanh thu từ ${orders.length} đơn webhook...`);

  let totalRevenue = 0;
  let totalOrders = 0;
  let cancelledCount = 0;
  let unpaidCount = 0;
  const productSalesMap = new Map();

  for (const order of orders) {
    const status = String(order.status || '').toLowerCase();
    if (isCancelledStatus(status)) {
      cancelledCount++;
      continue;
    }
    if (status.includes('unpaid') || status.includes('chua thanh toan')) {
      unpaidCount++;
      continue;
    }

    totalRevenue += Number(order.revenue || 0);
    totalOrders++;
  }

  for (const item of items) {
    const name = item.name || 'San pham khong ten';
    const qty = Number(item.quantity || 0);
    productSalesMap.set(name, (productSalesMap.get(name) || 0) + qty);
  }

  const topProducts = Array.from(productSalesMap.entries())
    .sort((a, b) => b[1] - a[1])
    .map(([name, qty]) => ({ name, qty }));

  const avgPerOrder = totalOrders > 0 ? Math.round(totalRevenue / totalOrders) : 0;

  return {
    totalRevenue: Math.round(totalRevenue),
    totalOrders,
    avgPerOrder,
    cancelledCount,
    unpaidCount,
    topProducts,
    processedAt: new Date().toISOString(),
  };
}

function isCancelledStatus(status) {
  return status.includes('cancel')
    || status.includes('huy')
    || status.includes('hủy')
    || status.includes('hoan')
    || status.includes('hoàn');
}

/**
 * Tính phần trăm tăng trưởng so với kỳ trước
 */
function calcGrowthPercent(current, previous) {
  if (!previous || previous === 0) return null;
  return ((current - previous) / previous) * 100;
}

/**
 * Tạo khung thời gian cho ngày hôm qua (múi giờ VN UTC+7)
 * Trả về Unix timestamp: { timeFrom, timeTo, reportDate }
 */
function getYesterdayTimeRange() {
  const now = new Date();

  // Ngày hôm qua theo giờ Việt Nam
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);

  const yyyy = yesterday.getFullYear();
  const mm   = String(yesterday.getMonth() + 1).padStart(2, '0');
  const dd   = String(yesterday.getDate()).padStart(2, '0');
  const reportDate = `${dd}/${mm}/${yyyy}`;

  // 00:00:00 VN = UTC-7 = previous day 17:00:00 UTC
  // Dùng local time server (đảm bảo server set TZ=Asia/Ho_Chi_Minh)
  const startOfDay = new Date(`${yyyy}-${mm}-${dd}T00:00:00+07:00`);
  const endOfDay   = new Date(`${yyyy}-${mm}-${dd}T23:59:59+07:00`);

  return {
    timeFrom:   Math.floor(startOfDay.getTime() / 1000),
    timeTo:     Math.floor(endOfDay.getTime() / 1000),
    reportDate,
  };
}

/**
 * Tính doanh thu từ danh sách đơn hàng đã được chuẩn hóa từ Sapo API (có chứa items lồng bên trong).
 */
function calculateRevenueFromSapoApi(orders) {
  logger.info(`📊 Bắt đầu tính toán doanh thu từ ${orders.length} đơn hàng Sapo...`);

  let totalRevenue = 0;
  let totalOrders = 0;
  let totalProducts = 0;
  let cancelledCount = 0;
  let pendingFulfillmentCount = 0;
  let pendingConfirmationCount = 0;
  let totalDiscount = 0;
  let totalShippingFee = 0;

  const productSalesMap = new Map();
  const shopeeShopBreakdown = {};

  for (const order of orders) {
    const sapoStatus = String(order.sapoStatus || '').toLowerCase();
    const financialStatus = String(order.financialStatus || '').toLowerCase();
    const fulfillmentStatus = order.fulfillmentStatus === null ? null : String(order.fulfillmentStatus).toLowerCase();
    const shopName = order.shopeeShopName || 'Shopee Shop';

    if (!shopeeShopBreakdown[shopName]) {
      shopeeShopBreakdown[shopName] = {
        revenue: 0,
        orders: 0,
        cancelledCount: 0,
      };
    }

    // Check cancelled status
    if (sapoStatus === 'cancelled' || financialStatus === 'voided') {
      cancelledCount++;
      shopeeShopBreakdown[shopName].cancelledCount++;
      continue;
    }

    // Nếu không bị hủy, tính vào đơn hàng hợp lệ
    totalOrders++;
    totalRevenue += Number(order.revenue || 0);
    totalDiscount += Number(order.discount || 0);
    totalShippingFee += Number(order.shippingFee || 0);

    shopeeShopBreakdown[shopName].revenue += Number(order.revenue || 0);
    shopeeShopBreakdown[shopName].orders++;

    // Tính sản phẩm
    const items = order.items || [];
    for (const item of items) {
      const name = item.name || 'Sản phẩm không tên';
      const qty = Number(item.quantity || 1);
      totalProducts += qty;
      productSalesMap.set(name, (productSalesMap.get(name) || 0) + qty);
    }

    // Chờ xử lý (Pending Fulfillment): Chưa giao hàng (fulfillmentStatus là null hoặc unfulfilled)
    if (fulfillmentStatus === null || fulfillmentStatus === 'unfulfilled') {
      pendingFulfillmentCount++;
    }

    // Chờ xác nhận (Pending Confirmation): Chưa thanh toán hoặc chờ duyệt (financialStatus là pending hoặc unpaid)
    if (financialStatus === 'pending' || financialStatus === 'unpaid') {
      pendingConfirmationCount++;
    }
  }

  const topProducts = Array.from(productSalesMap.entries())
    .sort((a, b) => b[1] - a[1])
    .map(([name, qty]) => ({ name, qty }));

  const avgPerOrder = totalOrders > 0 ? Math.round(totalRevenue / totalOrders) : 0;
  
  // Tính tỷ lệ hủy đơn
  const totalCreated = totalOrders + cancelledCount;
  const cancelledRate = totalCreated > 0 ? Number(((cancelledCount / totalCreated) * 100).toFixed(1)) : 0;

  return {
    totalRevenue: Math.round(totalRevenue),
    totalOrders,
    totalProducts,
    avgPerOrder,
    cancelledCount,
    cancelledRate,
    pendingFulfillmentCount,
    pendingConfirmationCount,
    totalDiscount: Math.round(totalDiscount),
    totalShippingFee: Math.round(totalShippingFee),
    shopeeShopBreakdown,
    topProducts,
    processedAt: new Date().toISOString(),
  };
}

/**
 * Tạo khung thời gian cho ngày hôm qua và ngày hôm kia (múi giờ VN UTC+7)
 * Trả về Unix timestamp cho cả 2 ngày
 */
function getTwoDaysTimeRanges() {
  const now = new Date();
  const vnTime = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Ho_Chi_Minh' }));
  
  // Ngày hôm qua
  const yesterday = new Date(vnTime);
  yesterday.setDate(yesterday.getDate() - 1);
  const yYyyy = yesterday.getFullYear();
  const yMm   = String(yesterday.getMonth() + 1).padStart(2, '0');
  const yDd   = String(yesterday.getDate()).padStart(2, '0');
  const yesterdayDateStr = `${yDd}/${yMm}/${yYyyy}`;
  
  const yesterdayStart = new Date(`${yYyyy}-${yMm}-${yDd}T00:00:00+07:00`);
  const yesterdayEnd   = new Date(`${yYyyy}-${yMm}-${yDd}T23:59:59+07:00`);

  // Ngày hôm kia (Day before yesterday)
  const dayBefore = new Date(vnTime);
  dayBefore.setDate(dayBefore.getDate() - 2);
  const dYyyy = dayBefore.getFullYear();
  const dMm   = String(dayBefore.getMonth() + 1).padStart(2, '0');
  const dDd   = String(dayBefore.getDate()).padStart(2, '0');
  const dayBeforeDateStr = `${dDd}/${dMm}/${dYyyy}`;

  const dayBeforeStart = new Date(`${dYyyy}-${dMm}-${dDd}T00:00:00+07:00`);
  const dayBeforeEnd   = new Date(`${dYyyy}-${dMm}-${dDd}T23:59:59+07:00`);

  return {
    yesterday: {
      timeFrom: Math.floor(yesterdayStart.getTime() / 1000),
      timeTo: Math.floor(yesterdayEnd.getTime() / 1000),
      reportDate: yesterdayDateStr,
    },
    dayBefore: {
      timeFrom: Math.floor(dayBeforeStart.getTime() / 1000),
      timeTo: Math.floor(dayBeforeEnd.getTime() / 1000),
      reportDate: dayBeforeDateStr,
    }
  };
}

module.exports = {
  calculateRevenue,
  calculateRevenueFromStoredOrders,
  calculateRevenueFromSapoApi,
  calcGrowthPercent,
  getYesterdayTimeRange,
  getTwoDaysTimeRanges,
  PAID_STATUSES,
};
