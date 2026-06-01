const axios = require('axios');
const logger = require('../../utils/logger');
const auth = require('./auth');
const bitable = require('./bitable');

const LARK_BASE_URL = 'https://open.larksuite.com/open-apis';

// Fields thống nhất cho bảng gộp duy nhất "BÁO CÁO HÀNG NGÀY"
const UnifiedFields = [
  // --- SAPO FIELDS ---
  { field_name: 'Tên chi nhánh', type: 1 },
  { field_name: 'Tên nhân viên', type: 1 },
  bitable.buildVndField('Tiền hàng'),
  bitable.buildVndField('Tiền hàng trả lại'),
  bitable.buildVndField('Tiền thuế'),
  bitable.buildVndField('Phí giao hàng'),
  bitable.buildVndField('Doanh thu'),
  bitable.buildVndField('Lợi nhuận gộp'),
  
  // --- SHARED FIELDS ---
  { field_name: 'SL đơn hàng', type: 2, property: { formatter: '0' } },
  
  // --- SHOPEE FIELDS ---
  { field_name: 'Shop', type: 1 },
  { field_name: 'Tên sản phẩm', type: 1 }, // Ngay sau Shop
  bitable.buildVndField('Gross Sales'),
  bitable.buildVndField('Doanh thu thực nhận'),
  bitable.buildVndField('Tổng phí sàn'),
  bitable.buildVndField('Phí thanh toán'),
  bitable.buildVndField('Phí cố định'),
  bitable.buildVndField('Phí dịch vụ'),
  { field_name: 'Đơn bị hủy', type: 2, property: { formatter: '0' } },
  { field_name: 'Chờ đóng gói', type: 2, property: { formatter: '0' } },
  { field_name: 'Chờ lấy hàng', type: 2, property: { formatter: '0' } },
  { field_name: 'Đang vận chuyển', type: 2, property: { formatter: '0' } },
];

async function syncFinancialReportToLarkBase(reportData) {
  const token = await auth.getTenantAccessToken();
  const dateStr = reportData.reportDate || '';
  const appToken = process.env.LARK_BASE_APP_TOKEN || 'JJ4cbywbXalFOOsK4iCj2bvNpAd';

  // 1. Tạo/Tìm bảng gộp duy nhất "BÁO CÁO HÀNG NGÀY"
  const tableName = 'BÁO CÁO HÀNG NGÀY';
  logger.info(`🔍 Đang tìm/tạo bảng thống nhất "${tableName}" trong Lark Bitable...`);
  const { tableId } = await bitable.getOrCreateTable(appToken, tableName, token);

  await bitable.renamePrimaryField(appToken, tableId, 'Ngày', token);
  await bitable.ensureTableFields(appToken, tableId, UnifiedFields, token);
  await bitable.ensureTableViews(appToken, tableId, ['TỔNG', 'Tổng quan'], token);

  // 2. Lấy danh sách Fields & Views thực tế để lấy ID
  const fieldsRes = await bitable.axiosWithRetry({
    method: 'get',
    url: `${LARK_BASE_URL}/bitable/v1/apps/${appToken}/tables/${tableId}/fields`,
    headers: { Authorization: `Bearer ${token}` }
  });
  const fields = fieldsRes.data?.data?.items || [];
  const fieldsMapByName = new Map(fields.map(f => [f.field_name, f]));

  const viewsRes = await bitable.axiosWithRetry({
    method: 'get',
    url: `${LARK_BASE_URL}/bitable/v1/apps/${appToken}/tables/${tableId}/views`,
    headers: { Authorization: `Bearer ${token}` }
  });
  const views = viewsRes.data?.data?.items || [];
  const viewTong = views.find(v => v.view_name === 'TỔNG');
  const viewTongQuan = views.find(v => v.view_name === 'Tổng quan');

  // Cấu hình View TỔNG:
  // - Ẩn tất cả cột Shopee
  // - Lọc: Tên chi nhánh isNotEmpty
  if (viewTong) {
    logger.info('⚙️ Cấu hình ẩn cột và bộ lọc cho View: "TỔNG"...');
    const shopeeColNames = ['Shop', 'Tên sản phẩm', 'Gross Sales', 'Doanh thu thực nhận', 'Tổng phí sàn', 'Phí thanh toán', 'Phí cố định', 'Phí dịch vụ', 'Đơn bị hủy', 'Chờ đóng gói', 'Chờ lấy hàng', 'Đang vận chuyển'];
    const hiddenFieldIds = shopeeColNames.map(name => fieldsMapByName.get(name)?.field_id).filter(Boolean);
    
    // Ẩn các cột hệ thống (type >= 1001)
    fields.filter(f => f.type >= 1001).forEach(f => hiddenFieldIds.push(f.field_id));
    
    const filterFieldId = fieldsMapByName.get('Tên chi nhánh')?.field_id;
    
    const payload = {
      property: {
        hidden_fields: hiddenFieldIds,
        filter_info: {
          conjunction: 'and',
          conditions: [
            {
              field_id: filterFieldId,
              operator: 'isNotEmpty'
            }
          ]
        }
      }
    };
    
    await bitable.axiosWithRetry({
      method: 'patch',
      url: `${LARK_BASE_URL}/bitable/v1/apps/${appToken}/tables/${tableId}/views/${viewTong.view_id}`,
      data: payload,
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }
    });
  }

  // Cấu hình View Tổng quan:
  // - Ẩn tất cả cột Sapo
  // - Lọc: Shop isNotEmpty
  if (viewTongQuan) {
    logger.info('⚙️ Cấu hình ẩn cột và bộ lọc cho View: "Tổng quan"...');
    const sapoColNames = ['Tên chi nhánh', 'Tên nhân viên', 'Tiền hàng', 'Tiền hàng trả lại', 'Tiền thuế', 'Phí giao hàng', 'Doanh thu', 'Lợi nhuận gộp'];
    const hiddenFieldIds = sapoColNames.map(name => fieldsMapByName.get(name)?.field_id).filter(Boolean);
    
    // Ẩn các cột hệ thống (type >= 1001)
    fields.filter(f => f.type >= 1001).forEach(f => hiddenFieldIds.push(f.field_id));
    
    const filterFieldId = fieldsMapByName.get('Shop')?.field_id;
    
    const payload = {
      property: {
        hidden_fields: hiddenFieldIds,
        filter_info: {
          conjunction: 'and',
          conditions: [
            {
              field_id: filterFieldId,
              operator: 'isNotEmpty'
            }
          ]
        }
      }
    };
    
    await bitable.axiosWithRetry({
      method: 'patch',
      url: `${LARK_BASE_URL}/bitable/v1/apps/${appToken}/tables/${tableId}/views/${viewTongQuan.view_id}`,
      data: payload,
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }
    });
  }

  // 3. Quét sạch các bản ghi cũ của ngày này trên bảng thống nhất BÁO CÁO HÀNG NGÀY
  await bitable.clearTableRecordsForDate(appToken, tableId, dateStr, token, 'Ngày');

  // 4. Lấy dữ liệu Sapo POS
  let sapoSales = [];
  try {
    const sapoGoScraper = require('../sapoGoScraper');
    const sapoHelper = require('../sapo');
    const { storeAlias } = sapoHelper.getSapoConfig();
    const rows = await sapoGoScraper.getBusinessActivitiesReport({
      storeAlias,
      username: process.env.SAPO_GO_USERNAME,
      password: process.env.SAPO_GO_PASSWORD,
      targetDate: dateStr
    });
    sapoSales = rows.map(r => ({
      channel: r.pos_location_name || 'Kho LUXI Phạm Huy Thông',
      employee: r.staff_name || 'Không rõ',
      orders: Number(r.orders || 0),
      goodsValue: Number(r.gross_sales || 0),
      returnedValue: Number(r.returns || 0),
      taxes: Number(r.taxes || 0),
      shipping: Number(r.shipping || 0),
      revenue: Number(r.total_sales || 0),
      grossProfit: Number(r.gross_profit || 0)
    })).filter(item => item.orders > 0 || item.goodsValue > 0 || item.revenue > 0);

    logger.info(`📊 Lấy thành công ${sapoSales.length} dòng báo cáo hoạt động kinh doanh Sapo.`);
  } catch (err) {
    logger.warn(`⚠️ Sapo Go Scraper report query failed: ${err.message}`);
  }

  // 5. Lấy dữ liệu Shopee shop
  let shopeeShopBreakdown = reportData.shopeeShopBreakdown;
  let topProducts = reportData.topProducts;
  if (!shopeeShopBreakdown) {
    try {
      logger.info(`🔍 Đang tự động cào dữ liệu Shopee Marketplace cho ngày ${dateStr}...`);
      const sapoGoScraper = require('../sapoGoScraper');
      const marketplaceReport = await sapoGoScraper.getMarketplaceReport({
        storeAlias: process.env.SAPO_STORE_ALIAS,
        username: process.env.SAPO_GO_USERNAME,
        password: process.env.SAPO_GO_PASSWORD,
        targetDate: dateStr
      });
      shopeeShopBreakdown = marketplaceReport?.shopeeShopBreakdown;
      topProducts = marketplaceReport?.topProducts;
    } catch (err) {
      logger.warn(`⚠️ Lỗi tự động cào dữ liệu Shopee Marketplace (bỏ qua): ${err.message}`);
    }
  }

  // 6. Gộp toàn bộ bản ghi Sapo & Shopee vào chung một mảng
  const recordsToInsert = [];

  // Thêm bản ghi Sapo POS
  sapoSales.forEach(item => {
    recordsToInsert.push({
      fields: {
        'Ngày': dateStr,
        'Tên chi nhánh': item.channel,
        'Tên nhân viên': item.employee,
        'SL đơn hàng': Number(item.orders || 0),
        'Tiền hàng': Number(item.goodsValue || 0),
        'Tiền hàng trả lại': Number(item.returnedValue || 0),
        'Tiền thuế': Number(item.taxes || 0),
        'Phí giao hàng': Number(item.shipping || 0),
        'Doanh thu': Number(item.revenue || 0),
        'Lợi nhuận gộp': Number(item.grossProfit || 0)
      }
    });
  });

  // Thêm bản ghi Shopee shop
  if (shopeeShopBreakdown) {
    for (const [shopName, shopData] of Object.entries(shopeeShopBreakdown)) {
      let shopProductsSummary = '';
      if (topProducts && topProducts.length > 0) {
        const shopProds = topProducts
          .filter(p => p.shopName === shopName && Number(p.qty || 0) > 0)
          .sort((a, b) => b.qty - a.qty);
        
        if (shopProds.length > 0) {
          shopProductsSummary = shopProds
            .map((p, idx) => `${idx + 1}. ${p.name} (Bán: ${p.qty} | Doanh số: ${new Intl.NumberFormat('vi-VN').format(p.revenue)}đ | Hủy: ${p.cancelledQty || 0})`)
            .join('\n');
        }
      }

      recordsToInsert.push({
        fields: {
          'Ngày': dateStr,
          'Shop': shopName,
          'Tên sản phẩm': shopProductsSummary,
          'SL đơn hàng': Number(shopData.orders || 0),
          'Gross Sales': Number(shopData.revenue || 0),
          'Doanh thu thực nhận': Number(shopData.netRevenueActual || 0),
          'Tổng phí sàn': Number(shopData.fees?.total || 0),
          'Phí thanh toán': Number(shopData.fees?.transaction || 0),
          'Phí cố định': Number(shopData.fees?.commission || 0),
          'Phí dịch vụ': Number(shopData.fees?.service || 0),
          'Đơn bị hủy': Number(shopData.cancelledCount || 0),
          'Chờ đóng gói': Number(shopData.pendingFulfillment || 0),
          'Chờ lấy hàng': Number(shopData.pendingConfirmation || 0),
          'Đang vận chuyển': Number(shopData.shippingCount || 0)
        }
      });
    }
  }

  // 7. Ghi hàng loạt tất cả bản ghi vào bảng duy nhất BÁO CÁO HÀNG NGÀY
  if (recordsToInsert.length > 0) {
    logger.info(`📤 Đang ghi hàng loạt ${recordsToInsert.length} bản ghi gộp Sapo & Shopee vào "${tableName}"...`);
    const insertRes = await bitable.axiosWithRetry({
      method: 'post',
      url: `${LARK_BASE_URL}/bitable/v1/apps/${appToken}/tables/${tableId}/records/batch_create`,
      data: { records: recordsToInsert },
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }
    });
    if (insertRes.data.code !== 0) {
      throw new Error(`Lỗi ghi dữ liệu gộp vào Lark Base: ${insertRes.data.msg}`);
    }
  }

  logger.info(`✅ Đồng bộ dữ liệu thành công vào bảng duy nhất với 2 Tab View độc lập!`);
}

module.exports = {
  syncFinancialReportToLarkBase,
};
