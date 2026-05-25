/**
 * Lark (Feishu) API Service
 * Gửi Message Card báo cáo doanh thu lên nhóm Lark
 */
const axios = require('axios');
const logger = require('../utils/logger');
const sapo = require('./sapo');

const LARK_BASE_URL = 'https://open.larksuite.com/open-apis';

async function axiosWithRetry(config, retries = 3, delay = 1500) {
  try {
    return await axios(config);
  } catch (err) {
    const isTimeout =
      err.code === 'ECONNABORTED' ||
      err.message.includes('timeout') ||
      err.message.includes('exceeded');
    const isRateLimit =
      err.response &&
      (err.response.status === 429 || err.response.status === 500);

    if (retries > 0 && (isTimeout || isRateLimit)) {
      logger.warn(
        `⚠️ Axios request failed: ${err.message}. Retrying in ${delay}ms... (${retries} attempts left)`,
      );
      await new Promise((r) => setTimeout(r, delay));
      return await axiosWithRetry(config, retries - 1, delay * 2);
    }
    throw err;
  }
}

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

function buildVndField(fieldName) {
  return {
    field_name: fieldName,
    type: 2,
    ui_type: 'Currency',
    property: {
      currency_code: 'VND',
      formatter: '0',
    },
  };
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
    // Phí sàn và Doanh thu thực nhận toàn cục
    fees = { total: 0, transaction: 0, commission: 0, service: 0 },
    netRevenue = 0,
    expectedNetRevenue = 0,
    feeRate = 0,
    shopeeShopBreakdown = {},
    aiAnalysis,
    growthPercent,
    actualNetGrowthPercent,
    expectedNetGrowthPercent,
    shopName,
    topProducts = [],
  } = data;

  // Định dạng hiển thị Tăng trưởng
  const fmtGrowth = (val) => {
    if (val === null || val === undefined) return '📊 Không có dữ liệu';
    const icon = val >= 0 ? '📈' : '📉';
    return `${icon} ${val >= 0 ? 'Tăng' : 'Giảm'} ${Math.abs(val).toFixed(1)}%`;
  };

  const actualGrowthText = fmtGrowth(
    actualNetGrowthPercent !== undefined
      ? actualNetGrowthPercent
      : growthPercent,
  );
  const expectedGrowthText = fmtGrowth(expectedNetGrowthPercent);

  // Màu header theo tăng/giảm dòng tiền thực tế đã về ví
  const headerColor =
    (actualNetGrowthPercent !== undefined
      ? actualNetGrowthPercent
      : growthPercent) >= 0
      ? 'green'
      : 'red';

  // Format số tiền VNĐ
  const fmtVND = (n) => new Intl.NumberFormat('vi-VN').format(n) + ' VNĐ';
  const fmtVNDShort = (n) => new Intl.NumberFormat('vi-VN').format(n);
  const configuredProductCardLimit = Number(
    process.env.LARK_PRODUCT_CARD_LIMIT || 15,
  );
  const productCardLimit = Number.isFinite(configuredProductCardLimit)
    ? Math.min(Math.max(Math.round(configuredProductCardLimit), 1), 50)
    : 15;

  // 🏪 Bảng phân chia theo cửa hàng Shopee (Thiết kế dạng bảng P&L rút gọn)
  let breakdownMarkdown = '';
  const breakdownKeys = Object.keys(shopeeShopBreakdown || {});
  if (breakdownKeys.length > 0) {
    breakdownMarkdown =
      `### 🏪 PHÂN BỔ THEO CỬA HÀNG *(Đơn vị: VNĐ)*\n` +
      `| Cửa hàng | Đơn | Doanh số | Phí sàn | Thực nhận |\n` +
      `| :--- | :---: | :--- | :--- | :--- |\n` +
      Object.entries(shopeeShopBreakdown)
        .map(([name, stats]) => {
          const shopFee = stats.fees || { total: 0 };
          const netRev =
            stats.netRevenue != null
              ? stats.netRevenue
              : stats.revenue - shopFee.total;
          return `| **${name}** | ${stats.orders} | ${fmtVNDShort(stats.revenue)} | -${fmtVNDShort(shopFee.total)} | **${fmtVNDShort(netRev)}** |`;
        })
        .join('\n');
  }

  // 💸 Chi phí & Khấu trừ Shopee chi tiết (Discounts & Shipping Fees)
  const totalOriginal = totalRevenue + totalDiscount;
  const deductionsMarkdown =
    `### 💸 CHI TIẾT KHẤU TRỪ & CHI PHÍ SÀN\n` +
    `- **Doanh số gốc (Gross Sales):** ${fmtVND(totalOriginal)}\n` +
    `- **Chi phí sàn Shopee:** \`-${fmtVND(fees.total)}\` (Chiếm **${feeRate}%** doanh số)\n` +
    `  * *💳 Phí thanh toán:* -${fmtVND(fees.transaction)}\n` +
    `  * *📌 Phí cố định:* -${fmtVND(fees.commission)}\n` +
    `  * *🛍️ Phí dịch vụ (Voucher/Freeship):* -${fmtVND(fees.service)}\n` +
    `- **Khuyến mãi shop (nếu có):** \`-${fmtVND(totalDiscount)}\`\n` +
    `- **DOANH THU THỰC NHẬN DỰ KIẾN (Net dự kiến):** **${fmtVND(expectedNetRevenue)}**\n` +
    `  * *(Bằng Gross trừ đi Chi phí sàn Shopee ước tính của các đơn phát sinh hôm qua)*\n` +
    `- **DOANH THU THỰC NHẬN ĐÃ VỀ VÍ (Net thực tế):** **${fmtVND(netRevenue)}**\n` +
    `  * *(Dòng tiền mặt sạch thực tế Shopee đã đối soát & trả về ví thành công hôm qua)*`;

  // Card theo chuẩn Lark Card DSL
  const card = {
    schema: '2.0',
    config: {
      wide_screen_mode: true,
      enable_forward: true,
      width_mode: 'sparse',
    },
    header: {
      title: {
        tag: 'plain_text',
        content: `📊 BÁO CÁO TÀI CHÍNH SHOPEE DAILY`,
      },
      subtitle: {
        tag: 'plain_text',
        content: shopName ? `🏪 ${shopName}` : '🏪 Hệ Thống Cửa Hàng LUXI',
      },
      template: headerColor,
    },
    body: {
      direction: 'vertical',
      elements: [
        // Ngày báo cáo & Doanh thu thực nhận nổi bật nhất (Cả 2 loại để sếp phân biệt)
        {
          tag: 'div',
          text: {
            tag: 'lark_md',
            content:
              `**📅 Ngày báo cáo:** ${reportDate} (Dữ liệu ngày hôm qua)\n\n` +
              `💰 **NET THỰC NHẬN ĐÃ VỀ VÍ (Dòng tiền thực tế):** **${fmtVND(netRevenue)}**\n` +
              `* *Tăng trưởng dòng tiền:* **${actualGrowthText}** (so với kỳ trước: ${fmtVNDShort(data.dayBeforeNetRevenue || 0)}đ)\n` +
              `* *Ý nghĩa:* Tiền mặt sạch đã chuyển về ví Shopee ngày hôm qua, sẵn sàng rút về ngân hàng để chạy Ads hoặc nhập hàng ngay lập tức.\n\n` +
              `⏱️ **NET THỰC NHẬN DỰ KIẾN (Bán hàng hôm qua):** **${fmtVND(expectedNetRevenue)}**\n` +
              `* *Tăng trưởng hiệu suất:* **${expectedGrowthText}** (so với kỳ trước: ${fmtVNDShort(data.dayBeforeExpectedNet || 0)}đ)\n` +
              `* *Ý nghĩa:* Số tiền ước tính sẽ thu về sau này từ các đơn mới phát sinh hôm qua (Gross hôm qua trừ Phí sàn thô hôm qua). Hiện tại tiền chưa về ví vì đơn đang đi đường.`,
          },
        },
        { tag: 'hr' },

        // Số liệu chính - layout 3 cột (Đơn hàng | Doanh số Gross | Phí sàn Shopee)
        {
          tag: 'column_set',
          flex_mode: 'stretch',
          background_style: 'grey',
          columns: [
            {
              tag: 'column',
              width: 'weighted',
              weight: 1.1,
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
              weight: 1.4,
              elements: [
                {
                  tag: 'div',
                  text: {
                    tag: 'lark_md',
                    content: `**💰 TỔNG DOANH SỐ (Gross)**\n**${fmtVND(totalRevenue)}**`,
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
                    content: `**💸 PHÍ SÀN (${feeRate}%)**\n**-${fmtVND(fees.total)}**`,
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
                    content: `📈 **Tăng dòng tiền:** ${actualGrowthText}\n⏱️ **Tăng hiệu suất:** ${expectedGrowthText}`,
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

        // GIẢI THÍCH CHI TIẾT BẢN CHẤT DÒNG TIỀN CHO LEADER (Để tránh hiểu sai)
        { tag: 'hr' },
        {
          tag: 'div',
          text: {
            tag: 'lark_md',
            content:
              `💡 **GIẢI THÍCH CHI TIẾT BẢN CHẤT DÒNG TIỀN (Tránh hiểu sai):**\n` +
              `- **Net Dự Kiến (${fmtVNDShort(expectedNetRevenue)} VNĐ):** Trả lời câu hỏi *"Hôm qua bán được bao nhiêu đơn và sau này thu về khoảng bao nhiêu tiền?"*. Số tiền này **đang đi đường**, chưa chuyển vào ví vì khách hàng chưa nhận được hàng thành công.\n` +
              `- **Net Đã Về Ví (${fmtVNDShort(netRevenue)} VNĐ):** Trả lời câu hỏi *"Dòng tiền mặt thực tế về ví hôm qua là bao nhiêu để nhập hàng, chạy Ads?"*. Đây là dòng tiền sạch thực tế Shopee đã chuyển vào ví, tương ứng với **các đơn hàng cũ từ nhiều ngày trước (khoảng 15-20/05)** nay vừa hoàn thành đối soát.\n` +
              `- **Hiện tượng lệch đơn (LUMY WOOD):** Ví dụ shop LUMY WOOD ghi nhận 11 đơn giải ngân nhưng Sapo chỉ ghi nhận 9 đơn mới đặt ngày hôm qua. Sự lệch này do lệch ngày đặt hàng và ngày hoàn thành đối soát tự nhiên của sàn Shopee, hoàn toàn bình thường và an toàn.`,
          },
        },

        { tag: 'hr' },

        // Top sản phẩm (nếu có)
        ...(topProducts.length > 0
          ? [
              {
                tag: 'div',
                text: {
                  tag: 'lark_md',
                  content: `**🏆 Top sản phẩm bán chạy (${Math.min(topProducts.length, productCardLimit)}/${topProducts.length}):**\n${topProducts
                    .slice(0, productCardLimit)
                    .map((p, i) => {
                      const productRevenue =
                        p.revenue !== undefined
                          ? ` | ${fmtVND(p.revenue)}`
                          : '';
                      const productShop = p.shopName ? ` | ${p.shopName}` : '';
                      return `${i + 1}. ${p.name} — **${p.qty} cái**${productRevenue}${productShop}`;
                    })
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
            content: `*🤖 Báo cáo tự động lúc ${new Date().toLocaleTimeString('vi-VN')} — Shopee Sapo Financial Bot*`,
          },
        },
      ],
    },
  };

  return card;
}

// ─────────────────────────────────────────────
// LARK BASE FINANCIAL REPORTS SYNCING
// ─────────────────────────────────────────────

const UnifiedFields = [
  // Primary Keys & Metadata
  { field_name: 'Shop', type: 1 },
  { field_name: 'Ten_San_Pham', type: 1 },
  // Tab 1: Tổng Quan Fields
  { field_name: 'So_Don_Hang', type: 2, property: { formatter: "0" } },
  buildVndField('Gross_Sales'),
  buildVndField('Net_Thuc_Nhan_Vi'),
  buildVndField('Net_Du_Kien'),
  buildVndField('Tong_Chi_Phi_San'),
  buildVndField('AOV'),
  // Tab 2: Đơn Hàng Fields
  { field_name: 'Don_Bi_Huy', type: 2, property: { formatter: "0" } },
  { field_name: 'Cho_Dong_Goi', type: 2, property: { formatter: "0" } },
  { field_name: 'Cho_Lay_Hang', type: 2, property: { formatter: "0" } },
  { field_name: 'Dang_Van_Chuyen', type: 2, property: { formatter: "0" } },
  // Tab 3: Sản Phẩm Fields
  { field_name: 'Phien_Ban', type: 1 },
  { field_name: 'Ma_SKU', type: 1 },
  { field_name: 'Gian_Hang', type: 1 },
  { field_name: 'So_Luong_Da_Ban', type: 2, property: { formatter: "0" } },
  buildVndField('Doanh_Thu_SP'),
  { field_name: 'Don_Hang_Ban', type: 2, property: { formatter: "0" } },
  { field_name: 'So_Luong_Huy_SP', type: 2, property: { formatter: "0" } },
  { field_name: 'So_Luong_Don_Huy', type: 2, property: { formatter: "0" } },
  { field_name: 'Ty_Le_Huy_SP', type: 2, property: { formatter: "0.00%" } },
  // Tab 4: Doanh Thu Fields
  buildVndField('Khuyen_Mai_Shop'),
  // Tab 5: Chi Phí Fields
  buildVndField('Phi_Thanh_Toan'),
  buildVndField('Phi_Co_Dinh'),
  buildVndField('Phi_Dich_Vu'),
  buildVndField('Phi_Van_Chuyen'),
  buildVndField('Chi_Phi_Da_Tra'),
  buildVndField('Chi_Phi_Chua_Tra'),
];



async function getOrCreateTable(appToken, tableName, token) {
  const listRes = await axios.get(
    `${LARK_BASE_URL}/bitable/v1/apps/${appToken}/tables`,
    { headers: { Authorization: `Bearer ${token}` } },
  );

  if (listRes.data.code !== 0) {
    throw new Error(`Loi lay danh sach table: ${listRes.data.msg}`);
  }

  const tables = listRes.data.data.items || [];
  const foundTable = tables.find((t) => t.name === tableName);
  if (foundTable) {
    return { tableId: foundTable.table_id, isNewTable: false };
  }

  logger.info(
    `🏗️  Đang tự động khởi tạo sheet/bảng: "${tableName}" trong Bitable...`,
  );
  const createRes = await axios.post(
    `${LARK_BASE_URL}/bitable/v1/apps/${appToken}/tables`,
    {
      table: {
        name: tableName,
        default_generation: true,
      },
    },
    {
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
    },
  );

  if (createRes.data.code !== 0) {
    throw new Error(`Loi tao table ${tableName}: ${createRes.data.msg}`);
  }

  return { tableId: createRes.data.data.table_id, isNewTable: true };
}



async function ensureTableFields(appToken, tableId, schemaFields, token) {
  const fieldsRes = await axiosWithRetry({
    method: 'get',
    url: `${LARK_BASE_URL}/bitable/v1/apps/${appToken}/tables/${tableId}/fields`,
    headers: { Authorization: `Bearer ${token}` }
  });

  if (fieldsRes.data.code !== 0) {
    throw new Error(
      `Loi lay danh sach field cho table ${tableId}: ${fieldsRes.data.msg}`,
    );
  }

  const fields = fieldsRes.data.data.items || [];
  const existingFieldsByName = new Map(fields.map((f) => [f.field_name, f]));

  for (const field of schemaFields) {
    const existingField = existingFieldsByName.get(field.field_name);
    if (!existingField) {
      logger.info(
        `➕  Đang tạo trường "${field.field_name}" (type: ${field.type}) cho bảng ${tableId}...`,
      );
      const payload = {
        field_name: field.field_name,
        type: field.type,
      };
      if (field.ui_type) {
        payload.ui_type = field.ui_type;
      }
      if (field.property) {
        payload.property = field.property;
      }

      const createFieldRes = await axiosWithRetry({
        method: 'post',
        url: `${LARK_BASE_URL}/bitable/v1/apps/${appToken}/tables/${tableId}/fields`,
        data: payload,
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        }
      });

      if (createFieldRes.data.code !== 0) {
        logger.error(
          `❌ Loi tao field ${field.field_name}: ${createFieldRes.data.msg}`,
        );
      }
    } else if (field.ui_type || field.property) {
      const payload = {
        field_name: field.field_name,
        type: field.type,
      };
      if (field.ui_type) {
        payload.ui_type = field.ui_type;
      }
      if (field.property) {
        payload.property = field.property;
      }

      const updateFieldRes = await axiosWithRetry({
        method: 'put',
        url: `${LARK_BASE_URL}/bitable/v1/apps/${appToken}/tables/${tableId}/fields/${existingField.field_id}`,
        data: payload,
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        }
      });

      if (
        updateFieldRes.data.code !== 0 &&
        updateFieldRes.data.msg !== 'DataNotChange'
      ) {
        logger.error(
          `❌ Loi cap nhat field ${field.field_name}: ${updateFieldRes.data.msg}`,
        );
      }
    }
  }
}

async function ensureTableViews(appToken, tableId, viewNames, token) {
  try {
    const listRes = await axiosWithRetry({
      method: 'get',
      url: `${LARK_BASE_URL}/bitable/v1/apps/${appToken}/tables/${tableId}/views`,
      headers: { Authorization: `Bearer ${token}` }
    });

    if (listRes.data.code !== 0) {
      throw new Error(`Loi lay danh sach view: ${listRes.data.msg}`);
    }

    const views = listRes.data.data.items || [];
    const existingViewNames = new Set(views.map((v) => v.view_name));

    for (const name of viewNames) {
      if (!existingViewNames.has(name)) {
        logger.info(`🏗️  Đang tạo view "${name}" cho bảng ${tableId}...`);
        await axiosWithRetry({
          method: 'post',
          url: `${LARK_BASE_URL}/bitable/v1/apps/${appToken}/tables/${tableId}/views`,
          data: {
            view_name: name,
            view_type: 'grid',
          },
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          }
        });
      }
    }

    const latestListRes = await axiosWithRetry({
      method: 'get',
      url: `${LARK_BASE_URL}/bitable/v1/apps/${appToken}/tables/${tableId}/views`,
      headers: { Authorization: `Bearer ${token}` }
    });
    const latestViews = latestListRes.data?.data?.items || [];
    const keepViewNames = new Set(viewNames);

    // Xóa các tab cũ không còn dùng & view mặc định hệ thống
    const OBSOLETE_VIEWS = new Set(['Đơn hàng', 'Doanh thu', 'Chi phí']);
    for (const v of latestViews) {
      const isSystemDefault =
        v.view_name.includes('表格视图') ||
        v.view_name.includes('Grid View') ||
        v.view_name === '表格';
      const isObsolete = OBSOLETE_VIEWS.has(v.view_name);
      if ((isSystemDefault || isObsolete) && latestViews.length > 1) {
        logger.info(`🧹  Đang xóa tab cũ/mặc định "${v.view_name}"...`);
        try {
          await axiosWithRetry({
            method: 'delete',
            url: `${LARK_BASE_URL}/bitable/v1/apps/${appToken}/tables/${tableId}/views/${v.view_id}`,
            headers: { Authorization: `Bearer ${token}` }
          });
        } catch (delErr) {
          logger.warn(`⚠️ Không xóa được tab "${v.view_name}": ${delErr.message}`);
        }
      }
    }
  } catch (err) {
    logger.error(
      `⚠️ Lỗi dọn dẹp/tạo views cho bảng ${tableId}: ${err.message}`,
    );
  }
}

async function configureTableViews(appToken, tableId, token) {
  try {
    const fieldsRes = await axiosWithRetry({
      method: 'get',
      url: `${LARK_BASE_URL}/bitable/v1/apps/${appToken}/tables/${tableId}/fields`,
      headers: { Authorization: `Bearer ${token}` }
    });
    const fieldsItems = fieldsRes.data?.data?.items || [];
    const fieldMap = {};
    let primaryFieldId = '';
    fieldsItems.forEach((f) => {
      fieldMap[f.field_name] = f.field_id;
      if (f.is_primary) {
        primaryFieldId = f.field_id;
      }
    });
    if (!primaryFieldId && fieldsItems.length > 0) {
      primaryFieldId = fieldsItems[0].field_id;
    }

    const viewsRes = await axiosWithRetry({
      method: 'get',
      url: `${LARK_BASE_URL}/bitable/v1/apps/${appToken}/tables/${tableId}/views`,
      headers: { Authorization: `Bearer ${token}` }
    });
    const views = viewsRes.data?.data?.items || [];

    const viewConfigs = {
      // ═══════════════════════════════════════════════════════
      // TAB 1: TỔNG QUAN
      // Gộp toàn bộ: Định danh → Đơn hàng/Vận hành → Doanh thu → Chi phí
      // Lọc theo Shop (ẩn row sản phẩm, chỉ hiện row shop/tổng hệ thống)
      // ═══════════════════════════════════════════════════════
      'Tổng quan': {
        show: [
          // [1] Định danh
          'Ngày báo cáo',
          'Shop',
          // [2] Đơn hàng & Vận hành
          'So_Don_Hang',
          'Don_Bi_Huy',
          'Cho_Dong_Goi',
          'Cho_Lay_Hang',
          'Dang_Van_Chuyen',
          // [3] Doanh thu
          'Gross_Sales',
          'Khuyen_Mai_Shop',
          'Net_Du_Kien',
          'Net_Thuc_Nhan_Vi',
          'AOV',
          // [4] Chi phí
          'Tong_Chi_Phi_San',
          'Phi_Thanh_Toan',
          'Phi_Co_Dinh',
          'Phi_Dich_Vu',
          'Phi_Van_Chuyen',
          'Chi_Phi_Da_Tra',
          'Chi_Phi_Chua_Tra',
        ],
        filterField: 'Shop',
      },
      // ═══════════════════════════════════════════════════════
      // TAB 2: SẢN PHẨM
      // Hiệu suất từng sản phẩm/SKU: Định danh → Hiệu suất → Hủy
      // Lọc theo Tên sản phẩm (chỉ hiện row sản phẩm)
      // ═══════════════════════════════════════════════════════
      'Sản phẩm': {
        show: [
          // [1] Định danh
          'Ngày báo cáo',
          'Ten_San_Pham',
          'Phien_Ban',
          'Ma_SKU',
          'Gian_Hang',
          // [2] Hiệu suất bán hàng
          'So_Luong_Da_Ban',
          'Don_Hang_Ban',
          'Doanh_Thu_SP',
          // [3] Hủy
          'So_Luong_Huy_SP',
          'So_Luong_Don_Huy',
          'Ty_Le_Huy_SP',
        ],
        filterField: 'Ten_San_Pham',
      },
    };

    for (const view of views) {
      const config = viewConfigs[view.view_name];
      if (config) {
        logger.info(
          `⚙️  Đang cấu hình bộ lọc & ẩn cột cho View "${view.view_name}"...`,
        );
        const filterFieldId = fieldMap[config.filterField];
        const hiddenFields = Object.keys(fieldMap)
          .filter(
            (name) =>
              !config.show.includes(name) && fieldMap[name] !== primaryFieldId,
          )
          .map((name) => fieldMap[name]);

        const patchPayload = {
          property: {
            filter_info: {
              conjunction: 'and',
              conditions: [
                {
                  field_id: filterFieldId,
                  operator: 'isNotEmpty',
                },
              ],
            },
            hidden_fields: hiddenFields,
          },
        };

        const patchUrl = `${LARK_BASE_URL}/bitable/v1/apps/${appToken}/tables/${tableId}/views/${view.view_id}`;
        const patchRes = await axiosWithRetry({
          method: 'patch',
          url: patchUrl,
          data: patchPayload,
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          }
        });

        if (patchRes.data.code !== 0) {
          logger.error(
            `❌ Lỗi khi cấu hình View ${view.view_name}: ${patchRes.data.msg}`,
          );
        } else {
          logger.info(`✅ Đã cấu hình View "${view.view_name}" thành công!`);
        }
      }
    }
  } catch (err) {
    logger.error(`⚠️ Lỗi cấu hình các chế độ xem: ${err.message}`);
  }
}

async function upsertBitableRecord(
  appToken,
  tableId,
  primaryKey,
  keyValue,
  fields,
  token,
) {
  const searchUrl = `${LARK_BASE_URL}/bitable/v1/apps/${appToken}/tables/${tableId}/records/search`;
  const searchPayload = {
    page_size: 1,
    filter: {
      conjunction: 'and',
      conditions: [
        {
          field_name: primaryKey,
          operator: 'is',
          value: [String(keyValue)],
        },
      ],
    },
  };

  const searchRes = await axiosWithRetry({
    method: 'post',
    url: searchUrl,
    data: searchPayload,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    timeout: 30000,
  });

  const items = searchRes.data?.data?.items || [];
  if (items.length > 0) {
    const recordId = items[0].record_id;
    const updateUrl = `${LARK_BASE_URL}/bitable/v1/apps/${appToken}/tables/${tableId}/records/${recordId}`;

    const updateRes = await axiosWithRetry({
      method: 'put',
      url: updateUrl,
      data: { fields },
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      timeout: 30000,
    });

    if (updateRes.data.code !== 0) {
      throw new Error(`Loi update ban ghi ${keyValue}: ${updateRes.data.msg}`);
    }
    logger.info(`🔄  Đã cập nhật bản ghi ${keyValue} (ID: ${recordId})`);
  } else {
    const createUrl = `${LARK_BASE_URL}/bitable/v1/apps/${appToken}/tables/${tableId}/records`;

    const createRes = await axiosWithRetry({
      method: 'post',
      url: createUrl,
      data: { fields },
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      timeout: 30000,
    });

    if (createRes.data.code !== 0) {
      throw new Error(`Loi tao moi ban ghi ${keyValue}: ${createRes.data.msg}`);
    }
    logger.info(`✨  Đã tạo mới bản ghi ${keyValue}`);
  }
}

async function renamePrimaryField(appToken, tableId, newName, token) {
  try {
    const fieldsRes = await axiosWithRetry({
      method: 'get',
      url: `${LARK_BASE_URL}/bitable/v1/apps/${appToken}/tables/${tableId}/fields`,
      headers: { Authorization: `Bearer ${token}` }
    });
    const fields = fieldsRes.data?.data?.items || [];
    const primaryField = fields.find((f) => f.is_primary) || fields[0];

    if (primaryField) {
      if (primaryField.field_name !== newName) {
        logger.info(
          `✏️  Đang đổi tên trường khóa chính từ "${primaryField.field_name}" thành "${newName}"...`,
        );
        const updateUrl = `${LARK_BASE_URL}/bitable/v1/apps/${appToken}/tables/${tableId}/fields/${primaryField.field_id}`;
        await axiosWithRetry({
          method: 'put',
          url: updateUrl,
          data: {
            field_name: newName,
            type: 1, // Text
          },
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          }
        });
        logger.info(
          `✅ Đã đổi tên trường khóa chính thành "${newName}" thành công!`,
        );
      }
    }
  } catch (err) {
    logger.error(`⚠️ Lỗi khi đổi tên trường khóa chính: ${err.message}`);
  }
}

async function clearTableRecordsForDate(appToken, tableId, reportDate, token) {
  try {
    logger.info(
      `🧹 Đang quét và xóa dữ liệu cũ của ngày ${reportDate} trong bảng ${tableId} để chuẩn bị ghi đè...`,
    );

    let totalDeleted = 0;
    while (true) {
      const searchUrl = `${LARK_BASE_URL}/bitable/v1/apps/${appToken}/tables/${tableId}/records/search?page_size=500`;
      const searchPayload = {
        filter: {
          conjunction: 'and',
          conditions: [
            {
              field_name: 'Ngày báo cáo',
              operator: 'is',
              value: [String(reportDate)]
            }
          ]
        }
      };

      const searchRes = await axiosWithRetry({
        method: 'post',
        url: searchUrl,
        data: searchPayload,
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        timeout: 30000
      });

      if (searchRes.data.code !== 0) {
        logger.error(`❌ Lỗi khi tìm bản ghi cũ để xóa: ${searchRes.data.msg}`);
        return;
      }

      const items = searchRes.data.data?.items || [];
      if (items.length === 0) {
        if (totalDeleted === 0) {
          logger.info(`ℹ️ Không tìm thấy bản ghi cũ nào của ngày ${reportDate}. Bảng đã sạch.`);
        } else {
          logger.info(`✅ Đã xóa sạch tổng cộng ${totalDeleted} bản ghi cũ của ngày ${reportDate}.`);
        }
        return;
      }

      const recordIds = items.map(r => r.record_id);
      logger.info(`🗑️ Đang xóa ${recordIds.length} bản ghi của ngày ${reportDate}...`);

      const deleteRes = await axiosWithRetry({
        method: 'post',
        url: `${LARK_BASE_URL}/bitable/v1/apps/${appToken}/tables/${tableId}/records/batch_delete`,
        data: { records: recordIds },
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        timeout: 30000
      });

      if (deleteRes.data.code !== 0) {
        logger.error(`❌ Lỗi khi xóa hàng loạt bản ghi cũ của ngày ${reportDate}: ${deleteRes.data.msg}`);
        return;
      }

      totalDeleted += recordIds.length;
    }
  } catch (err) {
    logger.error(`⚠️ Lỗi dọn dẹp dữ liệu cũ theo ngày: ${err.message}`);
  }
}

async function syncFinancialReportToLarkBase(reportData) {
  const token = await getTenantAccessToken();
  const dateStr = reportData.reportDate || '';

  // Tên bảng cố định — tất cả dữ liệu ghi vào 1 bảng duy nhất, append theo ngày
  const tableName = 'BÁO CÁO HÀNG NGÀY';
  const appToken = process.env.LARK_BASE_APP_TOKEN || 'JJ4cbywbXalFOOsK4iCj2bvNpAd';

  logger.info(`🔍 Đang tìm/tạo bảng "${tableName}" trong Lark Bitable (${dateStr})...`);
  const { tableId } = await getOrCreateTable(appToken, tableName, token);

  // Luôn đổi tên trường khóa chính của bảng thành "Ngày báo cáo" để đảm bảo cột đầu tiên luôn đúng
  await renamePrimaryField(appToken, tableId, 'Ngày báo cáo', token);

  logger.info(
    `🛠️  Đang cấu hình các trường dữ liệu hợp nhất cho bảng "${tableName}"...`,
  );
  await ensureTableFields(appToken, tableId, UnifiedFields, token);

  logger.info(`🎨 Đang cấu hình 2 tabs (Tổng quan + Sản phẩm) cho bảng "${tableName}"...`);
  const tabs = ['Tổng quan', 'Sản phẩm'];
  await ensureTableViews(appToken, tableId, tabs, token);
  await configureTableViews(appToken, tableId, token);

  // Xóa sạch bản ghi cũ của riêng ngày báo cáo trước khi ghi dữ liệu mới
  await clearTableRecordsForDate(appToken, tableId, dateStr, token);

  const timeNowStr = new Date().toLocaleString('vi-VN', {
    timeZone: 'Asia/Ho_Chi_Minh',
  });
  const recordsToInsert = [];

  // 1. Dòng gộp TỔNG HỆ THỐNG
  recordsToInsert.push({
    fields: {
      'Ngày báo cáo': dateStr,
      Shop: 'TỔNG HỆ THỐNG',
      So_Don_Hang: Number(reportData.totalOrders || 0),
      Gross_Sales: Number(reportData.totalRevenue || 0),
      Net_Thuc_Nhan_Vi: Number(reportData.netRevenue || 0),
      Net_Du_Kien: Number(reportData.expectedNetRevenue || 0),
      Tong_Chi_Phi_San: Number(reportData.fees?.total || 0),
      AOV: Number(reportData.avgPerOrder || 0),
      Don_Bi_Huy: Number(reportData.cancelledCount || 0),
      Cho_Dong_Goi: Number(reportData.pendingFulfillmentCount || 0),
      Cho_Lay_Hang: Number(reportData.pendingConfirmationCount || 0),
      Dang_Van_Chuyen: Number(reportData.shippingCount || 0),
      Khuyen_Mai_Shop: Number(reportData.totalDiscount || 0),
      Phi_Thanh_Toan: Number(reportData.fees?.transaction || 0),
      Phi_Co_Dinh: Number(reportData.fees?.commission || 0),
      Phi_Dich_Vu: Number(reportData.fees?.service || 0),
      Phi_Van_Chuyen: Number(reportData.totalShippingFee || 0),
      Chi_Phi_Da_Tra: Number(
        (reportData.fees?.transaction || 0) +
          (reportData.fees?.commission || 0) +
          (reportData.fees?.service || 0),
      ),
      Chi_Phi_Chua_Tra: Math.max(
        0,
        Number(
          (reportData.fees?.total || 0) -
            ((reportData.fees?.transaction || 0) +
              (reportData.fees?.commission || 0) +
              (reportData.fees?.service || 0)),
        ),
      ),
    },
  });

  // 2. 6 dòng Shop con
  const shopBreakdown = reportData.shopeeShopBreakdown || {};
  for (const [shopName, stats] of Object.entries(shopBreakdown)) {
    const shopFees = stats.fees || {
      total: 0,
      transaction: 0,
      commission: 0,
      service: 0,
      shipping: 0,
    };
    const shopNetExpected =
      stats.netRevenue !== undefined
        ? stats.netRevenue
        : stats.revenue - shopFees.total;
    const shopNetActual =
      stats.netRevenueActual !== undefined ? stats.netRevenueActual : 0;
    const shopChiPhiDaTra =
      Number(shopFees.transaction || 0) +
      Number(shopFees.commission || 0) +
      Number(shopFees.service || 0);
    const shopChiPhiChuaTra = Math.max(
      0,
      Number(shopFees.total || 0) - shopChiPhiDaTra,
    );

    recordsToInsert.push({
      fields: {
        'Ngày báo cáo': dateStr,
        Shop: shopName,
        So_Don_Hang: Number(stats.orders || 0),
        Gross_Sales: Number(stats.revenue || 0),
        Net_Thuc_Nhan_Vi: Number(shopNetActual),
        Net_Du_Kien: Number(shopNetExpected),
        Tong_Chi_Phi_San: Number(shopFees.total || 0),
        AOV: stats.orders > 0 ? Math.round(stats.revenue / stats.orders) : 0,
        Don_Bi_Huy: Number(stats.cancelledCount || 0),
        Cho_Dong_Goi: 0,
        Cho_Lay_Hang: 0,
        Dang_Van_Chuyen: 0,
        Khuyen_Mai_Shop: Number(stats.discount || 0),
        Phi_Thanh_Toan: Number(shopFees.transaction || 0),
        Phi_Co_Dinh: Number(shopFees.commission || 0),
        Phi_Dich_Vu: Number(shopFees.service || 0),
        Phi_Van_Chuyen: Number(shopFees.shipping || 0),
        Chi_Phi_Da_Tra: Number(shopChiPhiDaTra),
        Chi_Phi_Chua_Tra: Number(shopChiPhiChuaTra),
      },
    });
  }

  // 3. Danh sách sản phẩm lấy từ Sapo Marketplace
  const topProducts = reportData.topProducts || [];
  for (const prod of topProducts) {
    recordsToInsert.push({
      fields: {
        'Ngày báo cáo': dateStr,
        Ten_San_Pham: prod.name,
        Phien_Ban: prod.variantName || '',
        Ma_SKU: prod.sku || '',
        Gian_Hang: prod.shopName || '',
        So_Luong_Da_Ban: Number(prod.qty || 0),
        Doanh_Thu_SP: Number(prod.revenue || 0),
        Don_Hang_Ban: Number(prod.orderNumber || 0),
        So_Luong_Huy_SP: Number(prod.cancelledQty || 0),
        So_Luong_Don_Huy: Number(prod.cancelledOrderNumber || 0),
        Ty_Le_Huy_SP: Number(prod.cancelledRate || 0) / 100,
      },
    });
  }

  logger.info(
    `📤 Đang thực hiện ghi hàng loạt ${recordsToInsert.length} bản ghi vào bảng "${tableName}"...`,
  );
  const insertRes = await axiosWithRetry({
    method: 'post',
    url: `${LARK_BASE_URL}/bitable/v1/apps/${appToken}/tables/${tableId}/records/batch_create`,
    data: { records: recordsToInsert },
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    }
  });

  if (insertRes.data.code !== 0) {
    throw new Error(`Lỗi ghi hàng loạt vào Lark Base: ${insertRes.data.msg}`);
  }

  logger.info(
    `✅ Đồng bộ dữ liệu thành công sang bảng "${tableName}" với 2 Tabs (Tổng quan + Sản phẩm)!`,
  );
  logger.info(
    `🔗 URL truy cập trực tiếp: https://maxufactory.jp.larksuite.com/base/${appToken}?table=${tableId}`,
  );
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
  syncFinancialReportToLarkBase,
};
