/**
 * Lark (Feishu) API Service
 * Gửi Message Card báo cáo doanh thu lên nhóm Lark
 */
const axios = require('axios');
const logger = require('../utils/logger');
const sapo = require('./sapo');

const LARK_BASE_URL = 'https://open.larksuite.com/open-apis';
// Nếu dùng Feishu (nội địa TQ): https://open.feishu.cn/open-apis

let _tenantToken = null;
let _tokenExpireAt = 0;

// ─────────────────────────────────────────────
// AUTHENTICATION
// ─────────────────────────────────────────────

/**
 * Lấy tenant_access_token của Lark App
 * Token này sống 2 tiếng, cần lấy mới khi hết hạn
 */
async function getTenantAccessToken() {
  const now = Math.floor(Date.now() / 1000);

  // Dùng cache nếu còn hạn (buffer 5 phút)
  if (_tenantToken && _tokenExpireAt - now > 300) {
    return _tenantToken;
  }

  const response = await axios.post(
    `${LARK_BASE_URL}/auth/v3/tenant_access_token/internal`,
    {
      app_id: process.env.LARK_APP_ID,
      app_secret: process.env.LARK_APP_SECRET,
    },
    { timeout: 10000 },
  );

  const { tenant_access_token, expire, code, msg } = response.data;

  if (code !== 0) {
    throw new Error(`Lark auth lỗi: code=${code}, msg=${msg}`);
  }

  _tenantToken = tenant_access_token;
  _tokenExpireAt = now + (expire || 7200);

  logger.info('🦅 Lark tenant token đã được làm mới.');
  return _tenantToken;
}

// ─────────────────────────────────────────────
// SEND MESSAGE
// ─────────────────────────────────────────────

/**
 * Gửi Message Card lên nhóm Lark
 * Dùng im/v1/messages API
 */
async function sendReportCard(reportData) {
  if (process.env.LARK_WEBHOOK_URL) {
    return sendWebhookMessage({
      msg_type: 'interactive',
      content: buildMessageCard(reportData),
    });
  }

  if (!process.env.LARK_CHAT_ID) {
    logger.info('LARK_CHAT_ID chua cau hinh. Bo qua gui message card.');
    return null;
  }

  const token = await getTenantAccessToken();
  const chatId = process.env.LARK_CHAT_ID;

  const card = buildMessageCard(reportData);

  const payload = {
    receive_id: chatId,
    msg_type: 'interactive',
    content: JSON.stringify(card),
  };

  logger.info(`📤 Đang gửi báo cáo lên Lark chat: ${chatId}...`);

  const response = await axios.post(
    `${LARK_BASE_URL}/im/v1/messages?receive_id_type=chat_id`,
    payload,
    {
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      timeout: 15000,
    },
  );

  const { code, msg } = response.data;
  if (code !== 0) {
    throw new Error(`Lark send message lỗi: code=${code}, msg=${msg}`);
  }

  logger.info('✅ Báo cáo đã gửi lên Lark thành công!');
  return response.data;
}

/**
 * Gửi tin nhắn văn bản đơn giản (dùng để alert lỗi)
 */
async function sendTextAlert(text) {
  try {
    if (process.env.LARK_WEBHOOK_URL) {
      return sendWebhookMessage({
        msg_type: 'text',
        content: { text },
      });
    }

    if (!process.env.LARK_CHAT_ID) {
      logger.info('LARK_CHAT_ID chua cau hinh. Bo qua gui alert.');
      return null;
    }

    const token = await getTenantAccessToken();
    const chatId = process.env.LARK_CHAT_ID;

    await axios.post(
      `${LARK_BASE_URL}/im/v1/messages?receive_id_type=chat_id`,
      {
        receive_id: chatId,
        msg_type: 'text',
        content: JSON.stringify({ text }),
      },
      {
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        timeout: 10000,
      },
    );
    logger.info('🔔 Alert đã gửi lên Lark.');
  } catch (err) {
    logger.error('❌ Không gửi được alert Lark: ' + err.message);
  }
}

async function sendWebhookMessage(payload) {
  const response = await axios.post(process.env.LARK_WEBHOOK_URL, payload, {
    headers: { 'Content-Type': 'application/json' },
    timeout: 15000,
  });

  if (response.data?.code && response.data.code !== 0) {
    throw new Error(
      `Lark webhook loi: code=${response.data.code}, msg=${response.data.msg}`,
    );
  }

  logger.info('Lark webhook message da gui thanh cong.');
  return response.data;
}

/**
 * Liet ke cac chat ma bot/app co quyen truy cap.
 * Dung de lay LARK_CHAT_ID sau khi da them bot vao nhom.
 */
async function listChats({ pageSize = 20, pageToken } = {}) {
  const token = await getTenantAccessToken();

  const response = await axios.get(`${LARK_BASE_URL}/im/v1/chats`, {
    params: {
      page_size: pageSize,
      page_token: pageToken,
    },
    headers: {
      Authorization: `Bearer ${token}`,
    },
    timeout: 15000,
  });

  assertLarkOk(response.data, 'Lark list chats');
  return response.data.data || {};
}

// ─────────────────────────────────────────────
// LARK BASE / BITABLE
// ─────────────────────────────────────────────

function isBaseEnabled() {
  return Boolean(
    process.env.LARK_BASE_APP_TOKEN && process.env.LARK_BASE_TABLE_ID,
  );
}

async function createBitableRecord(fields) {
  assertBaseConfigured();

  const token = await getTenantAccessToken();
  const { appToken, tableId } = getBaseConfig();

  const response = await axios.post(
    `${LARK_BASE_URL}/bitable/v1/apps/${appToken}/tables/${tableId}/records`,
    { fields },
    {
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      timeout: 15000,
    },
  );

  assertLarkOk(response.data, 'Lark Base create record');
  return response.data;
}

async function updateBitableRecord(recordId, fields) {
  assertBaseConfigured();

  const token = await getTenantAccessToken();
  const { appToken, tableId } = getBaseConfig();

  const response = await axios.put(
    `${LARK_BASE_URL}/bitable/v1/apps/${appToken}/tables/${tableId}/records/${recordId}`,
    { fields },
    {
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      timeout: 15000,
    },
  );

  assertLarkOk(response.data, 'Lark Base update record');
  return response.data;
}

async function searchBitableRecordByField(fieldName, value) {
  assertBaseConfigured();

  const token = await getTenantAccessToken();
  const { appToken, tableId } = getBaseConfig();

  const response = await axios.post(
    `${LARK_BASE_URL}/bitable/v1/apps/${appToken}/tables/${tableId}/records/search`,
    {
      page_size: 1,
      filter: {
        conjunction: 'and',
        conditions: [
          {
            field_name: fieldName,
            operator: 'is',
            value: [String(value)],
          },
        ],
      },
    },
    {
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      timeout: 15000,
    },
  );

  assertLarkOk(response.data, 'Lark Base search record');
  return response.data.data?.items?.[0] || null;
}

async function upsertOrderToBase(order) {
  if (!isBaseEnabled()) {
    logger.info('Lark Base chua cau hinh. Chi luu don hang vao SQLite.');
    return null;
  }

  const uniqueField = process.env.LARK_ORDER_UNIQUE_FIELD || 'Ma don';
  const fields = buildOrderBaseFields(order, uniqueField);
  const existing = await searchBitableRecordByField(
    uniqueField,
    order.externalOrderId,
  );

  if (existing?.record_id) {
    logger.info(`Cap nhat don ${order.externalOrderId} tren Lark Base.`);
    return updateBitableRecord(existing.record_id, fields);
  }

  logger.info(`Tao moi don ${order.externalOrderId} tren Lark Base.`);
  return createBitableRecord(fields);
}

function buildOrderBaseFields(order, uniqueField) {
  const productSummary = (order.items || [])
    .map((item) => `${item.name} x${item.quantity || 0}`)
    .join('\n');
  const imageUrls = order.imageUrls || safeJsonParse(order.image_urls, []);

  return {
    [uniqueField]: String(order.externalOrderId),
    [process.env.LARK_FIELD_SOURCE || 'Nguon']: order.source || 'nhanh',
    [process.env.LARK_FIELD_PLATFORM || 'San']: order.platform || 'shopee',
    [process.env.LARK_FIELD_STATUS || 'Trang thai']: order.status || '',
    [process.env.LARK_FIELD_REVENUE || 'Doanh thu']: Number(order.revenue || 0),
    [process.env.LARK_FIELD_DISCOUNT || 'Giam gia']: Number(
      order.discount || 0,
    ),
    [process.env.LARK_FIELD_SHIPPING || 'Phi van chuyen']: Number(
      order.shippingFee || 0,
    ),
    [process.env.LARK_FIELD_CUSTOMER || 'Khach hang']: order.customerName || '',
    [process.env.LARK_FIELD_PRODUCTS || 'San pham']: productSummary,
    [process.env.LARK_FIELD_IMAGES || 'Anh thiet ke']: imageUrls.join('\n'),
    [process.env.LARK_FIELD_CREATED_AT || 'Ngay tao']: order.createdAt || '',
    [process.env.LARK_FIELD_UPDATED_AT || 'Cap nhat luc']:
      order.updatedAt || new Date().toISOString(),
  };
}

function safeJsonParse(value, fallback) {
  try {
    return value ? JSON.parse(value) : fallback;
  } catch (_) {
    return fallback;
  }
}

function getBaseConfig() {
  return {
    appToken: process.env.LARK_BASE_APP_TOKEN,
    tableId: process.env.LARK_BASE_TABLE_ID,
  };
}

function assertBaseConfigured() {
  if (!isBaseEnabled()) {
    throw new Error('Thieu LARK_BASE_APP_TOKEN hoac LARK_BASE_TABLE_ID.');
  }
}

function assertLarkOk(data, action) {
  if (data.code !== 0) {
    throw new Error(`${action} loi: code=${data.code}, msg=${data.msg}`);
  }
}

// ─────────────────────────────────────────────
// CARD BUILDER
// ─────────────────────────────────────────────

/**
 * Xây dựng Lark Interactive Message Card
 * Tham khảo: https://open.larksuite.com/document/uAjLw4CM/ukzMukzMukzM/feishu-cards/card-components
 */
function buildMessageCard(data) {
  const {
    reportDate,
    totalRevenue,
    totalOrders,
    totalProducts,
    avgPerOrder,
    cancelledCount,
    cancelledRate = 0,
    pendingFulfillmentCount = 0,
    pendingConfirmationCount = 0,
    totalDiscount = 0,
    totalShippingFee = 0,
    shopeeShopBreakdown = {},
    aiAnalysis,
    growthPercent,
    shopName,
    topProducts = [],
  } = data;

  // Màu header theo tăng/giảm doanh thu
  const headerColor = growthPercent >= 0 ? 'green' : 'red';
  const growthIcon = growthPercent >= 0 ? '📈' : '📉';
  const growthText =
    growthPercent != null
      ? `${growthIcon} ${Math.abs(growthPercent).toFixed(1)}% so với kỳ trước`
      : '📊 Không có dữ liệu so sánh';

  // Format số tiền VNĐ
  const fmtVND = (n) => new Intl.NumberFormat('vi-VN').format(n) + ' VNĐ';

  // 🏪 Bảng phân chia theo cửa hàng Shopee
  let breakdownMarkdown = '';
  const breakdownKeys = Object.keys(shopeeShopBreakdown || {});
  if (breakdownKeys.length > 0) {
    breakdownMarkdown =
      `### 🏪 DOANH THU THEO CỬA HÀNG\n` +
      `| Cửa hàng | Đơn hàng | Hủy | Doanh số |\n` +
      `| :--- | :---: | :---: | :--- |\n` +
      Object.entries(shopeeShopBreakdown)
        .map(
          ([name, stats]) =>
            `| **${name}** | ${stats.orders} đơn | ${stats.cancelledCount} | **${fmtVND(stats.revenue)}** |`,
        )
        .join('\n');
  }

  // 💸 Chi phí & Khấu trừ Shopee (Discounts & Shipping Fees)
  const totalOriginal = totalRevenue + totalDiscount;
  const deductionsMarkdown =
    `### 💸 CHI TIẾT KHẤU TRỪ & CHI PHÍ\n` +
    `- **Doanh số gốc (chưa trừ KM):** ${fmtVND(totalOriginal)}\n` +
    `- **Số tiền giảm giá (Khuyến mãi shop):** \`-${fmtVND(totalDiscount)}\`\n` +
    `- **Phí vận chuyển phát sinh:** \`${fmtVND(totalShippingFee)}\`\n` +
    `- **Doanh số thực nhận (sau khi trừ KM):** **${fmtVND(totalRevenue)}**`;

  // Card theo chuẩn Lark Card DSL
  const card = {
    schema: '2.0',
    config: {
      wide_screen_mode: true,
      enable_forward: true,
    },
    header: {
      title: {
        tag: 'plain_text',
        content: `📊 BÁO CÁO DOANH THU SHOPEE DAILY`,
      },
      subtitle: {
        tag: 'plain_text',
        content: shopName ? `🏪 ${shopName}` : '🏪 Cửa hàng của bạn',
      },
      template: headerColor,
    },
    body: {
      direction: 'vertical',
      elements: [
        // Ngày báo cáo
        {
          tag: 'div',
          text: {
            tag: 'lark_md',
            content: `**📅 Ngày báo cáo:** ${reportDate}  (Dữ liệu ngày hôm qua)`,
          },
        },
        { tag: 'hr' },

        // Số liệu chính - layout 3 cột (Đơn hàng | Sản phẩm | Doanh số)
        {
          tag: 'column_set',
          flex_mode: 'stretch',
          background_style: 'grey',
          columns: [
            {
              tag: 'column',
              width: 'weighted',
              weight: 1.2,
              elements: [
                {
                  tag: 'div',
                  text: {
                    tag: 'lark_md',
                    content: `**📦 ĐƠN HÀNG**\n**${totalOrders}** đơn`,
                  },
                },
              ],
            },
            {
              tag: 'column',
              width: 'weighted',
              weight: 1.2,
              elements: [
                {
                  tag: 'div',
                  text: {
                    tag: 'lark_md',
                    content: `**🛍️ SẢN PHẨM**\n**${totalProducts || totalOrders}** cái`,
                  },
                },
              ],
            },
            {
              tag: 'column',
              width: 'weighted',
              weight: 1.4,
              elements: [
                {
                  tag: 'div',
                  text: {
                    tag: 'lark_md',
                    content: `**💰 DOANH SỐ**\n**${fmtVND(totalRevenue)}**`,
                  },
                },
              ],
            },
          ],
        },

        // Số liệu phụ & Tăng trưởng - layout 2 cột
        {
          tag: 'column_set',
          flex_mode: 'stretch',
          columns: [
            {
              tag: 'column',
              width: 'weighted',
              weight: 1,
              elements: [
                {
                  tag: 'div',
                  text: {
                    tag: 'lark_md',
                    content: `**Đơn hủy:** **${cancelledCount}** đơn (Tỷ lệ: **${cancelledRate}%**)\n**TB/Đơn hàng:** **${fmtVND(avgPerOrder)}**`,
                  },
                },
              ],
            },
            {
              tag: 'column',
              width: 'weighted',
              weight: 1,
              elements: [
                {
                  tag: 'div',
                  text: {
                    tag: 'lark_md',
                    content: `**Tăng trưởng:** ${growthText}`,
                  },
                },
              ],
            },
          ],
        },

        // Bảng phân chia theo cửa hàng Shopee
        ...(breakdownMarkdown
          ? [
              { tag: 'hr' },
              {
                tag: 'div',
                text: {
                  tag: 'lark_md',
                  content: breakdownMarkdown,
                },
              },
            ]
          : []),

        { tag: 'hr' },

        // CÔNG VIỆC CẦN XỬ LÝ (Mô phỏng Widget Sapo)
        {
          tag: 'div',
          text: {
            tag: 'lark_md',
            content: `### 💼 CÔNG VIỆC CẦN XỬ LÝ (Sapo Synced)`,
          },
        },
        {
          tag: 'column_set',
          flex_mode: 'stretch',
          background_style: 'grey',
          columns: [
            {
              tag: 'column',
              width: 'weighted',
              weight: 1,
              elements: [
                {
                  tag: 'div',
                  text: {
                    tag: 'lark_md',
                    content: `📥 **Chờ xác nhận:** **${pendingConfirmationCount}** đơn\n❌ **Yêu cầu hủy đơn:** **0** đơn\n🔗 **Đơn hàng liên kết lỗi:** **0** đơn`,
                  },
                },
              ],
            },
            {
              tag: 'column',
              width: 'weighted',
              weight: 1,
              elements: [
                {
                  tag: 'div',
                  text: {
                    tag: 'lark_md',
                    content: `📦 **Chờ xử lý:** **${pendingFulfillmentCount}** đơn\n↩️ **Yêu cầu hoàn trả:** **0** đơn\n⚠️ **Sản phẩm đồng bộ lỗi:** **0** đơn`,
                  },
                },
              ],
            },
          ],
        },

        // Chi phí & Khấu trừ Shopee (Discounts & Shipping Fees)
        ...(deductionsMarkdown
          ? [
              { tag: 'hr' },
              {
                tag: 'div',
                text: {
                  tag: 'lark_md',
                  content: deductionsMarkdown,
                },
              },
            ]
          : []),

        { tag: 'hr' },

        // Top sản phẩm (nếu có)
        ...(topProducts.length > 0
          ? [
              {
                tag: 'div',
                text: {
                  tag: 'lark_md',
                  content: `**🏆 Top sản phẩm bán chạy:**\n${topProducts
                    .slice(0, 5)
                    .map((p, i) => `${i + 1}. ${p.name} — **${p.qty} cái**`)
                    .join('\n')}`,
                },
              },
              { tag: 'hr' },
            ]
          : []),

        // AI Analysis
        ...(aiAnalysis
          ? [
              {
                tag: 'div',
                text: {
                  tag: 'lark_md',
                  content: `**💡 Phân tích AI:**\n${aiAnalysis}`,
                },
              },
              { tag: 'hr' },
            ]
          : []),

        // Nút hành động (Schema 2.0)
        {
          tag: 'column_set',
          flex_mode: 'stretch',
          columns: [
            {
              tag: 'column',
              width: 'weighted',
              weight: 1,
              elements: [
                {
                  tag: 'button',
                  text: { tag: 'plain_text', content: '🔗 Xem Sapo Dashboard' },
                  type: 'primary',
                  url: `${sapo.getStoreDomain()}/admin/orders`,
                },
              ],
            },
            {
              tag: 'column',
              width: 'weighted',
              weight: 1,
              elements: [
                {
                  tag: 'button',
                  text: { tag: 'plain_text', content: '✅ Đã xem' },
                  type: 'default',
                  value: { action: 'acknowledged' },
                },
              ],
            },
          ],
        },

        // Footer
        {
          tag: 'div',
          text: {
            tag: 'lark_md',
            content: `*🤖 Báo cáo tự động lúc ${new Date().toLocaleTimeString('vi-VN')} — Shopee Sapo Stateless Bot*`,
          },
        },
      ],
    },
  };

  return card;
}

module.exports = {
  getTenantAccessToken,
  sendReportCard,
  sendTextAlert,
  sendWebhookMessage,
  listChats,
  buildMessageCard,
  isBaseEnabled,
  createBitableRecord,
  updateBitableRecord,
  searchBitableRecordByField,
  upsertOrderToBase,
};
