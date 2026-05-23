/**
 * OpenAI Service (Tùy chọn)
 * Gửi số liệu doanh thu sang OpenAI để nhận phân tích thông minh
 */
const axios = require('axios');
const logger = require('../utils/logger');

const OPENAI_ENABLED = process.env.OPENAI_ENABLED === 'true';
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

/**
 * Gửi dữ liệu doanh thu sang OpenAI để phân tích
 * Trả về chuỗi phân tích tiếng Việt ngắn gọn (~2-3 câu)
 */
async function analyzeRevenue({ todayData, yesterdayData }) {
  if (!OPENAI_ENABLED || !OPENAI_API_KEY) {
    logger.info('ℹ️  OpenAI bị tắt hoặc chưa cấu hình. Bỏ qua phân tích AI.');
    return null;
  }

  const fmtVND = (n) => new Intl.NumberFormat('vi-VN').format(n) + ' VNĐ';

  const growthRevenue = yesterdayData && yesterdayData.net_revenue
    ? (((todayData.netRevenue - yesterdayData.net_revenue) / yesterdayData.net_revenue) * 100).toFixed(1)
    : null;

  const prompt = `
Bạn là trợ lý phân tích kinh doanh Shopee. Hãy phân tích ngắn gọn (2-3 câu, tiếng Việt) dữ liệu sau:

Ngày báo cáo: ${todayData.reportDate}
Tổng doanh thu gốc (Gross): ${fmtVND(todayData.totalRevenue)}
Doanh thu thực nhận (Net): ${fmtVND(todayData.netRevenue)} (sau khi đã khấu trừ ${fmtVND(todayData.fees?.total || 0)} chi phí sàn Shopee)
Tổng số đơn: ${todayData.totalOrders} đơn
Trung bình/đơn: ${fmtVND(todayData.avgPerOrder)}
${growthRevenue != null ? `Tăng trưởng doanh thu thực nhận (Net): ${growthRevenue}% so với kỳ trước` : ''}
${todayData.topProducts?.length ? `Top sản phẩm bán chạy: ${todayData.topProducts.slice(0, 3).map((p) => p.name).join(', ')}` : ''}

Yêu cầu:
- Nhận xét ngắn về hiệu suất kinh doanh hôm qua dựa trên doanh thu thực nhận (Net)
- Nêu điểm nổi bật hoặc cần chú ý
- Đề xuất hành động nếu cần
- Giọng văn chuyên nghiệp, súc tích
`.trim();

  try {
    logger.info('🤖 Đang gửi dữ liệu sang OpenAI để phân tích...');

    const response = await axios.post(
      'https://api.openai.com/v1/chat/completions',
      {
        model:       'gpt-4o-mini',
        max_tokens:  300,
        temperature: 0.7,
        messages: [
          {
            role:    'system',
            content: 'Bạn là chuyên gia phân tích kinh doanh thương mại điện tử, chuyên Shopee Việt Nam. Trả lời ngắn gọn, chính xác bằng tiếng Việt.',
          },
          { role: 'user', content: prompt },
        ],
      },
      {
        headers: {
          Authorization:  `Bearer ${OPENAI_API_KEY}`,
          'Content-Type': 'application/json',
        },
        timeout: 30000,
      }
    );

    const analysis = response.data.choices?.[0]?.message?.content?.trim();
    logger.info('✅ OpenAI phân tích thành công.');
    return analysis || null;
  } catch (err) {
    logger.error('❌ OpenAI phân tích thất bại: ' + err.message);
    return null; // Không crash toàn bộ workflow nếu AI lỗi
  }
}

module.exports = { analyzeRevenue };
