const axios = require('axios');
const logger = require('../../utils/logger');
const auth = require('./auth');
const sapo = require('../sapo');

const LARK_BASE_URL = 'https://open.larksuite.com/open-apis';

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

  const token = await auth.getTenantAccessToken();
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

    const token = await auth.getTenantAccessToken();
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
 */
async function listChats({ pageSize = 20, pageToken } = {}) {
  const token = await auth.getTenantAccessToken();

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

  if (response.data.code !== 0) {
    throw new Error(`Lark list chats loi: code=${response.data.code}, msg=${response.data.msg}`);
  }
  return response.data.data || {};
}

/**
 * Xây dựng Lark Interactive Message Card
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

  const headerColor =
    (actualNetGrowthPercent !== undefined
      ? actualNetGrowthPercent
      : growthPercent) >= 0
      ? 'green'
      : 'red';

  const fmtVND = (n) => new Intl.NumberFormat('vi-VN').format(n) + ' VNĐ';
  const fmtVNDShort = (n) => new Intl.NumberFormat('vi-VN').format(n);
  
  const configuredProductCardLimit = Number(process.env.LARK_PRODUCT_CARD_LIMIT || 15);
  const productCardLimit = Number.isFinite(configuredProductCardLimit)
    ? Math.min(Math.max(Math.round(configuredProductCardLimit), 1), 50)
    : 15;

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

module.exports = {
  sendReportCard,
  sendTextAlert,
  sendWebhookMessage,
  listChats,
  buildMessageCard,
};
